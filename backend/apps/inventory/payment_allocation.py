"""Narrow sealed-order adapter. This is not a manual-stock permission or HTTP API."""

from dataclasses import dataclass
from decimal import Decimal
from django.db import connection
from rest_framework.exceptions import ValidationError
from apps.organizations.access import Conflict
from . import services as stock
from .models import Allocation, AllocationReduction, Bucket, Recovery, Shortage


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
    from apps.orders.aftercare import cancelled, effective_lines

    if cancelled(current.order):
        raise Conflict("A cancelled order cannot reserve stock.")
    demand = {}
    for item in effective_lines(current.order):
        variant = str(item["line"].variant_id)
        demand[variant] = demand.get(variant, Decimal(0)) + item["quantity"]
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


def release_whole(order, token, identity, reference):
    """Release one held advance allocation exactly once for a terminal aftercare decision.

    A missing or already-settled reservation is not an error: cash-less and
    already-consumed orders legitimately have nothing to release."""
    if not connection.in_atomic_block:
        raise RuntimeError("Whole release requires owned domain locks.")
    from apps.payments.models import AllocationIntent

    intent = (
        AllocationIntent.objects.select_for_update()
        .select_related("order__seller", "allocation")
        .filter(order_id=order.pk)
        .first()
    )
    if not intent or not intent.allocation_id or intent.state != "reserved":
        return None
    payload = {
        "token": str(token),
        "reference": reference,
        "reason": "Terminal aftercare released the unshipped advance reservation",
        "allocation": str(intent.allocation_id),
    }
    key, digest, old = stock.previous(identity, order.seller, "release", payload)
    if old is not None:
        return old
    return stock._apply_settlement(
        identity, order.seller, intent.allocation_id, payload, key, digest, release=True
    )


def release_partial(order, reductions, token, identity, reference, *, now=None):
    """Reduce an existing held allocation by exact per-variant quantities.

    Held stock is released from the allocation's tail buckets deterministically;
    the caller owns the amendment authority and the ordered locks."""
    from apps.payments.models import AllocationIntent

    if not connection.in_atomic_block:
        raise RuntimeError("Partial release requires owned domain locks.")
    intent = (
        AllocationIntent.objects.select_for_update().select_related("order__seller").filter(order_id=order.pk).first()
    )
    if not intent or not intent.allocation_id or intent.state != "reserved":
        # Cash-on-delivery and not-yet-reserved advance orders have no held
        # buckets: the amendment changes money and demand only.
        return None
    allocation = Allocation.objects.select_for_update().get(pk=intent.allocation_id)
    if allocation.state != "held":
        raise Conflict("This allocation is no longer held.")
    rows = stock.remaining_lines(allocation)
    by_variant = {}
    for row, remaining in rows:
        by_variant.setdefault(str(row.bucket.position_id), []).append((row, remaining))
    wanted = {}
    for variant_id, quantity in reductions.items():
        target = Decimal(str(quantity))
        if target <= 0:
            raise ValidationError({"reduction": ["positive_quantity"]})
        options = sorted(by_variant.get(variant_id, []), key=lambda pair: pair[0].bucket_id, reverse=True)
        for row, remaining in options:
            if target <= 0:
                break
            take = min(remaining, target)
            if take > 0:
                wanted[row.bucket_id] = wanted.get(row.bucket_id, Decimal("0.000")) + take
                target -= take
        if target > 0:
            raise Conflict("The held stock cannot cover the exact reduced quantity.")
    payload = {
        "token": str(token),
        "reference": reference,
        "reason": "Approved amendment partially released held stock",
        "lines": [
            {"variant": variant, "quantity": format(value, ".3f")} for variant, value in sorted(reductions.items())
        ],
    }
    key, digest, old = stock.previous(identity, order.seller, "reduce", payload)
    if old is not None:
        return old
    return _apply_reduction(identity, order.seller, payload, key, digest, allocation, wanted, now=now)


def _apply_reduction(identity, profile, payload, token, digest, allocation, wanted, *, now=None):
    selected = [(row, remaining) for row, remaining in stock.remaining_lines(allocation) if row.bucket_id in wanted]
    ids = sorted({row.bucket.position_id for row, _ in selected}, key=str)
    for pk in ids:
        stock.locked_variant(profile, pk)
    positions = list(stock.Position.objects.select_for_update().filter(pk__in=ids).order_by("pk"))
    buckets = {
        b.pk: b
        for b in Bucket.objects.select_related("batch")
        .select_for_update(**stock.row_options())
        .filter(pk__in=[row.bucket_id for row, _ in selected])
        .order_by("pk")
    }
    changes = []
    lines = []
    for row, remaining in selected:
        quantity = wanted[row.bucket_id]
        if quantity > remaining:
            raise Conflict("The reduction exceeds the held quantity.")
        changes.append((buckets[row.bucket_id], quantity))
        lines.append(
            {
                "variant": str(row.bucket.position_id),
                "batch": str(row.bucket.batch_id) if row.bucket.batch_id else None,
                "quantity": format(quantity, ".3f"),
            }
        )
    result = {
        "operation": str(token),
        "status": "reduced",
        "allocation": str(allocation.pk),
        "lines": lines,
    }
    operation = stock.record(
        identity,
        profile,
        "reduce",
        payload,
        token,
        digest,
        result,
        [(bucket, stock.ZERO, -quantity) for bucket, quantity in changes],
    )
    for bucket, quantity in changes:
        AllocationReduction.objects.create(allocation=allocation, operation=operation, bucket=bucket, quantity=quantity)
    for position in positions:
        stock.bump(position)
    return result
