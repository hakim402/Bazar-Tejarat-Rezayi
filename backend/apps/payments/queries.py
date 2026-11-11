"""Exact indexed projections; GET never initializes financial records."""

from decimal import Decimal
from django.db.models import OuterRef, Subquery, Sum, Value, F, DecimalField, IntegerField, DateTimeField, Count, Q
from django.db.models.functions import Coalesce
from django.shortcuts import get_object_or_404
from django.utils import timezone
from apps.orders import aftercare
from . import access
from .models import (
    Finance,
    Receipt,
    Correction,
    Extension,
    AllocationIntent,
    ReviewCase,
    Claim,
    Event,
    RefundDecision,
    RefundReport,
)

MONEY = DecimalField(max_digits=24, decimal_places=2)


def effective_receipts(qs=None):
    approved = Correction.objects.filter(
        receipt_id=OuterRef("pk"), case__state="approved", case__events__action="approve"
    ).order_by("-target_version")
    qs = qs if qs is not None else Receipt.objects.all()
    return qs.annotate(
        effective_amount=Coalesce(Subquery(approved.values("amount")[:1]), F("amount"), output_field=MONEY),
        effective_time=Coalesce(Subquery(approved.values("paid_at")[:1]), F("paid_at")),
        effective_description=Coalesce(Subquery(approved.values("description")[:1]), F("description")),
        effective_version=Coalesce(Subquery(approved.values("target_version")[:1]), Value(0)) + 1,
        review_state=Coalesce(
            Subquery(ReviewCase.objects.filter(receipt_id=OuterRef("pk"), kind="receipt").values("state")[:1]),
            Value("pending"),
        ),
    )


def confirmed(order):
    return effective_receipts(Receipt.objects.filter(order_id=order.pk)).aggregate(value=Sum("effective_amount"))[
        "value"
    ] or Decimal("0.00")


def deadline(order):
    extension = Extension.objects.filter(order_id=order.pk).order_by("-generation").first()
    return (extension.due_at, extension.generation) if extension else (order.due_at, 1)


def annotate(qs):
    ledger = (
        effective_receipts(Receipt.objects.filter(order_id=OuterRef("pk")))
        .values("order_id")
        .annotate(total=Sum("effective_amount"))
        .values("total")
    )
    extension = Extension.objects.filter(order_id=OuterRef("pk")).order_by("-generation")
    state = Finance.objects.filter(order_id=OuterRef("pk"))
    allocation = AllocationIntent.objects.filter(order_id=OuterRef("pk"))
    pending_claims = (
        Claim.objects.filter(order_id=OuterRef("pk"), decision__isnull=True)
        .values("order_id")
        .annotate(total=Count("pk"))
        .values("total")
    )
    open_cases = (
        ReviewCase.objects.filter(order_id=OuterRef("pk"), state="open")
        .values("order_id")
        .annotate(total=Count("pk"))
        .values("total")
    )
    return aftercare.annotate(qs).annotate(
        payment_total=Coalesce(Subquery(ledger[:1]), Value(Decimal("0.00")), output_field=MONEY),
        payment_version=Coalesce(Subquery(state.values("version")[:1]), Value(0), output_field=IntegerField()),
        payment_due=Coalesce(Subquery(extension.values("due_at")[:1]), F("due_at"), output_field=DateTimeField()),
        payment_generation=Coalesce(
            Subquery(extension.values("generation")[:1]), Value(1), output_field=IntegerField()
        ),
        payment_allocation_state=Subquery(allocation.values("state")[:1]),
        payment_actual_allocation=Subquery(allocation.values("allocation__state")[:1]),
        payment_pending_claims=Coalesce(Subquery(pending_claims[:1]), Value(0), output_field=IntegerField()),
        payment_open_cases=Coalesce(Subquery(open_cases[:1]), Value(0), output_field=IntegerField()),
    )


