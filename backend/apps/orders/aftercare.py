"""Shared aftercare eligibility and projection. Orders, payments, fulfilment and
the generated frontend contract all read these figures; eligibility is never
computed anywhere else."""

from decimal import Decimal

from django.db.models import Exists, F, OuterRef, Subquery, Sum
from django.db.models import Case, When
from django.db.models.functions import Coalesce

from .models import Amendment, CancellationRequest, InvoiceAdjustment

ZERO = Decimal("0.00")


def effective_lines(order):
    """Original lines stay frozen; approved changes accumulate per line."""
    rows = {line.pk: {"line": line, "quantity": line.quantity, "unit_price": line.unit_price} for line in order.lines.all()}
    from .models import AmendmentLine

    changes = AmendmentLine.objects.filter(amendment__order_id=order.pk, amendment__state="approved").order_by(
        "amendment__decision__event__version", "line_id"
    )
    for proposed in changes:
        current = rows[proposed.line_id]
        current["quantity"] = proposed.proposed_quantity
        current["unit_price"] = proposed.proposed_unit_price
    return [rows[pk] for pk in sorted(rows, key=lambda pk: str(pk))]


def approved_amendment(order):
    return (
        Amendment.objects.filter(order_id=order.pk, state="approved")
        .select_related("decision__event")
        .order_by("-decision__event__version")
        .first()
    )


def cancelled(order):
    if hasattr(order, "aftercare_cancelled"):
        return order.aftercare_cancelled
    return CancellationRequest.objects.filter(order_id=order.pk, state="approved").exists()


def pending_cancellation(order):
    if hasattr(order, "aftercare_pending"):
        return order.aftercare_pending
    return CancellationRequest.objects.filter(order_id=order.pk, state="pending").exists()


def pending_amendment(order):
    if hasattr(order, "amendment_pending"):
        return order.amendment_pending
    return Amendment.objects.filter(order_id=order.pk, state="pending").exists()


def dispatched(order):
    from apps.fulfilment.models import Shipment

    return Shipment.objects.filter(order_id=order.pk).exists()


def completed(order):
    from apps.fulfilment.models import Completion

    return Completion.objects.filter(order_id=order.pk).exists()


def accepted_total(order):
    """Effective accepted demand: zero once cancelled, otherwise the latest
    approved amendment total or the original accepted total."""
    if hasattr(order, "accepted_total"):
        return order.accepted_total
    if cancelled(order):
        return ZERO
    latest = approved_amendment(order)
    return latest.after_total if latest else order.goods_total


def refund_annotations():
    """Refund-due/confirmed annotation expressions shared by every projection."""
    from django.db.models import DecimalField

    from apps.payments.models import RefundDue, RefundReport

    money = DecimalField(max_digits=24, decimal_places=2)
    due = (
        RefundDue.objects.filter(order_id=OuterRef("pk"))
        .values("order_id")
        .annotate(total=Sum("amount"))
        .values("total")
    )
    confirmed = (
        RefundReport.objects.filter(due__order_id=OuterRef("pk"), decision__action="confirmed")
        .values("due__order_id")
        .annotate(total=Sum("amount"))
        .values("total")
    )
    return {
        "refund_due_total": Coalesce(Subquery(due[:1], output_field=money), ZERO, output_field=money),
        "refund_confirmed_total": Coalesce(Subquery(confirmed[:1], output_field=money), ZERO, output_field=money),
    }


def refund_figures(order):
    """Refunded and outstanding refund-due totals, separate from received."""
    from apps.payments.models import RefundDue, RefundReport

    if hasattr(order, "refund_due_total"):
        return {"refunded": order.refund_confirmed_total or ZERO, "due": order.refund_due_total or ZERO}
    refunded = (
        RefundReport.objects.filter(due__order_id=order.pk, decision__action="confirmed").aggregate(
            value=Sum("amount")
        )["value"]
        or ZERO
    )
    total = RefundDue.objects.filter(order_id=order.pk).aggregate(value=Sum("amount"))["value"] or ZERO
    return {"refunded": refunded, "due": total}


def money_figures(order, confirmed_received):
    """Received, refunded, refund due, remaining and excess as separate figures."""
    figures = refund_figures(order)
    total = accepted_total(order)
    return {
        "received": format(confirmed_received, ".2f"),
        "refunded": format(figures["refunded"], ".2f"),
        "refund_due": format(max(figures["due"] - figures["refunded"], ZERO), ".2f"),
        "remaining": format(max(total - confirmed_received, ZERO), ".2f"),
        "excess": format(max(confirmed_received - total, ZERO), ".2f"),
    }


def annotate(qs):
    """Accepted-total, cancellation and refund annotations for list/detail projections."""
    from django.db.models import DecimalField

    money = DecimalField(max_digits=24, decimal_places=2)
    latest = (
        Amendment.objects.filter(order_id=OuterRef("pk"), state="approved")
        .order_by("-decision__event__version")
        .values("after_total")[:1]
    )
    cancelled = Exists(CancellationRequest.objects.filter(order_id=OuterRef("pk"), state="approved"))
    pending = Exists(CancellationRequest.objects.filter(order_id=OuterRef("pk"), state="pending"))
    amendment_open = Exists(Amendment.objects.filter(order_id=OuterRef("pk"), state="pending"))
    return qs.annotate(
        aftercare_cancelled=cancelled,
        aftercare_pending=pending,
        amendment_pending=amendment_open,
        accepted_total=Case(
            When(cancelled, then=ZERO),
            default=Coalesce(Subquery(latest, output_field=money), F("goods_total")),
            output_field=money,
        ),
        **refund_annotations(),
    )


def eligibility(order):
    """Bounded aftercare action eligibility for the current order state."""
    already = cancelled(order)
    shipped = dispatched(order)
    finished = completed(order)
    return {
        "cancel": not already and not shipped and not finished and not pending_cancellation(order),
        "amend": not already and not shipped and not finished and not pending_amendment(order),
        "cancelled": already,
        "dispatched": shipped,
        "completed": finished,
        "pending_cancellation": pending_cancellation(order),
        "pending_amendment": pending_amendment(order),
    }


def before_lines_snapshot(order):
    from apps.foundation import money as exact

    return [
        {
            "line": str(item["line"].pk),
            "variant": str(item["line"].variant_id),
            "tier": item["line"].tier,
            "quantity": format(item["quantity"], ".3f"),
            "unit_price": format(item["unit_price"], ".2f"),
            "goods_amount": format(exact.line_amount(item["unit_price"], item["quantity"]), ".2f"),
        }
        for item in effective_lines(order)
    ]


def adjustment_rows(order):
    return [
        {
            "id": str(row.pk),
            "invoice": str(row.invoice_id),
            "cause": row.cause,
            "cancellation": str(row.cancellation_id) if row.cancellation_id else None,
            "amendment": str(row.amendment_id) if row.amendment_id else None,
            "before_lines": row.before_lines,
            "after_lines": row.after_lines,
            "before_total": format(row.before_total, ".2f"),
            "after_total": format(row.after_total, ".2f"),
            "reason": row.reason,
            "created_at": row.created_at,
        }
        for row in InvoiceAdjustment.objects.filter(order_id=order.pk).order_by("-created_at", "pk")[:50]
    ]
