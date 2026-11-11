"""Read-only seller issue queue: filter before pagination, preserving domain permissions."""
from django.db.models import CharField, Exists, F, OuterRef, Q, Value
from . import access, aftercare as projection
from .models import Amendment, CancellationRequest, DisputeRequest


def page(actor, *, seller=None, tab="attention", q="", page=1):
    from apps.payments import access as payment_access
    from apps.payments.models import RefundDue, RefundReport
    from apps.payments.queries import due_state
    from apps.fulfilment.models import DeliveryRefund
    from apps.verification.models import ReviewCase

    orders = access.scope(actor, invoices=True, seller=seller)
    if q:
        orders = orders.filter(Q(invoice__number__icontains=q) | Q(buyer__user__display_name__icontains=q))
    dues = RefundDue.objects.filter(order__in=orders)
    disputes = DisputeRequest.objects.filter(order__in=orders)
    if tab == "attention":
        # Match payment_access.capabilities()['refund'] and due_state without loading every order.
        financial = payment_access.profiles(actor.account).annotate(
            approved=Exists(ReviewCase.objects.filter(profile_id=OuterRef("pk"), revision=OuterRef("revision"), status="approved"))
        ).filter(approved=True)
        dues = dues.filter(order__seller_id__in=financial.values("pk")).annotate(
            confirmed=Exists(RefundReport.objects.filter(due_id=OuterRef("pk"), decision__action="confirmed")),
            reported=Exists(RefundReport.objects.filter(due_id=OuterRef("pk"), decision__isnull=True)),
        ).filter(confirmed=False, reported=False)
        disputes = disputes.filter(state="pending", response__isnull=True, order__seller_id__in=access.profiles(actor.account).values("pk"))

    sources = {
        "cancellation": (CancellationRequest.objects.filter(order__in=orders), "order_id", "created_at"),
        "correction": (Amendment.objects.filter(order__in=orders), "order_id", "created_at"),
        "refund_due": (dues, "order_id", "created_at"),
        "refund_report": (RefundReport.objects.filter(due__order__in=orders), "due__order_id", "sent_at"),
        "delivery_refund": (DeliveryRefund.objects.filter(order__in=orders), "order_id", "sent_at"),
        "dispute": (disputes, "order_id", "created_at"),
    }
    kinds = {
        "attention": ("refund_due", "dispute"),
        "cancellations": ("cancellation",),
        "corrections": ("correction",),
        "refunds": ("refund_due", "refund_report", "delivery_refund"),
        "disputes": ("dispute",),
    }[tab]
    parts = []
    for kind in kinds:
        queryset, order_path, date_path = sources[kind]
        parts.append(queryset.order_by().annotate(
            issue_kind=Value(kind, output_field=CharField(max_length=20)),
            issue_id=F("pk"), issue_order=F(order_path), issue_date=F(date_path),
        ).values("issue_kind", "issue_id", "issue_order", "issue_date"))
    queue = parts[0].union(*parts[1:], all=True) if len(parts) > 1 else parts[0]
    count = queue.count()
    entries = list(queue.order_by("-issue_date", "issue_kind", "issue_id")[(page - 1) * 20:page * 20])
    selected_orders = {
        row.pk: row for row in orders.filter(pk__in=[entry["issue_order"] for entry in entries]).select_related("invoice", "seller")
    }
    records = {}
    for kind in kinds:
        ids = [entry["issue_id"] for entry in entries if entry["issue_kind"] == kind]
        queryset = sources[kind][0]
        if kind in {"refund_report", "delivery_refund", "dispute"}:
            queryset = queryset.select_related("decision")
        if kind == "dispute":
            queryset = queryset.select_related("response")
        records[kind] = {row.pk: row for row in queryset.filter(pk__in=ids)}
    results = []
    permissions = {}
    for entry in entries:
        kind = entry["issue_kind"]
        row = records[kind].get(entry["issue_id"])
        order = selected_orders.get(entry["issue_order"])
        if row is None or order is None:
            continue  # A concurrent deletion or scope revocation is never replaced by another record.
        if order.pk not in permissions:
            permissions[order.pk] = payment_access.capabilities(actor, order)["refund"]
        actionable = False
        amount = None
        if kind == "cancellation":
            amount, state = projection.accepted_total(order), row.state
        elif kind == "correction":
            amount, state = row.after_total, row.state
        elif kind == "refund_due":
            amount, state = row.amount, due_state(row)
            actionable = permissions[order.pk] and state == "due"
        elif kind in {"refund_report", "delivery_refund"}:
            decision = getattr(row, "decision", None)
            amount, state = row.amount, decision.action if decision else "pending"
        else:
            decision = getattr(row, "decision", None)
            amount, state = decision.amount if decision else None, row.state
            actionable = bool(row.state == "pending" and getattr(row, "response", None) is None and access.profiles(actor.account).filter(pk=order.seller_id).exists())
        results.append({
            "key": f"{kind}:{row.pk}", "kind": kind,
            "order": {"id": order.pk, "seller": order.seller_id, "number": order.invoice.number,
                      "buyer_name": order.snapshot.get("buyer", ""), "currency": order.currency},
            "amount": format(amount, ".2f") if amount is not None else None,
            "state": state, "date": entry["issue_date"], "actionable": actionable,
            "dispute_id": row.pk if kind == "dispute" else None,
        })
    return {"count": count, "page": page, "results": results}
