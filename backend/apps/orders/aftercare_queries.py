"""Bounded private aftercare projections; reads never initialize coordinators."""

from django.db.models import Q
from django.shortcuts import get_object_or_404

from . import access
from . import aftercare as projection
from .models import Aftercare, CancellationRequest


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

    eligible = projection.eligibility(order)
    seller = actor.context == "seller" and access.profiles(actor.account).filter(pk=order.seller_id).exists()
    buyer = actor.context == "buyer" and order.buyer_id == actor.account.pk
    capabilities = []
    if (buyer or seller) and eligible["cancel"]:
        capabilities.append("cancel")
    if seller and eligible["amend"] and eligible_profiles([order.seller_id]).filter(pk=order.seller_id).exists():
        capabilities.append("amend")
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
    }


def cancellation_page(actor, *, page=1, seller=None):
    qs = CancellationRequest.objects.filter(order__in=access.scope(actor, invoices=True, seller=seller))
    qs = qs.select_related("order__invoice", "decision").order_by("-created_at", "pk")
    return {
        "count": qs.count(),
        "page": page,
        "results": [request_row(x, actor) for x in qs[(page - 1) * 20 : page * 20]],
    }


def aftercare_page(actor, *, page=1, seller=None):
    qs = (
        access.scope(actor, invoices=True, seller=seller)
        .filter(
            Q(cancellation_requests__isnull=False) | Q(amendments__isnull=False)
            | Q(refund_dues__isnull=False) | Q(fulfilment_cases__kind="refund")
        )
        .select_related("invoice")
        .distinct()
        .order_by("-accepted_at", "pk")
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