def projection(order):
    if not hasattr(order, "payment_total"):
        order = annotate(type(order).objects.filter(pk=order.pk)).get()
    paid = order.payment_total
    figures = aftercare.money_figures(order, paid)
    remaining = Decimal(figures["remaining"])
    excess = Decimal(figures["excess"])
    return {
        "accepted_total": format(aftercare.accepted_total(order), ".2f"),
        "confirmed_total": format(paid, ".2f"),
        "received": figures["received"],
        "refunded": figures["refunded"],
        "refund_due": figures["refund_due"],
        "refundable_excess": format(max(excess - order.refund_due_total, Decimal("0.00")), ".2f"),
        "remaining": figures["remaining"],
        "overpayment": figures["excess"],
        "financial": "unpaid" if paid == 0 else "overpaid" if excess else "partial" if remaining else "paid",
        "allocation": order.payment_actual_allocation
        if order.payment_actual_allocation in {"consumed", "released"}
        else order.payment_allocation_state or "unreserved",
        "original_due_at": order.due_at,
        "effective_due_at": order.payment_due,
        "deadline_generation": order.payment_generation,
        "version": order.payment_version,
        "overdue": bool(order.payment_due and order.payment_due <= timezone.now() and remaining > 0),
        "pending_claims": getattr(order, "payment_pending_claims", 0) or 0,
        "review_pending": getattr(order, "payment_open_cases", 0) or 0,
    }


def row(actor, order):
    return {
        "id": str(order.pk),
        "seller": str(order.seller_id),
        "buyer": str(order.buyer_id),
        "number": order.invoice.number,
        "invoice": str(order.invoice.pk),
        "currency": order.currency,
        "goods_total": format(order.goods_total, ".2f"),
        "payment_method": order.payment_method,
        "seller_name": order.snapshot.get("seller", ""),
        "buyer_name": order.snapshot.get("buyer", ""),
        **projection(order),
        "capabilities": access.capabilities(actor, order),
    }


def page(actor, *, page=1, seller=None, state="", q=""):
    qs = (
        annotate(access.scope(actor, seller=seller))
        .select_related("invoice", "seller__account", "buyer__user")
        .order_by("-accepted_at", "pk")
    )
    if q:
        qs = qs.filter(
            Q(invoice__number__icontains=q) | Q(buyer__user__display_name__icontains=q)
        )
    if state == "overdue":
        qs = qs.filter(payment_due__lte=timezone.now(), payment_total__lt=F("accepted_total"))
    elif state == "unpaid":
        qs = qs.filter(payment_total=0)
    elif state == "partial":
        qs = qs.filter(payment_total__gt=0, payment_total__lt=F("accepted_total"))
    elif state == "paid":
        qs = qs.filter(payment_total=F("accepted_total"))
    elif state == "overpaid":
        qs = qs.filter(payment_total__gt=F("accepted_total"))
    return {"count": qs.count(), "page": page, "results": [row(actor, x) for x in qs[(page - 1) * 20 : page * 20]]}


def evidence_ids(obj):
    return [str(x.evidence_id) for x in obj.evidence_bindings.all()]


def claim_row(claim):
    decision = getattr(claim, "decision", None)
    if decision and decision.action == "confirmed" and getattr(getattr(claim, "receipt", None), "seal", None) is None:
        decision = None
    state = decision.action if decision else "pending"
    return {
        "id": str(claim.pk),
        "previous": str(claim.previous_id) if claim.previous_id else None,
        "replacement": str(claim.replacement.pk) if getattr(claim, "replacement", None) else None,
        "amount": format(claim.amount, ".2f"),
        "currency": claim.currency,
        "paid_at": claim.paid_at,
        "description": claim.description,
        "state": state,
        "version": 2 if decision else 1,
        "reason": decision.reason if decision else "",
        "evidence": evidence_ids(claim),
        "created_at": claim.created_at,
    }


