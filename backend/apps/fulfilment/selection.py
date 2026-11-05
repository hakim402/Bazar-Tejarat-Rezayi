"""Accepted whole demand and explicit stock options; never creates stock on reads."""

from decimal import Decimal
from rest_framework.exceptions import ValidationError
from django.db.models import Sum, Q
from apps.inventory import services as stock, validation as quantities
from apps.inventory.models import Bucket, Allocation
from apps.organizations.access import Conflict
from apps.payments.models import AllocationIntent
from . import models as m, validation as v


class HeldStockUnavailable(ValidationError):
    """An original hold needs review, not a different seller selection."""


def demand(order):
    return {
        row["variant_id"]: row["quantity"]
        for row in order.lines.values("variant_id").annotate(quantity=Sum("quantity"))
    }


def held(order, *, locked=False):
    qs = AllocationIntent.objects.select_related("allocation")
    if locked:
        qs = qs.select_for_update()
    intent = qs.filter(order=order).first()
    if not intent or not intent.allocation_id:
        raise Conflict("A complete goods-payment reservation is required.")
    allocation = Allocation.objects.select_for_update().get(pk=intent.allocation_id) if locked else intent.allocation
    if allocation.state != "held":
        raise Conflict("The original whole reservation is no longer held.")
    return allocation


def plan(order, lines, *, now=None):
    normalized = stock.normalize_lines(lines)
    wanted = demand(order)
    totals = {}
    rows = []
    buckets = Bucket.objects.select_related(
        "batch", "position__variant__unit", "position__variant__product__published"
    ).filter(position_id__in=wanted)
    index = {(b.position_id, b.batch_id): b for b in buckets}
    for offset, variant, batch, raw in normalized:
        b = index.get((variant, batch))
        if b is None:
            v.fail(f"lines.{offset}", "accepted_bucket_scope")
        q = quantities.quantity(raw, b.position.variant, f"lines.{offset}.quantity")
        if stock.expired(b, now) or not stock.active(b.position.variant):
            v.fail(f"lines.{offset}", "expired_or_inactive")
        totals[variant] = totals.get(variant, Decimal(0)) + q
        rows.append((b, q))
    if totals != wanted:
        v.fail("lines", "complete_accepted_quantities")
    return rows


def prepared_lines(order, data, *, now=None):
    allocation = None
    if order.payment_method == "advance":
        allocation = held(order, locked=True)
        rows = list(
            allocation.lines.select_related(
                "bucket__batch", "bucket__position__variant__unit", "bucket__position__variant__product__published"
            ).order_by("bucket__position_id", "bucket_id")
        )
        lines = [
            {
                "variant": str(x.bucket.position_id),
                "batch": str(x.bucket.batch_id) if x.bucket.batch_id else None,
                "quantity": format(x.quantity, ".3f"),
            }
            for x in rows
        ]
        if data.get("lines") is not None and v.canonical(data["lines"]) != v.canonical(lines):
            v.fail("lines", "exact_existing_hold")
        if any(stock.expired(row.bucket, now) or not stock.active(row.bucket.position.variant) for row in rows):
            raise HeldStockUnavailable({"lines": ["expired_or_inactive"]})
    else:
        lines = data.get("lines")
    return allocation, plan(order, lines, now=now)


def store(preparation, rows):
    for bucket, quantity in rows:
        m.PreparationLine.objects.create(
            preparation=preparation, variant_id=bucket.position_id, bucket=bucket, quantity=quantity
        )


def display(preparation):
    accepted = {line.variant_id: line.snapshot for line in preparation.order.lines.all()}
    return [
        {
            "variant": str(row.variant_id),
            "bucket": str(row.bucket_id),
            "batch": str(row.bucket.batch_id) if row.bucket.batch_id else None,
            "batch_code": row.bucket.batch.code if row.bucket.batch_id else "",
            "expires_on": row.bucket.batch.expires_on if row.bucket.batch_id else None,
            "quantity": format(row.quantity, ".3f"),
            "sku": accepted[row.variant_id].get("sku", ""),
            "unit": accepted[row.variant_id].get("unit", ""),
            "unit_labels": accepted[row.variant_id].get("unit_labels", {}),
        }
        for row in preparation.lines.select_related("bucket__batch").order_by("variant_id", "bucket_id")
    ]


def options(order, *, page=1, q=""):
    wanted = demand(order)
    accepted = {line.variant_id: line.snapshot for line in order.lines.all()}
    qs = (
        Bucket.objects.filter(position_id__in=wanted)
        .select_related("batch", "position__variant__unit", "position__variant__product__published")
        .order_by("position_id", "pk")
    )
    if q:
        qs = qs.filter(Q(batch__code__icontains=q) | Q(position__variant__sku__icontains=q))
    return {
        "count": qs.count(),
        "page": page,
        "results": [
            {
                "variant": str(b.position_id),
                "bucket": str(b.pk),
                "batch": str(b.batch_id) if b.batch_id else None,
                "batch_code": b.batch.code if b.batch_id else "",
                "expires_on": b.batch.expires_on if b.batch_id else None,
                "available": format(
                    b.physical - b.held if not stock.expired(b) and stock.active(b.position.variant) else Decimal(0),
                    ".3f",
                ),
                "required": format(wanted[b.position_id], ".3f"),
                "sku": accepted[b.position_id].get("sku", ""),
                "unit": accepted[b.position_id].get("unit", ""),
                "unit_labels": accepted[b.position_id].get("unit_labels", {}),
            }
            for b in qs[(page - 1) * 50 : page * 50]
        ],
    }


def held_display(order):
    """Exact current retained hold for a permitted preparation review."""
    from apps.payments.models import AllocationIntent

    intent = AllocationIntent.objects.select_related("allocation").filter(order=order).first()
    if not intent or not intent.allocation_id:
        return []
    accepted = {line.variant_id: line.snapshot for line in order.lines.all()}
    return [
        {
            "variant": str(row.bucket.position_id),
            "bucket": str(row.bucket_id),
            "batch": str(row.bucket.batch_id) if row.bucket.batch_id else None,
            "quantity": format(row.quantity, ".3f"),
            "batch_code": row.bucket.batch.code if row.bucket.batch_id else "",
            "expires_on": row.bucket.batch.expires_on if row.bucket.batch_id else None,
            "sku": accepted[row.bucket.position_id].get("sku", ""),
            "unit": accepted[row.bucket.position_id].get("unit", ""),
            "unit_labels": accepted[row.bucket.position_id].get("unit_labels", {}),
        }
        for row in intent.allocation.lines.select_related("bucket__batch").order_by("bucket__position_id", "bucket_id")
    ]
