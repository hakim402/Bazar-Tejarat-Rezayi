"""Narrow sealed-order adapter. This is not a manual-stock permission or HTTP API."""

from dataclasses import dataclass
from django.db import connection
from django.db.models import Sum
from rest_framework.exceptions import ValidationError
from apps.organizations.access import Conflict
from . import services as stock
from .models import Recovery, Shortage


@dataclass(frozen=True)
class RecordedIdentity:
    """Historical provenance only: no request, grant or actor authorization API."""

    user: object
    account: object
    context: str


def reserve(intent, plan, token, *, now=None):
    from apps.payments.models import AllocationIntent, Receipt, StockPlan
    from apps.payments.queries import confirmed

    if not connection.in_atomic_block:
        raise RuntimeError("Payment allocation requires owned domain locks.")
    current = (
        AllocationIntent.objects.select_for_update()
        .select_related("order__seller", "first_receipt__actor__user")
        .get(order_id=intent.order_id)
    )
    if (
        current.plan_id != plan.pk
        or current.allocation_id
        or current.state != "pending"
        or current.order.payment_method != "advance"
        or confirmed(current.order) <= 0
    ):
        raise Conflict("The retained payment intent is not executable.")
    if (
        not Receipt.objects.filter(pk=current.first_receipt_id).exists()
        or not StockPlan.objects.filter(pk=plan.pk, order_id=current.order_id).exists()
    ):
        raise Conflict()
    demand = {
        str(row["variant_id"]): row["quantity"]
        for row in current.order.lines.values("variant_id").annotate(quantity=Sum("quantity"))
    }
    quantities = {}
    lines = []
    for line in plan.lines.order_by("variant_id", "batch_id"):
        quantities[str(line.variant_id)] = quantities.get(str(line.variant_id), 0) + line.quantity
        lines.append(
            {
                "variant": str(line.variant_id),
                "batch": str(line.batch_id) if line.batch_id else None,
                "quantity": format(line.quantity, ".3f"),
            }
        )
    if quantities != demand or not 1 <= len(lines) <= 100:
        raise ValidationError({"lines": ["complete_accepted_quantities"]})
    latest = (
        current.attempts.filter(shortage__isnull=False)
        .select_related("shortage__recovery_of")
        .order_by("-number")
        .first()
    )
    recovery = latest.shortage if latest else None
    if plan.replaces_id:
        if not plan.case.state == "approved" or not recovery:
            raise Conflict("Independent replacement approval is required.")
        if not current.attempts.filter(shortage_id=plan.replaces_id).exists():
            raise Conflict()
    elif recovery and recovery.operation.parameters.get("lines") != lines:
        raise Conflict("An unchanged recovery must keep its original selection.")
    root = recovery
    while root and root.recovery_of_id:
        root = root.recovery_of
    if root:
        Shortage.objects.select_for_update().get(pk=root.pk)
        if Recovery.objects.filter(shortage=root).exists():
            raise Conflict("A successful recovery already exists.")
    receipt = current.first_receipt
    identity = RecordedIdentity(receipt.actor.user, receipt.actor, "seller")
    payload = {
        "token": token,
        "reference": "goods-payment:" + str(token),
        "reason": "Sealed advance order reservation",
        "lines": lines,
    }
    if recovery:
        payload["recovery_of"] = str(recovery.pk)
    # The executor acquired this exact token BEFORE profile/financial locks.
    key, digest, old = stock.previous(identity, current.order.seller, "reserve", payload)
    if old is not None:
        return old
    return stock._apply_allocation(
        identity, current.order.seller, "reserve", payload, key, digest, recovery=recovery, now=now
    )