def receipt_row(receipt):
    return {
        "id": str(receipt.pk),
        "claim": str(receipt.claim_id) if receipt.claim_id else None,
        "original_amount": format(receipt.amount, ".2f"),
        "amount": format(receipt.effective_amount, ".2f"),
        "currency": receipt.currency,
        "paid_at": receipt.effective_time,
        "description": receipt.effective_description,
        "version": receipt.effective_version,
        "evidence": evidence_ids(receipt) or (evidence_ids(receipt.claim) if receipt.claim_id else []),
        "review": getattr(receipt, "review_state", "pending"),
        "created_at": receipt.created_at,
    }


def plan_lines(plan, accepted_goods=None):
    if accepted_goods is None:
        accepted_goods = {str(line.variant_id): line.snapshot for line in plan.order.lines.all()}
    return [
        {
            "variant": str(line.variant_id),
            "sku": accepted_goods[str(line.variant_id)].get("sku", ""),
            "unit": accepted_goods[str(line.variant_id)].get("unit", ""),
            "unit_labels": accepted_goods[str(line.variant_id)].get("unit_labels", {}),
            "batch_code": line.batch.code if line.batch_id else "",
            "expires_on": line.batch.expires_on if line.batch_id else None,
            "batch": str(line.batch_id) if line.batch_id else None,
            "quantity": format(line.quantity, ".3f"),
        }
        for line in plan.lines.all()
    ]


