"""Bounded private aftercare projections; reads never initialize coordinators."""

from django.core.exceptions import PermissionDenied
from django.db.models import Q
from django.shortcuts import get_object_or_404

from . import access
from . import aftercare as projection
from .models import Aftercare, CancellationRequest, DisputeRequest


def request_row(request, actor=None):
    decision = getattr(request, "decision", None)
    return {
        "id": str(request.pk),
        "order": str(request.order_id),
        "number": request.order.invoice.number,
        "invoice": str(request.order.invoice.pk),
        "currency": request.order.currency,
        "state": request.state,
        "can_withdraw": bool(
            actor and request.state == "pending" and actor.context == request.requester_context
            and request.requester_account_id == getattr(actor.account, "pk", None)
            and (actor.context == "buyer" or access.profiles(actor.account).filter(pk=request.order.seller_id).exists())
        ),
        "requester_context": request.requester_context,
        "requester": str(request.requester_account_id) if request.requester_account_id else None,
        "initiator": str(request.requester_user_id) if request.requester_user_id else None,
        "payment_case": str(request.payment_case_id) if request.payment_case_id else None,
        "reason": request.reason,
        "assigned": request.assigned_to_id is not None,
        "version": request.version,
        "created_at": request.created_at,
        "decided_at": decision.created_at if decision else None,
        "decision": decision.action if decision else None,
        "decision_reason": decision.reason if decision else "",
    }


def amendment_row(amendment, actor=None):
    decision = getattr(amendment, "decision", None)
    return {
        "id": str(amendment.pk),
        "order": str(amendment.order_id),
        "number": amendment.order.invoice.number,
        "invoice": str(amendment.order.invoice.pk),
        "currency": amendment.order.currency,
        "state": amendment.state,
        "can_withdraw": bool(
            actor and actor.context == "seller" and amendment.state == "pending"
            and amendment.actor_id == getattr(actor.account, "pk", None)
            and access.profiles(actor.account).filter(pk=amendment.order.seller_id).exists()
        ),
        "after_total": format(amendment.after_total, ".2f"),
        "reason": amendment.reason,
        "assigned": amendment.assigned_to_id is not None,
        "version": amendment.version,
        "created_at": amendment.created_at,
        "decided_at": decision.created_at if decision else None,
        "decision": decision.action if decision else None,
        "decision_reason": decision.reason if decision else "",
        "lines": [
            {
                "line": str(row.line_id),
                "variant": str(row.line.variant_id),
                "tier": row.line.tier,
                "quantity": format(row.proposed_quantity, ".3f"),
                "unit_price": format(row.proposed_unit_price, ".2f"),
            }
            for row in amendment.lines.all()
        ],
    }


def dispute_row(dispute, actor=None):
    response = getattr(dispute, "response", None)
    decision = getattr(dispute, "decision", None)
    return {
        "id": str(dispute.pk),
        "order": str(dispute.order_id),
        "number": dispute.order.invoice.number,
        "invoice": str(dispute.order.invoice.pk),
        "currency": dispute.order.currency,
        "state": dispute.state,
        "can_withdraw": bool(
            actor and actor.context == "buyer" and dispute.state == "pending"
            and dispute.requester_account_id == getattr(actor.account, "pk", None)
        ),
        "can_respond": bool(
            actor and actor.context == "seller" and dispute.state == "pending" and response is None
            and access.profiles(actor.account).filter(pk=dispute.order.seller_id).exists()
        ),
        "requester": str(dispute.requester_account_id),
        "evidence": [str(binding.evidence_id) for binding in dispute.evidence_bindings.order_by("evidence_id")[:3]],
        "reason": dispute.reason,
        "assigned": dispute.assigned_to_id is not None,
        "version": dispute.version,
        "created_at": dispute.created_at,
        "response": {
            "actor": str(response.actor_id),
            "text": response.text,
            "created_at": response.created_at,
        } if response else None,
        "decision": {
            "action": decision.action,
            "amount": format(decision.amount, ".2f") if decision.amount is not None else None,
            "refund_due": str(decision.refund_due_id) if decision.refund_due_id else None,
            "reason": decision.reason,
            "created_at": decision.created_at,
        } if decision else None,
    }


def review_row(review, actor):
    return {
        "can_withdraw": bool(
            actor.context == "buyer" and review.state == "pending"
            and review.buyer_id == getattr(actor.account, "pk", None)
        ),
        "id": str(review.pk),
        "order": str(review.order_id),
        "rating": review.rating,
        "text": review.text,
        "language": review.language,
        "state": review.state,
        "version": review.version,
        "created_at": review.created_at,
        "decisions": [
            {
                "action": d.action,
                "reason": d.reason,
                "created_at": d.created_at,
            }
            for d in review.decisions.order_by("-created_at", "pk")[:20]
        ],
    }


