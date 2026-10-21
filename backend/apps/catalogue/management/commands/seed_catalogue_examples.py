"""Representative synthetic catalogue only inside an owned disposable browser database."""

import io
import json
import sys
from types import SimpleNamespace
from unittest.mock import patch
from PIL import Image
from django.conf import settings
from django.contrib.auth.models import Group, Permission
from django.core.management import BaseCommand, CommandError, call_command
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connection, transaction
from config.testing import assert_owned_database
from apps.accounts.models import User, Account
from apps.organizations.models import BusinessProfile, Membership, BUNDLES
from apps.organizations.access import Actor
from apps.verification.models import ReviewCase
from apps.catalogue.models import Product
from apps.catalogue import services
from apps.catalogue.media import upload


class Command(BaseCommand):
    def add_arguments(self, parser):
        parser.add_argument("--stdin", action="store_true", required=True)

    @transaction.atomic
    def handle(self, **options):
        if settings.PRODUCTION or not settings.DEBUG:
            raise CommandError("Only the disposable browser runtime is permitted.")
        assert_owned_database(connection)
        password = json.load(sys.stdin)["password"]
        if User.objects.filter(email="phase06-seller@example.test").exists():
            self.stdout.write("Existing synthetic catalogue preserved.")
            return
        call_command("setup_catalogue", verbosity=0)
        for name, permissions in [
            ("full", ["manage_taxonomy", "review_source", "review_translation", "moderate_catalogue"]),
            ("source", ["review_source"]),
            ("translator", ["review_translation"]),
            ("taxonomy", ["manage_taxonomy"]),
            ("moderator", ["moderate_catalogue"]),
        ]:
            user = User.objects.create_user(
                f"phase06-{name}@example.test",
                password,
                display_name="Synthetic catalogue " + name,
                email_verified=True,
            )
            account = Account.objects.create(user=user, context="staff")
            group = Group.objects.create(name="Synthetic catalogue " + name)
            group.permissions.set(
                Permission.objects.filter(content_type__app_label="catalogue", codename__in=permissions)
            )
            account.permission_groups.add(group)
        for name, kind, approved in [
            ("seller", "individual", True),
            ("company", "company", True),
            ("rezayi", "individual", True),
            ("unrelated", "individual", True),
            ("unapproved", "individual", False),
        ]:
            user = User.objects.create_user(
                f"phase06-{name}@example.test", password, display_name="Synthetic " + name, email_verified=True
            )
            account = Account.objects.create(user=user, context="seller")
            profile = BusinessProfile.objects.create(account=account, kind=kind, display_name="Synthetic " + name)
            ReviewCase.objects.create(profile=profile, snapshot={}, status="approved" if approved else "draft")
            if kind == "company":
                Membership.objects.create(company=profile, account=account, is_owner=True, bundles=list(BUNDLES))
                for member_name, bundles, active in [
                    ("restricted", [], True),
                    ("revoked", ["catalogue"], False),
                    ("cataloguer", ["catalogue"], True),
                ]:
                    member_user = User.objects.create_user(
                        f"phase06-{member_name}@example.test",
                        password,
                        display_name="Synthetic " + member_name,
                        email_verified=True,
                    )
                    member_account = Account.objects.create(user=member_user, context="seller")
                    Membership.objects.create(company=profile, account=member_account, bundles=bundles, active=active)
            if name != "seller":
                continue
            actor = Actor(SimpleNamespace(user=user, account=account), "seller")
            with patch("apps.organizations.access.get_grant", side_effect=lambda request, context: request.account):
                for index, category in enumerate(("food", "clothing", "electronics", "cosmetics")):
                    result = services.create(
                        actor,
                        {
                            "seller": profile.pk,
                            "currency": "USD" if index == 2 else "AFN",
                            "pricing_mode": "negotiable" if index == 2 else "fixed",
                        },
                    )
                    product = Product.objects.get(pk=result["id"])
                    buffer = io.BytesIO()
                    Image.new("RGB", (640, 480), (30, 100, 180)).save(buffer, format="PNG")
                    image = upload(
                        actor, product.pk, product.version, SimpleUploadedFile("synthetic.png", buffer.getvalue())
                    )
                    product.refresh_from_db()
                    body = {
                        "title": "محصول آزمایشی " + category,
                        "description": "این محصول فقط برای آزمایش در دیتابیس جداگانه است.",
                        "brand": "",
                        "locale": "fa-AF",
                        "category": category,
                        "attributes": {},
                        "variants": [
                            {
                                "sku": "SYN-" + category.upper(),
                                "unit": "piece",
                                "increment": "1",
                                "minimum": "5",
                                "contents": "",
                                "attributes": {},
                                "active": True,
                                "retail": "120.50",
                                "wholesale": "100.00",
                            }
                        ],
                        "images": [{"id": str(image["id"]), "alt": "تصویر آزمایشی محصول", "variant": None}],
                    }
                    if category == "clothing":
                        body["variants"][0]["attributes"] = {"size": "M", "color": "آبی"}
                        body["variants"].append(
                            {
                                **body["variants"][0],
                                "sku": "SYN-CLOTHING-L",
                                "attributes": {"size": "L", "color": "آبی"},
                                "retail": "130.00",
                            }
                        )
                    services.save(actor, product.pk, {"version": product.version, "body": body})
        self.stdout.write("Owned synthetic catalogue fixtures prepared; no live provider calls.")
