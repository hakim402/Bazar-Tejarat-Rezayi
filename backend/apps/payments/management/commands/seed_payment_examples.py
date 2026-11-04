"""Synthetic Phase12 examples; refuses every existing application database."""

import copy
import json
import sys
import uuid
from django.conf import settings
from django.core.management import BaseCommand, CommandError, call_command
from django.db import connection
from django.test import override_settings
from config.testing import assert_owned_database
from apps.accounts.models import User, Account
from apps.organizations.models import BusinessProfile, Membership, BUNDLES
from apps.verification.models import ReviewCase
from apps.catalogue.models import Product, Variant
from apps.catalogue import services as catalogue
from apps.catalogue.media import upload
from apps.inventory import services as inventory
from apps.cart import services as cart
from apps.orders import services as orders, negotiations
from apps.orders.models import SellerOrder, Negotiation
from apps.messaging.management.commands.seed_messaging_examples import actor
from apps.marketplace.management.commands.seed_marketplace_examples import image_file


def example_order(method="advance", *, negotiated=False):
    assert_owned_database(connection)
    if settings.PRODUCTION or not settings.DEBUG:
        raise CommandError("Only owned development fixtures are permitted.")
    buyer = actor(User.objects.get(email="phase12-buyer@example.test"), "buyer")
    owner = actor(User.objects.get(email="phase12-owner@example.test"), "seller")
    variant = Variant.objects.select_related("product").get(sku="P12-NEG" if negotiated else "P12-FIXED")
    current = cart.buyer(buyer)
    cart.mutate(
        buyer.request,
        buyer,
        {
            "command_id": uuid.uuid4(),
            "version": current.version if current else 0,
            "action": "set",
            "variant": variant.pk,
            "tier": "retail",
            "quantity": "1.000",
        },
    )
    current = cart.buyer(buyer)
    lines = list(current.lines.filter(variant=variant).values_list("pk", flat=True))
    choice = {"seller": str(variant.product.seller_id), "country": "AF", "city": "Kabul", "method": method}
    if negotiated:
        line = {
            "variant": str(variant.pk),
            "tier": "retail",
            "quantity": "1.000",
            "unit_price": "12.50",
            "max_quantity": "2.000",
            "max_unit_price": "15.00",
        }
        result = negotiations.submit(
            buyer,
            {
                "command_id": uuid.uuid4(),
                "version": current.version,
                "currency": "AFN",
                "lines": lines,
                "proposals": [
                    {
                        "lines": [line],
                        "choice": choice,
                        "explanation": "seller-finalizes-v1",
                        "note": "Synthetic capped payment agreement",
                    }
                ],
            },
        )
        request = Negotiation.objects.get(pk=result["outcomes"][0]["request"])
        result = negotiations.transition(
            owner,
            request.pk,
            "finalize",
            {
                "command_id": uuid.uuid4(),
                "version": request.version,
                "lines": [{k: v for k, v in line.items() if not k.startswith("max_")}],
                "choice": choice,
                "reason": "Synthetic independent agreement finalization",
            },
        )
        order = SellerOrder.objects.get(pk=result["order"])
    else:
        result = orders.submit(
            buyer,
            {
                "command_id": uuid.uuid4(),
                "version": current.version,
                "currency": "AFN",
                "lines": lines,
                "choices": [choice],
                "shown_prices": [],
                "locale": "en",
            },
        )
        order = SellerOrder.objects.get(pk=result["outcomes"][0]["order"])
    return {
        "id": str(order.pk),
        "seller": str(order.seller_id),
        "invoice": str(order.invoice.pk),
        "variant": str(variant.pk),
        "number": order.invoice.number,
    }