def effective_lines(order):
    lines = {str(line.pk): line for line in order.lines.select_related("variant")}
    result = projection.before_lines_snapshot(order)
    for row in result:
        line = lines[row["line"]]
        row.update(
            sku=line.snapshot.get("sku", ""),
            titles=line.snapshot.get("titles", {}),
            unit=line.snapshot.get("unit", ""),
            unit_labels=line.snapshot.get("unit_labels", {}),
            increment=format(line.variant.quantity_increment, ".3f"),
            minimum_wholesale=format(line.variant.minimum_wholesale, ".3f"),
        )
    return result


def order_data(actor, order):
    from apps.marketplace.access import eligible_profiles
    from apps.payments.queries import projection as money
    from apps.payments import access as payment_access
    from apps.payments.models import RefundDue, RefundReport
    from apps.payments.queries import due_state

    eligible = projection.eligibility(order)
    seller = actor.context == "seller" and access.profiles(actor.account).filter(pk=order.seller_id).exists()
    buyer = actor.context == "buyer" and order.buyer_id == actor.account.pk
    capabilities = []
    if (buyer or seller) and eligible["cancel"]:
        capabilities.append("cancel")
    if seller and eligible["amend"] and eligible_profiles([order.seller_id]).filter(pk=order.seller_id).exists():
        capabilities.append("amend")
    if buyer and eligible["dispute"]:
        capabilities.append("dispute_open")
    if buyer and eligible["review"]:
        capabilities.append("review_submit")
    payment_caps = payment_access.capabilities(actor, order)
    account = getattr(actor.account, "pk", None)
    refund_dues = []
    for due in RefundDue.objects.filter(order=order).prefetch_related("reports__decision").order_by("-created_at"):
        state = due_state(due)
        latest = due.reports.order_by("-created_at", "pk").select_related("decision").first()
        refund_dues.append(
            {
                "id": str(due.pk),
                "cause": due.cause,
                "amount": format(due.amount, ".2f"),
                "currency": due.currency,
                "state": state,
                "can_report": bool(payment_caps["refund"] and state == "due"),
                "previous": str(latest.pk) if latest and state == "due" else None,
                "version": due.version,
                "created_at": due.created_at,
            }
        )
    refund_reports = [
        {
            "id": str(report.pk),
            "due": str(report.due_id),
            "previous": str(report.previous_id) if report.previous_id else None,
            "amount": format(report.amount, ".2f"),
            "currency": order.currency,
            "sent_at": report.sent_at,
            "reference": report.reference,
            "description": report.description,
            "state": report.decision.action if getattr(report, "decision", None) else "pending",
            "can_withdraw": bool(
                payment_caps["refund"]
                and report.actor_id == account
                and getattr(report, "decision", None) is None
            ),
            "created_at": report.created_at,
        }
        for report in RefundReport.objects.filter(due__order=order).select_related("decision").order_by("-created_at")
    ]
    from apps.fulfilment.models import DeliveryRefund

    delivery_refunds = [
        {
            "id": str(refund.pk),
            "provider": str(refund.provider_id),
            "provider_name": refund.provider.name,
            "amount": format(refund.amount, ".2f"),
            "currency": order.currency,
            "sent_at": refund.sent_at,
            "state": refund.decision.action if getattr(refund, "decision", None) else "pending",
            "created_at": refund.created_at,
        }
        for refund in DeliveryRefund.objects.filter(order=order)
        .select_related("provider", "decision")
        .order_by("-created_at")
    ]
    return {
        "id": str(order.pk),
        "version": Aftercare.objects.filter(order=order).values_list("version", flat=True).first() or 0,
        "capabilities": capabilities,
        "effective_lines": effective_lines(order),
        "number": order.invoice.number,
        "invoice": str(order.invoice.pk),
        "currency": order.currency,
        "goods_total": format(order.goods_total, ".2f"),
        "accepted_total": format(projection.accepted_total(order), ".2f"),
        "payment_method": order.payment_method,
        "seller": str(order.seller_id),
        "seller_name": order.snapshot.get("seller", ""),
        "buyer_name": order.snapshot.get("buyer", ""),
        "payment": money(order),
        "aftercare": eligible,
        "cancellations": [
            request_row(x, actor)
            for x in order.cancellation_requests.select_related("order__invoice", "decision").order_by(
                "-created_at", "pk"
            )[:20]
        ],
        "amendments": [
            amendment_row(x, actor)
            for x in order.amendments.select_related("order__invoice", "decision").prefetch_related("lines__line").order_by(
                "-created_at", "pk"
            )[:20]
        ],
        "adjustments": projection.adjustment_rows(order),
        "disputes": [
            dispute_row(x, actor)
            for x in order.disputes.select_related("order__invoice", "response", "decision").order_by(
                "-created_at", "pk"
            )[:20]
        ],
        "review": review_row(order.review, actor) if hasattr(order, "review") and order.review else None,
        "refund_dues": refund_dues,
        "refund_reports": refund_reports,
        "delivery_refunds": delivery_refunds,
    }


