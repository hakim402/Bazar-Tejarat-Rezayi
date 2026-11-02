"""Synthetic Phase 11 fixtures for the owned native harness only."""

import copy
import json
from django.conf import settings
from django.core.management import BaseCommand, CommandError
from django.db import connection
from django.test import override_settings
from config.testing import assert_owned_database
from apps.accounts.models import User, Account
from apps.catalogue.models import Product, Variant
from apps.catalogue import services as catalogue
from apps.catalogue.media import upload
from apps.organizations.models import BusinessProfile, Membership
from apps.verification.models import ReviewCase
from apps.orders.services import set_terms
from apps.marketplace.management.commands.seed_marketplace_examples import image_file
from apps.messaging.management.commands.seed_messaging_examples import actor
from apps.inventory import services as stock
from apps.cart import services as cart
import uuid


class Command(BaseCommand):
    def add_arguments(self, parser):
        parser.add_argument("--stdin", action="store_true", required=True)

    def handle(self, **options):
        assert_owned_database(connection)
        if settings.PRODUCTION or not settings.DEBUG:
            raise CommandError("Owned development fixtures only")
        password = json.load(__import__("sys").stdin)["password"]
        if Product.objects.filter(variants__sku="P11-A-0").exists():
            return
        with override_settings(OWNER_MFA_REQUIRED=False):
            publisher = actor(User.objects.get(email="phase09-root@example.test"), "owner")
            for name, context in [("buyer", "buyer"), ("owner-a", "seller"), ("owner-b", "seller")]:
                user = User.objects.create_user(
                    f"phase11-{name}@example.test",
                    password,
                    display_name="Synthetic Phase11 " + name,
                    email_verified=True,
                )
                Account.objects.create(user=user, context=context)
            buyer = actor(User.objects.get(email="phase11-buyer@example.test"), "buyer")
            for letter in ["a", "b"]:
                source = (
                    Product.objects.filter(
                        seller__account__user__email=f"phase10-owner-{letter}@example.test", published__isnull=False
                    )
                    .select_related("published")
                    .first()
                )
                owner = actor(User.objects.get(email=f"phase11-owner-{letter}@example.test"), "seller")
                profile = BusinessProfile.objects.create(
                    account=owner.account, kind="company", display_name="Synthetic negotiation " + letter.upper()
                )
                Membership.objects.create(
                    company=profile, account=owner.account, is_owner=True, bundles=["catalogue", "orders_negotiation"]
                )
                ReviewCase.objects.create(
                    profile=profile,
                    status="approved",
                    snapshot={"display_name": "درخواست آزمایشی • Synthetic negotiation " + letter.upper()},
                )
                set_terms(
                    owner,
                    profile.pk,
                    {
                        "version": 0,
                        "enabled": True,
                        "destinations": [{"country": "AF", "all_cities": True, "cities": []}],
                        "methods": ["advance", "cod"],
                        "reason": "Synthetic negotiation terms",
                    },
                )
                result = catalogue.create(
                    owner, {"seller": profile.pk, "currency": "AFN", "pricing_mode": "negotiable"}
                )
                product = Product.objects.get(pk=result["id"])
                image = upload(owner, product.pk, product.version, image_file())
                product.refresh_from_db()
                body = copy.deepcopy(source.published.body)
                body = {
                    k: body[k]
                    for k in ["locale", "title", "description", "brand", "category", "attributes", "images", "variants"]
                }
                body["images"] = [{"id": image["id"], "alt": "Synthetic negotiation", "variant": None}]
                body["title"] = "درخواست آزمایشی • Synthetic negotiable product " + letter.upper()
                body["variants"] = [
                    {
                        **{
                            k: v
                            for k, v in source.published.body["variants"][0].items()
                            if k not in ["id", "attribute_labels"]
                        },
                        "sku": f"P11-{letter.upper()}-0",
                        "retail": "12.50",
                        "wholesale": "10.00",
                    }
                ]
                saved = catalogue.save(owner, product.pk, {"version": product.version, "body": body})
                for a, action in [(owner, "submit"), (publisher, "publish")]:
                    product.refresh_from_db()
                    catalogue.transition(
                        a,
                        product.pk,
                        {
                            "version": product.version,
                            "revision": saved["revision"],
                            "action": action,
                            "reason": "Synthetic Phase11 fixture",
                        },
                    )
                variant = Variant.objects.get(product=product)
                stock.configure(
                    owner,
                    profile.pk,
                    variant.pk,
                    {
                        "token": uuid.uuid4(),
                        "version": 0,
                        "reason": "Synthetic stock",
                        "tracking": "plain",
                        "expiry_required": False,
                        "threshold": None,
                    },
                )
                stock.manual(
                    owner,
                    profile.pk,
                    variant.pk,
                    {"token": uuid.uuid4(), "version": 1, "reason": "Synthetic stock receipt", "quantity": "100.000"},
                )
                row = cart.buyer(buyer)
                cart.mutate(
                    buyer.request,
                    buyer,
                    {
                        "command_id": uuid.uuid4(),
                        "version": row.version if row else 0,
                        "action": "set",
                        "variant": variant.pk,
                        "tier": "retail",
                        "quantity": "2.000",
                    },
                )
            self.stdout.write("Synthetic negotiable catalogue/stock ready; real data untouched.")