class Command(BaseCommand):
    def add_arguments(self, parser):
        parser.add_argument("--stdin", action="store_true", required=True)

    def handle(self, **options):
        assert_owned_database(connection)
        if settings.PRODUCTION or not settings.DEBUG:
            raise CommandError("Only owned development fixtures are permitted.")
        password = json.load(sys.stdin)["password"]
        if User.objects.filter(email="phase12-buyer@example.test").exists():
            return
        call_command("setup_payment_groups", verbosity=0)
        for name, context in [
            ("buyer", "buyer"),
            ("owner", "seller"),
            ("finance", "seller"),
            ("operations", "seller"),
            ("reviewer", "staff"),
        ]:
            user = User.objects.create_user(
                f"phase12-{name}@example.test",
                password,
                display_name="آزمایشی • Synthetic payment " + name,
                email_verified=True,
                is_staff=context == "staff",
            )
            Account.objects.create(user=user, context=context)
            if context == "staff":
                from django.contrib.auth.models import Group

                user.groups.add(
                    *Group.objects.filter(
                        name__in=[
                            "Rezayi: Payment review",
                            "Rezayi: Payment corrections",
                            "Rezayi: Payment shortages",
                            "Rezayi: Overdue review",
                        ]
                    )
                )
        with override_settings(OWNER_MFA_REQUIRED=False, CATALOGUE_TRANSLATION_ENABLED=False):
            owner = actor(User.objects.get(email="phase12-owner@example.test"), "seller")
            root = actor(User.objects.get(email="phase09-root@example.test"), "owner")
            profile = BusinessProfile.objects.create(
                account=owner.account, kind="company", display_name="پرداخت آزمایشی • Synthetic payments"
            )
            Membership.objects.create(company=profile, account=owner.account, is_owner=True, bundles=list(BUNDLES))
            for name, bundle in [("finance", "payments_refunds"), ("operations", "orders_negotiation")]:
                Membership.objects.create(
                    company=profile,
                    account=Account.objects.get(user__email=f"phase12-{name}@example.test"),
                    bundles=[bundle],
                )
            ReviewCase.objects.create(
                profile=profile, status="approved", snapshot={"display_name": profile.display_name}
            )
            orders.set_terms(
                owner,
                profile.pk,
                {
                    "version": 0,
                    "enabled": True,
                    "destinations": [{"country": "AF", "all_cities": True, "cities": []}],
                    "methods": ["advance", "cod"],
                    "reason": "Synthetic payment checkout terms",
                },
            )
            source = (
                Product.objects.filter(published__isnull=False, pricing_mode="fixed")
                .select_related("published")
                .first()
            )
            for mode, sku in [("fixed", "P12-FIXED"), ("negotiable", "P12-NEG")]:
                result = catalogue.create(owner, {"seller": profile.pk, "currency": "AFN", "pricing_mode": mode})
                product = Product.objects.get(pk=result["id"])
                image = upload(owner, product.pk, product.version, image_file())
                product.refresh_from_db()
                body = {
                    k: copy.deepcopy(source.published.body[k])
                    for k in ["locale", "title", "description", "brand", "category", "attributes", "images", "variants"]
                }
                body["images"] = [{"id": image["id"], "alt": "Synthetic payment goods", "variant": None}]
                body["title"] = "کالای آزمایشی • Synthetic payment goods"
                variant = copy.deepcopy(body["variants"][0])
                variant.pop("id", None)
                variant.pop("attribute_labels", None)
                variant.update(sku=sku, retail="12.50", wholesale="10.00")
                body["variants"] = [variant]
                saved = catalogue.save(owner, product.pk, {"version": product.version, "body": body})
                for principal, action in [(owner, "submit"), (root, "publish")]:
                    product.refresh_from_db()
                    catalogue.transition(
                        principal,
                        product.pk,
                        {
                            "version": product.version,
                            "revision": saved["revision"],
                            "action": action,
                            "reason": "Synthetic reviewed payment goods",
                        },
                    )
                variant = Variant.objects.get(product=product)
                inventory.configure(
                    owner,
                    profile.pk,
                    variant.pk,
                    {
                        "token": uuid.uuid4(),
                        "version": 0,
                        "reason": "Synthetic stock setup",
                        "tracking": "plain",
                        "expiry_required": False,
                        "threshold": None,
                    },
                )
                inventory.manual(
                    owner,
                    profile.pk,
                    variant.pk,
                    {"token": uuid.uuid4(), "version": 1, "reason": "Synthetic stock receipt", "quantity": "1000.000"},
                )
            example_order()
            example_order("cod")
            example_order(negotiated=True)
        self.stdout.write("Owned fixed/negotiated payment examples prepared; existing data untouched.")