def detail(actor, pk, *, page=1, seller=None):
    order = get_object_or_404(
        annotate(access.scope(actor, seller=seller)).select_related("invoice", "seller__account"), pk=pk
    )
    result = row(actor, order)
    result.update(
        claims=[],
        receipts=[],
        corrections=[],
        cases=[],
        extensions=[],
        plans=[],
        history=[],
        history_count=0,
        history_page=page,
        selection=None,
        refund_dues=[],
        refund_reports=[],
    )
    if not result["capabilities"]["details"]:
        return result
    claims = (
        order.payment_claims.select_related("decision", "receipt__seal", "replacement")
        .prefetch_related("evidence_bindings")
        .order_by("-created_at", "pk")
    )
    receipts = (
        effective_receipts(Receipt.objects.filter(order=order))
        .select_related("claim")
        .prefetch_related("evidence_bindings", "claim__evidence_bindings")
        .order_by("-created_at", "pk")
    )
    result["claims"] = [claim_row(x) for x in claims[(page - 1) * 20 : page * 20]]
    result["receipts"] = [receipt_row(x) for x in receipts[(page - 1) * 20 : page * 20]]
    corrections = (
        Correction.objects.filter(receipt__order=order, case__isnull=False)
        .select_related("case")
        .prefetch_related("evidence_bindings")
        .order_by("-created_at", "pk")
    )
    result["corrections"] = [
        {
            "id": str(x.pk),
            "receipt": str(x.receipt_id),
            "target_version": x.target_version,
            "amount": format(x.amount, ".2f"),
            "paid_at": x.paid_at,
            "description": x.description,
            "reason": x.reason,
            "state": x.case.state,
            "case": str(x.case.pk),
            "evidence": evidence_ids(x),
        }
        for x in corrections[(page - 1) * 20 : page * 20]
    ]
    result["cases"] = [
        {
            "id": str(x.pk),
            "kind": x.kind,
            "state": x.state,
            "version": x.version,
            "assigned": x.assigned_to_id is not None,
        }
        for x in order.payment_cases.order_by("-created_at", "pk")[(page - 1) * 20 : page * 20]
    ]
    result["extensions"] = [
        {"id": str(x.pk), "before_at": x.before_at, "due_at": x.due_at, "reason": x.reason, "generation": x.generation}
        for x in order.due_extensions.order_by("-generation")[(page - 1) * 20 : page * 20]
    ]
    from django.db.models import Prefetch
    from .models import StockPlanLine

    accepted_goods = {str(line.variant_id): line.snapshot for line in order.lines.all()}
    plans = order.payment_plans.prefetch_related(
        Prefetch("lines", queryset=StockPlanLine.objects.select_related("batch"))
    ).order_by("-created_at", "pk")
    result["plans"] = [
        {
            "id": str(x.pk),
            "replaces": str(x.replaces_id) if x.replaces_id else None,
            "intent_version": x.intent_version,
            "reason": x.reason,
            "state": getattr(getattr(x, "case", None), "state", "original"),
            "lines": plan_lines(x, accepted_goods),
        }
        for x in plans[(page - 1) * 20 : page * 20]
    ]
    events = Event.objects.filter(order=order).order_by("-version")
    result["history_count"] = events.count()
    result["history"] = [
        {
            "id": str(x.pk),
            "version": x.version,
            "action": x.action,
            "context": x.context,
            "actor": str(x.actor_id) if x.actor_id else None,
            "created_at": x.created_at,
        }
        for x in events[(page - 1) * 50 : page * 50]
    ]
    intent = AllocationIntent.objects.filter(order=order).first()
    if intent:
        result["selection"] = {
            "state": intent.state,
            "version": intent.version,
            "plan": str(intent.plan_id) if intent.plan_id else None,
            "allocation": str(intent.allocation_id) if intent.allocation_id else None,
            "shortage": str(
                intent.attempts.filter(shortage__isnull=False)
                .order_by("-number")
                .values_list("shortage_id", flat=True)
                .first()
                or ""
            ),
        }
    result["refund_dues"] = [
        {
            "id": str(due.pk),
            "cause": due.cause,
            "amount": format(due.amount, ".2f"),
            "currency": due.currency,
            "assigned": due.assigned_to_id is not None,
            "version": due.version,
            **due_status(due, can_report=result["capabilities"]["refund"]),
            "created_at": due.created_at,
        }
        for due in order.refund_dues.prefetch_related("reports__decision").order_by("-created_at", "pk")[
            (page - 1) * 20 : page * 20
        ]
    ]
    reports = (
        RefundReport.objects.filter(due__order=order)
        .select_related("due", "decision")
        .prefetch_related("evidence_bindings")
        .order_by("-created_at", "pk")[(page - 1) * 20 : page * 20]
    )
    result["refund_reports"] = [
        {
            "id": str(report.pk),
            "due": str(report.due_id),
            "previous": str(report.previous_id) if report.previous_id else None,
            "amount": format(report.amount, ".2f"),
            "sent_at": report.sent_at,
            "reference": report.reference,
            "description": report.description,
            "state": report.decision.action if getattr(report, "decision", None) else "pending",
            "reason": report.decision.reason if getattr(report, "decision", None) else "",
            "evidence": evidence_ids(report) if result["capabilities"]["evidence"] else [],
            "can_withdraw": bool(
                result["capabilities"]["refund"] and report.actor_id == getattr(actor.account, "pk", None)
                and getattr(report, "decision", None) is None
            ),
            "created_at": report.created_at,
        }
        for report in reports
    ]
    return result


def due_status(due, *, can_report):
    latest = due.reports.order_by("-created_at", "pk").select_related("decision").first()
    state = due_state(due)
    return {
        "state": state,
        "can_report": can_report and state == "due",
        "previous": str(latest.pk) if latest and state == "due" else None,
    }


def due_state(due):
    confirmed = RefundDecision.objects.filter(report__due=due, action="confirmed").exists()
    if confirmed:
        return "confirmed"
    if RefundReport.objects.filter(due=due, decision__action__isnull=True).exists():
        return "reported"
    return "due"


def before_correction(correction):
    """Retained target-version facts, even after this/later corrections approve."""
    receipt = Receipt.objects.get(pk=correction.receipt_id)
    earlier = (
        Correction.objects.filter(receipt=receipt, target_version__lt=correction.target_version, case__state="approved")
        .order_by("-target_version")
        .first()
    )
    source = earlier or receipt
    return {
        "amount": format(source.amount, ".2f"),
        "paid_at": source.paid_at,
        "description": source.description,
        "version": correction.target_version,
    }
