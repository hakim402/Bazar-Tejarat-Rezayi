"""Synthetic delivery fixtures. Refuses every existing/private application DB."""

import json
import sys
import uuid
from datetime import timedelta
from django.conf import settings
from django.core.management import BaseCommand, CommandError, call_command
from django.contrib.auth.models import Group
from django.db import connection
from django.test import override_settings
from django.utils import timezone
from config.testing import assert_owned_database
from apps.accounts.models import User, Account
from apps.organizations.models import Membership, BusinessProfile
from apps.payments.management.commands.seed_payment_examples import example_order
from apps.messaging.management.commands.seed_messaging_examples import actor
from apps.payments import services as goods
from apps.payments.models import Finance
from apps.fulfilment import models as m, services, queries, transitions


@override_settings(OWNER_MFA_REQUIRED=False)
def command(order, principal, action, **data):
    assert_owned_database(connection)
    return services.mutate(
        principal,
        order.pk,
        action,
        {
            "command_id": uuid.uuid4(),
            "version": m.State.objects.filter(order=order).values_list("version", flat=True).first() or 0,
            "goods_version": Finance.objects.filter(order=order).values_list("version", flat=True).first() or 0,
            **data,
        },
    )


def review(case, principal, action="approve"):
    command(
        case.order,
        principal,
        "case_assign",
        case=case.pk,
        case_version=case.version,
        assigned_to=principal.user.pk,
        reason="Independent synthetic assignment",
    )
    case.refresh_from_db()
    return command(
        case.order,
        principal,
        "case_" + action,
        case=case.pk,
        case_version=case.version,
        reason="Independent synthetic delivery decision",
    )


@override_settings(OWNER_MFA_REQUIRED=False)
def example_delivery(method="cod", *, stage="prepared", charge="0.00", partial=False):
    assert_owned_database(connection)
    if settings.PRODUCTION or not settings.DEBUG:
        raise CommandError("Only owned development fixtures are permitted.")
    from apps.orders.models import SellerOrder

    value = example_order(method)
    order = SellerOrder.objects.get(pk=value["id"])
    buyer = actor(User.objects.get(email="phase12-buyer@example.test"), "buyer")
    seller = actor(User.objects.get(email="phase12-owner@example.test"), "seller")
    root = actor(User.objects.get(email="phase09-root@example.test"), "owner")
    if stage == "accepted":
        return value
    recipient = command(
        order,
        buyer,
        "recipient",
        recipient_revision=0,
        name="Synthetic delivery recipient",
        phone="000-TEST-ONLY",
        address="Synthetic private address — never real contact data",
        instructions="Synthetic manual handover",
        reason="Initial synthetic recipient",
    )
    arrangement = command(
        order,
        seller,
        "arrange",
        provider="Synthetic manual delivery provider",
        arranger="seller",
        self_delivery=False,
        instructions="Manual whole-order delivery",
    )
    if method == "advance":
        goods.mutate(
            seller,
            order.pk,
            "plan",
            {
                "command_id": uuid.uuid4(),
                "version": Finance.objects.get(order=order).version,
                "intent_version": 0,
                "reason": "Synthetic original whole hold",
                "lines": [{"variant": value["variant"], "batch": None, "quantity": "1.000"}],
            },
        )
        goods.mutate(
            seller,
            order.pk,
            "receipt",
            {
                "command_id": uuid.uuid4(),
                "version": Finance.objects.get(order=order).version,
                "amount": "5.00" if partial else "12.50",
                "currency": "AFN",
                "paid_at": timezone.now() - timedelta(minutes=1),
                "description": "Synthetic actual goods funds",
            },
        )
    data = {
        "recipient": recipient["recipient"],
        "arrangement": arrangement["arrangement"],
        "reason": "Whole synthetic preparation",
    }
    if method == "cod":
        data["lines"] = [{"variant": value["variant"], "batch": None, "quantity": "1.000"}]
    prepared = command(order, seller, "prepare", **data)
    command(
        order,
        seller,
        "charge",
        provider=arrangement["provider"],
        amount=charge,
        currency="AFN",
        reason="Separate synthetic delivery cost",
    )
    review(m.ReviewCase.objects.get(order=order, kind="charge"), root)
    if partial:
        command(order, seller, "partial", reason="Explicit positive partial advance permission")
    if stage in {"dispatched", "delivered", "completed"}:
        packet = transitions.packet(
            seller,
            order,
            m.State.objects.get(order=order),
            {"preparation": prepared["preparation"], "reason": "Exact synthetic whole dispatch"},
        )[0]
        services.mutate(seller, order.pk, "dispatch", {"command_id": uuid.uuid4(), **packet})
    if stage in {"delivered", "completed"}:
        command(order, buyer, "deliver", occurred_at=timezone.now(), reason="Synthetic actual whole delivery")
    value.update(charge_id=str(queries.current_charge(order).pk), preparation=prepared["preparation"])
    return value


class Command(BaseCommand):
    def add_arguments(self, parser):
        parser.add_argument("--stdin", action="store_true", required=True)

    def handle(self, **options):
        assert_owned_database(connection)
        if settings.PRODUCTION or not settings.DEBUG:
            raise CommandError("Only owned development fixtures are permitted.")
        password = json.load(sys.stdin)["password"]
        if User.objects.filter(email="phase13-logistics@example.test").exists():
            return
        call_command("setup_fulfilment_groups", verbosity=0)
        for name, context in [("logistics", "seller"), ("logistics-staff", "staff"), ("receipt-reviewer", "staff")]:
            user = User.objects.create_user(
                f"phase13-{name}@example.test",
                password,
                display_name="Synthetic delivery " + name,
                email_verified=True,
                is_staff=context == "staff",
            )
            account = Account.objects.create(user=user, context=context)
            if context == "seller":
                profile = BusinessProfile.objects.get(account__user__email="phase12-owner@example.test", kind="company")
                Membership.objects.create(company=profile, account=account, bundles=["fulfilment"])
            else:
                names = (
                    ["Delivery metadata", "Delivery logistics", "Delivery recipients"]
                    if name == "logistics-staff"
                    else ["Delivery metadata", "Delivery receipt review", "Delivery receipt corrections"]
                )
                user.groups.add(*Group.objects.filter(name__in=["Rezayi: " + value for value in names]))
        with override_settings(OWNER_MFA_REQUIRED=False):
            example_delivery("cod", stage="accepted")
            example_delivery("cod", stage="prepared", charge="5.00")
            example_delivery("advance", stage="prepared", partial=True)
        self.stdout.write("Owned synthetic delivery fixtures prepared; no real accounts or providers used.")
