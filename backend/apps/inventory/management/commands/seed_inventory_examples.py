"""Run-owned synthetic inventory scenarios; never a review/production data import."""

import io
import json
import sys
from types import SimpleNamespace
from unittest.mock import patch
from django.conf import settings
from django.contrib.auth.models import Group, Permission
from django.core.management import BaseCommand, CommandError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connection, transaction
from PIL import Image
from apps.accounts.models import User, Account
from apps.organizations.access import Actor
from apps.organizations.models import BusinessProfile, Membership, BUNDLES
from apps.verification.models import ReviewCase
from apps.catalogue import services as catalogue
from apps.catalogue.models import Product, Variant
from apps.catalogue.media import upload
from apps.inventory import services
from apps.inventory.models import Position, Bucket
from config.testing import assert_owned_database
import uuid
from datetime import timedelta
from django.utils import timezone


def command(**values):
    return {"token": str(uuid.uuid4()), "reason": "Synthetic disposable stock fixture", **values}


class Command(BaseCommand):
    def add_arguments(self, parser):
        parser.add_argument("--stdin", action="store_true", required=True)

    @transaction.atomic
    def handle(self, **options):
        assert_owned_database(connection)
        if settings.PRODUCTION or not settings.DEBUG:
            raise CommandError("Only the disposable browser runtime is permitted.")
        password = json.load(sys.stdin)["password"]
        if User.objects.filter(email="phase07-seller@example.test").exists():
            return
        reader = Group.objects.create(name="Synthetic catalogue inventory")
        reader.permissions.set(
            Permission.objects.filter(content_type__app_label="inventory", codename="read_shortages")
        )
        seller = User.objects.create_user(
            "phase07-seller@example.test", password, display_name="Synthetic inventory seller", email_verified=True
        )
        account = Account.objects.create(user=seller, context="seller")
        first_run = User.objects.create_user(
            "phase07-noprofile@example.test", password, display_name="Synthetic first-run seller", email_verified=True
        )
        Account.objects.create(user=first_run, context="seller")

        actor = Actor(SimpleNamespace(user=seller, account=account), "seller")
        reviewer_account = Account.objects.get(user__email="phase06-full@example.test", context="staff")
        reviewer = Actor(SimpleNamespace(user=reviewer_account.user, account=reviewer_account), "staff")
        with patch("apps.organizations.access.get_grant", side_effect=lambda request, context: request.account):
            for kind in ["individual", "company"]:
                profile = BusinessProfile.objects.create(
                    account=account, kind=kind, display_name="آزمایشی — د ازموینې سوداګري — مخزون تجريبي " + kind
                )
                ReviewCase.objects.create(profile=profile, snapshot={}, status="approved")
                if kind == "company":
                    Membership.objects.create(company=profile, account=account, is_owner=True, bundles=list(BUNDLES))
                    for role, bundles in [("cataloguer", ["catalogue"]), ("fulfilment", ["fulfilment"])]:
                        user = User.objects.create_user(
                            f"phase07-{role}@example.test",
                            password,
                            display_name="Synthetic " + role,
                            email_verified=True,
                        )
                        member = Account.objects.create(user=user, context="seller")
                        Membership.objects.create(company=profile, account=member, bundles=bundles)
                created = catalogue.create(
                    actor,
                    {
                        "seller": profile.pk,
                        "currency": "AFN" if kind == "individual" else "USD",
                        "pricing_mode": "fixed",
                    },
                )
                product = Product.objects.get(pk=created["id"])
                image = io.BytesIO()
                Image.new("RGB", (80, 80), "blue").save(image, format="PNG")
                uploaded = upload(
                    actor, product.pk, product.version, SimpleUploadedFile("synthetic.png", image.getvalue())
                )
                product.refresh_from_db()
                body = {
                    "title": "محصول آزمایشی با نام طولانی برای بررسی موجودی — ازمایښتي توکي — منتج تجريبي",
                    "description": "Synthetic isolated inventory fixture, never real stock.",
                    "brand": "",
                    "locale": "fa-AF",
                    "category": "food",
                    "attributes": {},
                    "images": [{"id": str(uploaded["id"]), "alt": "Synthetic", "variant": None}],
                    "variants": [
                        {
                            "sku": f"P7-{kind[:1]}-{i:02d}",
                            "unit": "kg" if i == 1 else "piece",
                            "increment": "0.125" if i == 1 else "1.000",
                            "minimum": "1.000",
                            "contents": "",
                            "attributes": {"pack_size": str(i)},
                            "active": i != 25,
                            "retail": "12.00",
                            "wholesale": "10.00",
                        }
                        for i in range(26 if kind == "individual" else 2)
                    ],
                }
                saved = catalogue.save(actor, product.pk, {"version": product.version, "body": body})
                for action in ["submit", "publish"]:
                    product.refresh_from_db()
                    catalogue.transition(
                        actor if action == "submit" else reviewer,
                        product.pk,
                        {
                            "version": product.version,
                            "revision": saved["revision"],
                            "action": action,
                            "reason": "Synthetic approval",
                        },
                    )
                variants = list(Variant.objects.filter(product=product).order_by("sku"))
                for index, variant in enumerate(variants):
                    if index in {0, 24}:
                        continue
                    batched = index == 3
                    services.configure(
                        actor,
                        profile.pk,
                        variant.pk,
                        command(
                            version=0,
                            tracking="batch" if batched else "plain",
                            expiry_required=batched,
                            threshold="2.000",
                        ),
                    )
                    if index in [1, 3, 4]:
                        services.manual(
                            actor,
                            profile.pk,
                            variant.pk,
                            command(
                                version=1,
                                quantity="999999999.000" if index == 4 else "10.125" if index == 1 else "10.000",
                                **(
                                    {
                                        "batch_code": "SYN-LATE",
                                        "expires_on": (timezone.localdate() + timedelta(days=30)).isoformat(),
                                    }
                                    if batched
                                    else {}
                                ),
                            ),
                        )
                    if batched:
                        b = Bucket.objects.get(position_id=variant.pk)
                        services.allocate(
                            actor,
                            profile.pk,
                            command(
                                reference=f"synthetic-held-{kind}",
                                lines=[{"variant": str(variant.pk), "batch": str(b.batch_id), "quantity": "3.000"}],
                            ),
                        )
                        services.manual(
                            actor,
                            profile.pk,
                            variant.pk,
                            command(
                                version=3,
                                quantity="4.000",
                                batch_code="SYN-NEXT",
                                expires_on=(timezone.localdate() + timedelta(days=1)).isoformat(),
                            ),
                        )
                        # Fixed clock creates legitimate historical receipt, never a mutable batch expiry.
                if kind == "individual":
                    target = variants[3]
                    historical = timezone.now() - timedelta(days=5)
                    with patch("django.utils.timezone.now", return_value=historical):
                        services.manual(
                            actor,
                            profile.pk,
                            target.pk,
                            command(
                                version=Position.objects.get(pk=target.pk).version,
                                quantity="4.000",
                                batch_code="SYN-HISTORICAL",
                                expires_on=(historical.date() + timedelta(days=1)).isoformat(),
                            ),
                            now=historical,
                        )
                    services.allocate(
                        actor,
                        profile.pk,
                        command(
                            reference="synthetic-shortage",
                            lines=[{"variant": str(variants[1].pk), "quantity": "999.000"}],
                        ),
                    )
        self.stdout.write("Run-owned inventory scenarios prepared; no real business data changed.")
