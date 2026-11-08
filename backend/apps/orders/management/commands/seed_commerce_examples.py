"""Run-owned Phase 10 examples; never accepts an application database."""

import json
import sys
import uuid
from copy import deepcopy
from datetime import timedelta
from django.conf import settings
from django.core.management import BaseCommand, CommandError, call_command
from django.contrib.auth.models import Group
from django.db import connection
from django.test import override_settings
from django.utils import timezone
from config.testing import assert_owned_database
from apps.accounts.models import User, Account
from apps.catalogue.models import Product, Translation, Variant
from apps.organizations.models import BusinessProfile, Membership, BUNDLES
from apps.verification.models import ReviewCase
from apps.catalogue import services as catalogue, translations
from apps.catalogue.media import upload
from apps.inventory import services as inventory
from apps.inventory.models import Position
from apps.cart import services as cart
from apps.orders import services as orders
from apps.orders.models import SellerOrder
from apps.messaging.management.commands.seed_messaging_examples import actor
from apps.marketplace.management.commands.seed_marketplace_examples import image_file


def example_aftercare_order(buyer, sku, quantity, method="advance"):
    """One fresh single-line order reusing the Phase 10 synthetic fixtures."""
    assert_owned_database(connection)
    if settings.PRODUCTION or not settings.DEBUG:
        raise CommandError("Only native disposable browser fixtures are permitted.")
    variant = Variant.objects.get(sku=sku)
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
            "quantity": quantity,
        },
    )
    current = cart.buyer(buyer)
    lines = list(current.lines.filter(variant=variant, tier="retail").values_list("pk", flat=True))
    result = orders.submit(
        buyer,
        {
            "command_id": uuid.uuid4(),
            "version": current.version,
            "currency": "AFN",
            "lines": lines,
            "choices": [{"seller": variant.product.seller_id, "country": "AF", "city": "Kabul", "method": method}],
            "locale": "en",
        },
    )
    return SellerOrder.objects.get(pk=result["outcomes"][0]["order"])


def finance_version(order):
    from apps.payments.models import Finance

    return Finance.objects.filter(order=order).values_list("version", flat=True).first() or 0


def aftercare_version(order):
    from apps.orders.models import Aftercare

    return Aftercare.objects.filter(order=order).values_list("version", flat=True).first() or 0


def cancellation_and_refund(buyer, seller, root, staff):
    """Buyer request, staff approval, then seller report and staff confirmation."""
    assert_owned_database(connection)
    from apps.orders import cancellations
    from apps.orders.models import CancellationRequest
    from apps.payments import refunds
    from apps.payments import services as goods
    from apps.payments.models import RefundDue

    order = example_aftercare_order(buyer, "P10-A-00-ABC123", "5.000")
    goods.mutate(
        seller,
        order.pk,
        "receipt",
        {
            "command_id": uuid.uuid4(),
            "version": finance_version(order),
            "amount": format(order.goods_total, ".2f"),
            "currency": "AFN",
            "paid_at": timezone.now() - timedelta(minutes=1),
            "description": "Synthetic full advance funds",
        },
    )
    cancellations.mutate(buyer, order.pk, "request", {
        "command_id": uuid.uuid4(),
        "version": aftercare_version(order),
        "reason": "Synthetic buyer cancellation request",
    })
    request = CancellationRequest.objects.filter(order=order).order_by("-created_at", "pk").first()
    cancellations.decide(
        root,
        request.pk,
        {
            "command_id": uuid.uuid4(),
            "action": "assign",
            "version": aftercare_version(order),
            "request_version": request.version,
            "reason": "Independent synthetic assignment",
            "assigned_to": staff.user.pk,
        },
    )
    request.refresh_from_db()
    cancellations.decide(
        staff,
        request.pk,
        {
            "command_id": uuid.uuid4(),
            "action": "approve",
            "version": aftercare_version(order),
            "request_version": request.version,
            "reason": "Independent synthetic cancellation approval",
        },
    )
    due = RefundDue.objects.filter(order=order).first()
    refunds.decide(
        root,
        due.pk,
        {
            "command_id": uuid.uuid4(),
            "action": "assign",
            "version": finance_version(order),
            "due_version": due.version,
            "reason": "Independent synthetic refund assignment",
            "assigned_to": staff.user.pk,
        },
    )
    due.refresh_from_db()
    refunds.mutate(
        seller,
        order.pk,
        "report",
        {
            "command_id": uuid.uuid4(),
            "version": finance_version(order),
            "due": str(due.pk),
            "amount": format(due.amount, ".2f"),
            "sent_at": timezone.now() - timedelta(minutes=1),
            "reference": "Synthetic refund reference",
            "description": "Synthetic seller-issued goods refund",
        },
    )
    refunds.decide(
        staff,
        due.pk,
        {
            "command_id": uuid.uuid4(),
            "action": "confirm",
            "version": finance_version(order),
            "due_version": due.version,
            "reason": "Independent synthetic refund confirmation",
        },
    )