def cancellation_page(actor, *, page=1, seller=None):
    qs = CancellationRequest.objects.filter(order__in=access.scope(actor, invoices=True, seller=seller))
    qs = qs.select_related("order__invoice", "decision").order_by("-created_at", "pk")
    return {
        "count": qs.count(),
        "page": page,
        "results": [request_row(x, actor) for x in qs[(page - 1) * 20 : page * 20]],
    }


def aftercare_page(actor, *, page=1, seller=None, q=""):
    qs = (
        access.scope(actor, invoices=True, seller=seller)
        .filter(
            Q(cancellation_requests__isnull=False) | Q(amendments__isnull=False)
            | Q(refund_dues__isnull=False) | Q(fulfilment_cases__kind="refund")
            | Q(disputes__isnull=False) | Q(review__isnull=False)
        )
        .select_related("invoice")
        .distinct()
        .order_by("-accepted_at", "pk")
    )
    if q:
        qs = qs.filter(
            Q(invoice__number__icontains=q) | Q(buyer__user__display_name__icontains=q)
        )
    return {
        "count": qs.count(),
        "page": page,
        "results": [order_data(actor, x) for x in qs[(page - 1) * 20 : page * 20]],
    }


def aftercare_detail(actor, order_pk):
    order = get_object_or_404(access.scope(actor, invoices=True).select_related("invoice"), pk=order_pk)
    return order_data(actor, order)


def cancellation_detail(actor, request_pk):
    qs = CancellationRequest.objects.filter(order__in=access.scope(actor, invoices=True))
    request = get_object_or_404(qs.select_related("order__invoice", "decision"), pk=request_pk)
    result = request_row(request, actor)
    result["order_detail"] = order_data(actor, request.order)
    return result


def dispute_page(actor, *, page=1, seller=None):
    from . import disputes

    qs = DisputeRequest.objects.filter(order__in=disputes.requesters(actor))
    if seller is not None and actor.context == "seller":
        qs = qs.filter(order__seller_id=seller)
    elif seller is not None:
        raise PermissionDenied()
    qs = qs.select_related("order__invoice", "response", "decision").order_by("-created_at", "pk")
    return {
        "count": qs.count(),
        "page": page,
        "results": [dispute_row(x, actor) for x in qs[(page - 1) * 20 : page * 20]],
    }


def dispute_list(actor, *, page=1, seller=None):
    """Dispatch dispute listing by actor context.

    Buyer/seller see their own disputes (via ``disputes.requesters``).
    Staff/owner see disputes within their assigned scope (via ``disputes.order_scope``).
    """
    from . import disputes

    if actor.context in {"staff", "owner"}:
        qs = DisputeRequest.objects.filter(order__in=disputes.order_scope(actor))
    else:
        qs = DisputeRequest.objects.filter(order__in=disputes.requesters(actor))
        if seller is not None:
            qs = qs.filter(order__seller_id=seller)
    qs = qs.select_related("order__invoice", "response", "decision").order_by("-created_at", "pk")
    return {
        "count": qs.count(),
        "page": page,
        "results": [dispute_row(x, actor) for x in qs[(page - 1) * 20 : page * 20]],
    }


def dispute_detail(actor, dispute_pk):
    from . import disputes

    qs = DisputeRequest.objects.filter(order__in=disputes.order_scope(actor))
    dispute = get_object_or_404(
        qs.select_related("order__invoice", "response", "decision"), pk=dispute_pk
    )
    result = dispute_row(dispute, actor)
    result["order_detail"] = order_data(actor, dispute.order)
    return result


def review_status(actor, order_pk):
    from .models import SellerOrder

    order = get_object_or_404(SellerOrder.objects.filter(buyer=actor.account), pk=order_pk)
    review = getattr(order, "review", None)
    if review is None:
        return None
    return review_row(review, actor)
