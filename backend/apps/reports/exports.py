"""Bounded CSV exports of existing facts. Every export is audited before it is returned."""

import csv
import io

from django.http import HttpResponse
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.accounts.models import AuditEvent
from apps.orders import aftercare
from apps.orders.models import SellerOrder
from apps.payments import queries as goods_queries
from apps.payments.models import Receipt, RefundReport

from .queries import money, within

MAX_ROWS = 10000
DANGEROUS = ("=", "+", "-", "@", "\t", "\r")
SECTION = {"orders": "orders", "payments": "finance", "refunds": "finance"}


def cell(value):
    text = "" if value is None else str(value)
    # Spreadsheet formula injection: neutralize leading formula characters.
    return "'" + text if text.startswith(DANGEROUS) else text


def stamp(value):
    return timezone.localtime(value).isoformat(timespec="seconds") if value else ""


def order_rows(orders, window):
    header = ["order", "accepted_at", "currency", "payment_method", "goods_total", "accepted_total", "cancelled"]
    rows = aftercare.annotate(orders.filter(**within("accepted_at", window))).order_by("accepted_at", "pk")
    return header, (
        [row.pk, stamp(row.accepted_at), row.currency, row.payment_method, money(row.goods_total),
         money(row.accepted_total), "yes" if row.aftercare_cancelled else "no"]
        for row in rows[: MAX_ROWS + 1]
    )


def payment_rows(orders, window):
    header = ["receipt", "order", "recorded_at", "paid_at", "currency", "effective_amount"]
    rows = goods_queries.effective_receipts(
        Receipt.objects.filter(order__in=orders.values("pk"), **within("created_at", window))
    ).order_by("created_at", "pk")
    return header, (
        [row.pk, row.order_id, stamp(row.created_at), stamp(row.paid_at), row.currency, money(row.effective_amount)]
        for row in rows[: MAX_ROWS + 1]
    )


def refund_rows(orders, window):
    header = ["refund_report", "order", "cause", "confirmed_at", "currency", "amount"]
    rows = (
        RefundReport.objects.filter(
            due__order__in=orders.values("pk"), decision__action="confirmed", **within("decision__created_at", window)
        )
        .select_related("due", "decision")
        .order_by("decision__created_at", "pk")
    )
    return header, (
        [row.pk, row.due.order_id, row.due.cause, stamp(row.decision.created_at), row.due.currency, money(row.amount)]
        for row in rows[: MAX_ROWS + 1]
    )


BUILDERS = {"orders": order_rows, "payments": payment_rows, "refunds": refund_rows}


def render(kind, orders, window):
    header, rows = BUILDERS[kind](orders, window)
    rows = list(rows)
    if len(rows) > MAX_ROWS:
        raise ValidationError({"start": ["too_many_rows"]})
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(header)
    writer.writerows([cell(value) for value in row] for row in rows)
    return "\ufeff" + buffer.getvalue(), len(rows)


def response(content, filename):
    result = HttpResponse(content, content_type="text/csv; charset=utf-8")
    result["Content-Disposition"] = f'attachment; filename="{filename}"'
    result["Cache-Control"] = "no-store"
    result["X-Content-Type-Options"] = "nosniff"
    return result


def seller_export(actor, profile, rights, kind, window):
    if not rights.get(SECTION[kind]):
        raise PermissionDenied()
    content, count = render(kind, SellerOrder.objects.filter(seller=profile), window)
    AuditEvent.objects.create(
        actor=actor.user, account=actor.account, context="seller", action="seller_report_exported",
        resource_type="organizations.businessprofile", resource_id=profile.pk, reason="Seller report export",
        state={"kind": kind, "start": window["start"].isoformat(), "end": window["end"].isoformat(), "rows": count},
    )
    return response(content, f"{kind}-{window['start']}-{window['end']}.csv")


def platform_export(request, kind, window):
    content, count = render(kind, SellerOrder.objects.all(), window)
    AuditEvent.objects.create(
        actor=request.user, context="owner", action="owner_report_exported", resource_type="reports.platform",
        reason="Platform report export",
        state={"kind": kind, "start": window["start"].isoformat(), "end": window["end"].isoformat(), "rows": count},
    )
    return response(content, f"platform-{kind}-{window['start']}-{window['end']}.csv")