def amendment_example(buyer, seller, root, staff):
    assert_owned_database(connection)
    from apps.orders import amendments
    from apps.orders.models import Amendment, OrderLine

    order = example_aftercare_order(buyer, "P10-A-01-ABC123", "5.000")
    line = OrderLine.objects.filter(order=order).order_by("pk").first()
    amendments.mutate(
        seller,
        order.pk,
        "propose",
        {
            "command_id": uuid.uuid4(),
            "version": aftercare_version(order),
            "lines": [{"line": str(line.pk), "quantity": "4.000", "unit_price": format(line.unit_price, ".2f")}],
            "reason": "Synthetic seller quantity decrease",
        },
    )
    amendment = Amendment.objects.filter(order=order).order_by("-created_at", "pk").first()
    amendments.decide(
        root,
        amendment.pk,
        {
            "command_id": uuid.uuid4(),
            "action": "assign",
            "version": aftercare_version(order),
            "amendment_version": amendment.version,
            "reason": "Independent synthetic assignment",
            "assigned_to": staff.user.pk,
        },
    )
    amendment.refresh_from_db()
    amendments.decide(
        staff,
        amendment.pk,
        {
            "command_id": uuid.uuid4(),
            "action": "approve",
            "version": aftercare_version(order),
            "amendment_version": amendment.version,
            "reason": "Independent synthetic amendment approval",
        },
    )


def delivery_refund_example(buyer, seller, root):
    """Provider delivery refund recorded by the seller and confirmed independently."""
    assert_owned_database(connection)
    from apps.fulfilment import models as delivery_models
    from apps.fulfilment import queries as delivery_queries
    from apps.fulfilment.management.commands.seed_fulfilment_examples import command as delivery, review

    order = example_aftercare_order(buyer, "P10-A-02-ABC123", "5.000", method="cod")
    delivery(order, buyer, "recipient", recipient_revision=0,
             name="Synthetic delivery recipient",
             phone="000-TEST-ONLY",
             address="Synthetic private address — never real contact data",
             instructions="Synthetic manual handover",
             reason="Initial synthetic recipient")
    arrangement = delivery(order, seller, "arrange", provider="Synthetic manual delivery provider",
                           arranger="seller", self_delivery=False, instructions="Manual whole-order delivery")
    delivery(order, seller, "charge", provider=arrangement["provider"], amount="5.00", currency="AFN",
             reason="Separate synthetic delivery cost")
    review(delivery_models.ReviewCase.objects.get(order=order, kind="charge"), root)
    delivery(order, buyer, "claim", charge=delivery_queries.current_charge(order).pk, amount="5.00",
             currency="AFN", paid_at=timezone.now() - timedelta(minutes=1),
             description="Synthetic provider delivery funds")
    review(delivery_models.ReviewCase.objects.get(order=order, kind="payment"), root)
    delivery(order, seller, "refund", provider=arrangement["provider"], amount="2.00", currency="AFN",
             sent_at=timezone.now() - timedelta(minutes=1), reference="Synthetic provider refund reference",
             description="Synthetic provider-issued delivery refund")
    review(delivery_models.ReviewCase.objects.get(order=order, kind="refund"), root)


class Command(BaseCommand):
    def add_arguments(self, parser):
        parser.add_argument("--stdin", action="store_true", required=True)

    def handle(self, **options):
        assert_owned_database(connection)
        if settings.PRODUCTION or not settings.DEBUG:
            raise CommandError("Only native disposable browser fixtures are permitted.")
        password = json.load(sys.stdin)["password"]
        if User.objects.filter(email="phase10-buyer@example.test").exists():
            return
        call_command("setup_order_groups", verbosity=0)
        call_command("setup_aftercare_groups", verbosity=0)
        users = {}
        for name, context in [
            ("buyer", "buyer"),
            ("other", "buyer"),
            ("owner-a", "seller"),
            ("owner-b", "seller"),
            ("operations", "seller"),
            ("finance", "seller"),
        ]:
            user = User.objects.create_user(
                "phase10-" + name + "@example.test",
                password,
                display_name="آزمایشی • Synthetic " + name,
                email_verified=True,
            )
            Account.objects.create(user=user, context=context)
            users[name] = user
        root = User.objects.get(email="phase09-root@example.test")
        original = (
            Product.objects.filter(published__isnull=False, pricing_mode="fixed").select_related("published").first()
        )
        with override_settings(OWNER_MFA_REQUIRED=False, CATALOGUE_TRANSLATION_ENABLED=False):
            publisher = actor(root, "owner")
            for letter, count in [("a", 40), ("b", 1)]:
                owner = actor(users["owner-" + letter], "seller")
                profile = BusinessProfile.objects.create(
                    account=owner.account,
                    kind="company",
                    display_name="Synthetic commerce " + letter.upper(),
                    contact_phone="NEVER-PUBLIC-CONTACT",
                )
                Membership.objects.create(company=profile, account=owner.account, is_owner=True, bundles=list(BUNDLES))
                Membership.objects.create(
                    company=profile, account=users["operations"].accounts.get(), bundles=["orders_negotiation"]
                )
                if letter == "a":
                    Membership.objects.create(
                        company=profile, account=users["finance"].accounts.get(), bundles=["payments_refunds"]
                    )
                ReviewCase.objects.create(
                    profile=profile,
                    status="approved",
                    snapshot={"display_name": "فروشگاه آزمایشی • Synthetic commerce " + letter.upper()},
                )
                created = catalogue.create(owner, {"seller": profile.pk, "currency": "AFN", "pricing_mode": "fixed"})
                product = Product.objects.get(pk=created["id"])
                image = upload(owner, product.pk, product.version, image_file())
                product.refresh_from_db()
                body = deepcopy(original.published.body)
                body = {
                    k: body[k]
                    for k in ["locale", "title", "description", "brand", "category", "attributes", "images", "variants"]
                }
                body["category"] = "food"
                body["attributes"] = {"grade": "A"}
                body["title"] = (
                    "محصول آزمایشی با متن طولانی برای بررسی صورتحساب — Synthetic long mixed product ABC 123 " * 2
                )
                body["images"] = [{"id": image["id"], "alt": "Synthetic commerce image", "variant": None}]
                body["variants"] = [
                    {
                        "sku": f"P10-{letter.upper()}-{i:02d}-ABC123",
                        "unit": "piece",
                        "increment": "1.000",
                        "minimum": "5.000",
                        "contents": "",
                        "attributes": {"pack_size": str(i)},
                        "active": True,
                        "retail": "12.50",
                        "wholesale": "10.00",
                    }
                    for i in range(count)
                ]
                saved = catalogue.save(owner, product.pk, {"version": product.version, "body": body})
                product.refresh_from_db()
                catalogue.transition(
                    owner,
                    product.pk,
                    {
                        "version": product.version,
                        "revision": saved["revision"],
                        "action": "submit",
                        "reason": "Synthetic commerce fixture",
                    },
                )
                product.refresh_from_db()
                catalogue.transition(
                    publisher,
                    product.pk,
                    {
                        "version": product.version,
                        "revision": saved["revision"],
                        "action": "publish",
                        "reason": "Synthetic commerce fixture",
                    },
                )
                for locale, title in [
                    (
                        "en",
                        "Synthetic long goods description with mixed identifiers ABC 123 and stable quantities " * 2,
                    ),
                    ("ps", "د ازموینې اوږد محصول د بل د کتنې لپاره ABC 123 " * 4),
                    ("ar", "منتج تجريبي طويل لفحص الفاتورة والأرقام ABC 123 " * 4),
                ]:
                    tr, _created = Translation.objects.get_or_create(revision_id=saved["revision"], locale=locale)
                    translations.edit(
                        publisher,
                        product.pk,
                        saved["revision"],
                        locale,
                        {
                            "version": tr.version,
                            "action": "save",
                            "title": title[:200],
                            "description": "Synthetic",
                            "image_alts": {str(image["id"]): "Synthetic commerce image"},
                        },
                    )
                    tr.refresh_from_db()
                    translations.edit(
                        publisher,
                        product.pk,
                        saved["revision"],
                        locale,
                        {"version": tr.version, "action": "approve", "reason": "Synthetic translation approval"},
                    )
                orders.set_terms(
                    owner,
                    profile.pk,
                    {
                        "version": 0,
                        "enabled": True,
                        "destinations": [{"country": "AF", "all_cities": True, "cities": []}],
                        "methods": ["advance", "cod"],
                        "reason": "Synthetic explicit terms",
                    },
                )
                for variant in product.variants.all():
                    inventory.configure(
                        owner,
                        profile.pk,
                        variant.pk,
                        {
                            "token": str(uuid.uuid4()),
                            "version": 0,
                            "tracking": "plain",
                            "expiry_required": False,
                            "threshold": "1.000",
                            "reason": "Synthetic configured stock",
                        },
                    )
                    inventory.manual(
                        owner,
                        profile.pk,
                        variant.pk,
                        {
                            "token": str(uuid.uuid4()),
                            "version": Position.objects.get(pk=variant.pk).version,
                            "quantity": "200.000",
                            "reason": "Synthetic received stock",
                        },
                    )
                if letter == "a":
                    buyer = actor(users["buyer"], "buyer")
                    for variant in product.variants.all():
                        existing = cart.buyer(buyer)
                        cart.mutate(
                            buyer.request,
                            buyer,
                            {
                                "command_id": uuid.uuid4(),
                                "version": existing.version if existing else 0,
                                "action": "set",
                                "variant": variant.pk,
                                "tier": "retail",
                                "quantity": "1.000",
                            },
                        )
                    current = cart.buyer(buyer)
                    orders.submit(
                        buyer,
                        {
                            "command_id": uuid.uuid4(),
                            "version": current.version,
                            "currency": "AFN",
                            "lines": list(current.lines.values_list("pk", flat=True)),
                            "choices": [{"seller": profile.pk, "country": "AF", "city": "Kabul", "method": "advance"}],
                            "locale": "en",
                        },
                    )
        staff = User.objects.create_user(
            "phase10-aftercare@example.test",
            password,
            display_name="آزمایشی • Synthetic aftercare staff",
            email_verified=True,
            is_staff=True,
        )
        Account.objects.create(user=staff, context="staff")
        staff.groups.add(
            *Group.objects.filter(
                name__in=[
                    "Rezayi: Aftercare metadata",
                    "Rezayi: Cancellation review",
                    "Rezayi: Amendment review",
                    "Rezayi: Goods refund review",
                ]
            )
        )
        with override_settings(OWNER_MFA_REQUIRED=False):
            buyer = actor(users["buyer"], "buyer")
            seller = actor(users["owner-a"], "seller")
            owner = actor(root, "owner")
            reviewer = actor(staff, "staff")
            cancellation_and_refund(buyer, seller, owner, reviewer)
            amendment_example(buyer, seller, owner, reviewer)
            delivery_refund_example(buyer, seller, owner)
        self.stdout.write(
            "Owned synthetic aftercare cancellation, amendment, goods refund and delivery refund examples prepared."
        )
        self.stdout.write(
            "Commerce synthetic seller terms, stock, role capabilities and retained multi-page invoice prepared."
        )
