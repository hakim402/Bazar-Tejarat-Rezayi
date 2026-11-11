"""Bounded immutable projections. No GET-time initialization or completion writes."""

from decimal import Decimal
from django.db import transaction
from django.db.models import Q, OuterRef, Subquery, Exists, Sum, Value, F, DecimalField, IntegerField
from django.db.models.functions import Coalesce
from django.shortcuts import get_object_or_404
from apps.orders.models import SellerOrder
from apps.orders.aftercare import effective_lines as aftercare_effective_lines
from apps.payments import queries as goods
from . import access, models as m, selection

MONEY = DecimalField(max_digits=24, decimal_places=2)


def effective_receipts(qs=None):
    approved = m.Correction.objects.filter(
        receipt_id=OuterRef("pk"),
        case__state="approved",
        case__events__action="approve",
        case__events__event__publication__isnull=False,
    ).order_by("-target_version")
    return (qs if qs is not None else m.Receipt.objects.all()).annotate(
        effective_amount=Coalesce(Subquery(approved.values("amount")[:1]), F("claim__amount"), output_field=MONEY),
        effective_time=Coalesce(Subquery(approved.values("paid_at")[:1]), F("claim__paid_at")),
        effective_description=Coalesce(Subquery(approved.values("description")[:1]), F("claim__description")),
        effective_version=Coalesce(Subquery(approved.values("target_version")[:1]), Value(0)) + 1,
    )


def delivery_total(order):
    return effective_receipts(m.Receipt.objects.filter(order_id=order.pk)).aggregate(value=Sum("effective_amount"))[
        "value"
    ] or Decimal("0.00")


def provider_receipts(order, provider):
    """Confirmed effective provider receipts in the goods-order currency."""
    return (
        effective_receipts(m.Receipt.objects.filter(order_id=order.pk, claim__charge__provider_id=provider.pk))
        .aggregate(value=Sum("effective_amount"))["value"]
        or Decimal("0.00")
    )


def confirmed_refunds(order, provider=None):
    qs = m.DeliveryRefund.objects.filter(order_id=order.pk, decision__action="confirmed")
    if provider is not None:
        qs = qs.filter(provider_id=provider.pk)
    return qs.aggregate(value=Sum("amount"))["value"] or Decimal("0.00")


def current_charge(order):
    return (
        m.ChargeProposal.objects.filter(
            order_id=order.pk, decision__action="approved", decision__event__publication__isnull=False
        )
        .select_related("provider")
        .order_by("-decision__event__version")
        .first()
    )


def line_image(actor, pk, line_id):
    from apps.orders.queries import line_image as resolve

    return resolve(get_object_or_404(access.scope(actor), pk=pk), line_id)


def active_blockers(order):
    closed = m.BlockerClosure.objects.filter(blocker_id=OuterRef("pk"))
    return m.Blocker.objects.filter(order_id=order.pk).filter(~Exists(closed))


def annotate(qs):
    charge = m.ChargeProposal.objects.filter(
        order_id=OuterRef("pk"), decision__action="approved", decision__event__publication__isnull=False
    ).order_by("-decision__event__version")
    paid = (
        effective_receipts(m.Receipt.objects.filter(order_id=OuterRef("pk")))
        .values("order_id")
        .annotate(total=Sum("effective_amount"))
        .values("total")
    )
    refunded = (
        m.DeliveryRefund.objects.filter(order_id=OuterRef("pk"), decision__action="confirmed")
        .values("order_id")
        .annotate(total=Sum("amount"))
        .values("total")
    )
    arrangement = m.Arrangement.objects.filter(order_id=OuterRef("pk")).order_by("-event__version")
    preparation = m.Preparation.objects.filter(order_id=OuterRef("pk")).order_by("-event__version")
    recipient = m.Recipient.objects.filter(order_id=OuterRef("pk")).order_by("-revision")
    attempt = m.DispatchAttempt.objects.filter(order_id=OuterRef("pk")).order_by("-event__version")
    state = m.State.objects.filter(order_id=OuterRef("pk"))
    shipment = m.Shipment.objects.filter(order_id=OuterRef("pk"))
    delivery = m.Delivery.objects.filter(order_id=OuterRef("pk"))
    completion = m.Completion.objects.filter(order_id=OuterRef("pk"))
    blockers = m.Blocker.objects.filter(order_id=OuterRef("pk")).filter(
        ~Exists(m.BlockerClosure.objects.filter(blocker_id=OuterRef("pk")))
    )
    return goods.annotate(qs).annotate(
        fulfilment_version=Coalesce(Subquery(state.values("version")[:1]), Value(0), output_field=IntegerField()),
        final_charge_id=Subquery(charge.values("pk")[:1]),
        final_charge_amount=Subquery(charge.values("amount")[:1], output_field=MONEY),
        final_charge_provider=Subquery(charge.values("provider__name")[:1]),
        provider_name=Subquery(arrangement.values("provider__name")[:1]),
        preparation_id=Subquery(preparation.values("pk")[:1]),
        prepared_recipient_id=Subquery(preparation.values("recipient_id")[:1]),
        current_recipient_id=Subquery(recipient.values("pk")[:1]),
        prepared_arrangement_id=Subquery(preparation.values("arrangement_id")[:1]),
        current_arrangement_id=Subquery(arrangement.values("pk")[:1]),
        last_dispatch_problem=Subquery(attempt.values("code")[:1]),
        delivery_paid=Coalesce(Subquery(paid[:1]), Value(Decimal("0.00")), output_field=MONEY),
        delivery_refunded=Coalesce(Subquery(refunded[:1]), Value(Decimal("0.00")), output_field=MONEY),
        dispatched=Exists(shipment),
        delivered=Exists(delivery),
        completion_at=Subquery(completion.values("created_at")[:1]),
        cancellation_hold=Exists(blockers.filter(kind="cancellation")),
        dispute_open=Exists(blockers.filter(kind="dispute")),
    )


def dimensions(order):
    if not hasattr(order, "fulfilment_version"):
        order = annotate(SellerOrder.objects.filter(pk=order.pk)).get()
    settled = (
        order.final_charge_amount is not None
        and order.delivery_paid - order.delivery_refunded >= order.final_charge_amount
    )
    eligible = (
        order.delivered
        and order.payment_total - order.refund_confirmed_total >= order.accepted_total
        and settled
        and not order.cancellation_hold
        and not order.dispute_open
    )
    past = bool(order.completion_at)
    physical = "delivered" if order.delivered else "dispatched" if order.dispatched else "not_dispatched"
    if not order.dispatched and order.preparation_id:
        physical = (
            "prepared"
            if order.prepared_recipient_id == order.current_recipient_id
            and order.prepared_arrangement_id == order.current_arrangement_id
            else "needs_preparation"
        )
    financial = goods.projection(order)
    return {
        "version": order.fulfilment_version,
        "goods_version": order.payment_version,
        "goods_confirmed": format(order.payment_total, ".2f"),
        "goods_remaining": format(
            max(order.accepted_total - order.payment_total + order.refund_confirmed_total, Decimal(0)), ".2f"
        ),
        "stage": physical,
        "allocation": financial["allocation"],
        "overdue": financial["overdue"],
        "dispatch_problem": order.last_dispatch_problem if not order.dispatched else None,
        "charge": format(order.final_charge_amount, ".2f") if order.final_charge_amount is not None else None,
        "charge_id": str(order.final_charge_id) if order.final_charge_id else None,
        "charge_provider": order.final_charge_provider or "",
        "delivery_confirmed": format(order.delivery_paid, ".2f"),
        "delivery_refunded": format(order.delivery_refunded, ".2f"),
        "delivery_remaining": format(
            max(order.final_charge_amount - order.delivery_paid + order.delivery_refunded, Decimal(0)), ".2f"
        )
        if order.final_charge_amount is not None
        else None,
        "delivery_excess": format(
            max(order.delivery_paid - order.delivery_refunded - order.final_charge_amount, Decimal(0)), ".2f"
        )
        if order.final_charge_amount is not None
        else None,
        "delivery_settled": settled,
        "cancellation_hold": order.cancellation_hold,
        "dispute_open": order.dispute_open,
        "completion": "completed"
        if past and eligible
        else "completed_with_exception"
        if past
        else "pending_publication"
        if eligible
        else "incomplete",
        "completed_at": order.completion_at,
        "eligible": eligible,
        "provider": order.provider_name or "",
    }


def summary(actor, order, *, read_scope=None):
    return {
        "id": str(order.pk),
        "seller": str(order.seller_id),
        "number": order.invoice.number,
        "buyer": order.snapshot.get("buyer", ""),
        "invoice": str(order.invoice.pk)
        if access.capabilities(actor, order, read_scope=read_scope)["invoice"]
        else None,
        "currency": order.currency,
        "goods_total": format(order.goods_total, ".2f"),
        "payment_method": order.payment_method,
        "destination": order.snapshot.get("terms", {}).get("destination", {}),
        **dimensions(order),
        "capabilities": access.capabilities(actor, order, read_scope=read_scope),
    }


def page(actor, *, seller=None, page=1, state="", q=""):
    qs = (
        annotate(access.scope(actor, seller=seller))
        .select_related("invoice", "seller__account")
        .order_by("-accepted_at", "pk")
    )
    if q:
        qs = qs.filter(invoice__number__icontains=q)
    if state == "dispatched":
        qs = qs.filter(dispatched=True, delivered=False)
    elif state == "delivered":
        qs = qs.filter(delivered=True)
    elif state == "not_dispatched":
        qs = qs.filter(dispatched=False)
    elif state == "blocked":
        qs = qs.filter(Q(cancellation_hold=True) | Q(dispute_open=True))
    count = qs.count()
    rows = list(qs[(page - 1) * 20 : page * 20])
    context = access.read_context(actor, rows)
    return {"count": count, "page": page, "results": [summary(actor, o, read_scope=context) for o in rows]}


def receipt_row(actor, receipt, *, can_propose):
    return {
        "id": str(receipt.pk),
        "claim": str(receipt.claim_id),
        "can_correct": can_propose
        and (
            actor.context == "seller"
            or receipt.claim.event.account_id == getattr(access.account_for(actor), "pk", None)
        ),
        "amount": format(receipt.effective_amount, ".2f"),
        "original_amount": format(receipt.claim.amount, ".2f"),
        "paid_at": receipt.effective_time,
        "description": receipt.effective_description,
        "provider": str(receipt.claim.charge.provider_id),
        "provider_name": receipt.claim.charge.provider.name,
        "version": receipt.effective_version,
        "evidence": [str(i.evidence_id) for i in receipt.claim.images.all()],
    }


@transaction.atomic
def detail(actor, pk, *, seller=None, page=1):
    initial = get_object_or_404(access.scope(actor, seller=seller), pk=pk)
    access.lock_order(actor, pk)
    order = annotate(SellerOrder.objects.filter(pk=initial.pk)).select_related("invoice", "seller__account").get()
    result = summary(actor, order)
    caps = result["capabilities"]
    recipient = m.Recipient.objects.filter(order=order).order_by("-revision").first()
    preparation = (
        m.Preparation.objects.filter(order=order)
        .select_related("arrangement__provider", "recipient")
        .order_by("-event__version")
        .first()
    )
    arrangement = (
        m.Arrangement.objects.filter(order=order).select_related("provider").order_by("-event__version").first()
    )
    result.update(
        held_lines=selection.held_display(order) if caps["prepare"] and order.payment_method == "advance" else [],
        recipient=None,
        recipient_revision=recipient.revision if recipient else 0,
        arrangement=None,
        preparation=None,
        claims=[],
        receipts=[],
        corrections=[],
        proposals=[],
        tracking=[],
        delivery=None,
        cases=[],
        blockers=[],
        partial_permission=None,
        history=[],
        history_page=page,
        history_count=0,
        goods=[],
    )
    if caps["recipient"]:
        access.audit(actor, order, "fulfilment_recipient_read", "Scoped private recipient disclosure")
        if recipient:
            result["recipient"] = {
                "id": str(recipient.pk),
                "revision": recipient.revision,
                "name": recipient.name,
                "phone": recipient.phone,
                "address": recipient.address,
                "instructions": recipient.instructions,
                "reason": recipient.reason,
            }
    if arrangement:
        result["arrangement"] = {
            "id": str(arrangement.pk),
            "provider_id": str(arrangement.provider_id),
            "provider": arrangement.provider.name,
            "arranger": arrangement.arranger,
            "instructions": arrangement.instructions if caps["recipient"] or caps["prepare"] else "",
        }
    if preparation:
        current = bool(
            recipient
            and arrangement
            and preparation.recipient_id == recipient.pk
            and preparation.arrangement_id == arrangement.pk
            and selection.demand_matches(preparation)
        )
        result["preparation"] = {
            "id": str(preparation.pk),
            "recipient_revision": preparation.recipient.revision,
            "arrangement": str(preparation.arrangement_id),
            "current": current,
            "lines": selection.display(preparation) if caps["prepare"] else [],
        }
        if not order.dispatched:
            result["stage"] = "prepared" if current else "needs_preparation"
    partial = (
        m.PartialPermission.objects.filter(order=order, goods_version=order.payment_version)
        .order_by("-event__version")
        .first()
    )
    if partial:
        result["partial_permission"] = {
            "id": str(partial.pk),
            "goods_version": partial.goods_version,
            "reason": partial.reason,
        }
    result["goods"] = [
        {
            "variant": str(item["line"].variant_id),
            "tier": item["line"].tier,
            "quantity": format(item["quantity"], ".3f"),
            "unit_price": format(item["unit_price"], ".2f"),
            "sku": item["line"].snapshot.get("sku", ""),
            "unit": item["line"].snapshot.get("unit", ""),
            "unit_labels": item["line"].snapshot.get("unit_labels", {}),
            "titles": item["line"].snapshot.get("titles", {}),
            "source_locale": item["line"].snapshot.get("source_locale", ""),
            "image": f"/api/v1/fulfilment/{actor.context}/orders/{order.pk}/lines/{item['line'].pk}/image/",
        }
        for item in aftercare_effective_lines(order)
    ]
    providers = {arrangement.provider_id: arrangement.provider} if arrangement else {}
    charge = current_charge(order)
    if charge:
        providers[charge.provider_id] = charge.provider
    result["refund_providers"] = [
        {
            "id": str(provider.pk),
            "name": provider.name,
            "refundable": format(max(provider_receipts(order, provider) - confirmed_refunds(order, provider), Decimal(0)), ".2f"),
        }
        for provider in providers.values()
    ] if caps["refund"] else []
    offset = (page - 1) * 50
    refunds = m.DeliveryRefund.objects.filter(order=order)
    if not caps["financial_details"]:
        refunds = refunds.filter(event__account=access.account_for(actor)) if caps["refund"] else refunds.none()
    result["delivery_refunds"] = [
        {
            "id": str(x.pk),
            "provider": str(x.provider_id),
            "provider_name": x.provider.name,
            "amount": format(x.amount, ".2f"),
            "currency": x.currency,
            "sent_at": x.sent_at,
            "reference": x.reference,
            "description": x.description,
            "state": x.decision.action if getattr(x, "decision", None) else "pending",
            "evidence": [str(image.evidence_id) for image in x.images.all()]
            if caps["evidence"] or x.event.account_id == getattr(actor.account, "pk", None) else [],
        }
        for x in refunds.select_related("provider", "decision", "event").prefetch_related("images")
        .order_by("-event__version")[offset : offset + 50]
    ]
    proposals = (
        m.ChargeProposal.objects.filter(order=order)
        .select_related("provider", "decision")
        .order_by("-event__version")[offset : offset + 50]
    )
    result["proposals"] = [
        {
            "id": str(x.pk),
            "provider": x.provider.name,
            "provider_id": str(x.provider_id),
            "amount": format(x.amount, ".2f"),
            "currency": x.currency,
            "reason": x.reason,
            "state": x.decision.action
            if getattr(x, "decision", None) and m.ChargeDecision.objects.filter(pk=x.decision.pk).exists()
            else "pending",
        }
        for x in proposals
    ]
    if caps["financial_details"]:
        access.audit(actor, order, "fulfilment_financial_read", "Scoped separate delivery claim/receipt disclosure")
        claims = (
            m.Claim.objects.filter(order=order)
            .select_related("decision", "event__account")
            .prefetch_related("images")
            .order_by("-event__version")[offset : offset + 50]
        )
        result["claims"] = [
            {
                "id": str(x.pk),
                "amount": format(x.amount, ".2f"),
                "currency": x.currency,
                "paid_at": x.paid_at,
                "description": x.description,
                "state": x.decision.action
                if getattr(x, "decision", None) and m.ClaimDecision.objects.filter(pk=x.decision.pk).exists()
                else "pending",
                "can_withdraw": bool(
                    x.event.account_id == getattr(access.account_for(actor), "pk", None)
                    and not m.ClaimDecision.objects.filter(claim=x).exists()
                ),
                "evidence": [str(i.evidence_id) for i in x.images.all()],
            }
            for x in claims
        ]
        receipts = (
            effective_receipts(m.Receipt.objects.filter(order=order))
            .select_related("order__seller", "claim__charge__provider", "claim__event")
            .prefetch_related("claim__images")
            .order_by("-event__version")[offset : offset + 50]
        )
        result["receipts"] = [receipt_row(actor, x, can_propose=caps["claim"]) for x in receipts]
        result["corrections"] = [
            {
                "id": str(x.pk),
                "receipt": str(x.receipt_id),
                "amount": format(x.amount, ".2f"),
                "target_version": x.target_version,
                "paid_at": x.paid_at,
                "description": x.description,
                "reason": x.reason,
                "state": x.case.state,
                "evidence": [str(image.evidence_id) for image in x.images.all()] if caps["evidence"] else [],
            }
            for x in m.Correction.objects.filter(order=order)
            .select_related("case")
            .prefetch_related("images")
            .order_by("-event__version")[offset : offset + 50]
        ]
    result["tracking"] = [
        {
            "id": str(x.pk),
            "reference": x.reference,
            "occurred_at": x.occurred_at,
            "reason": x.reason,
            "source": x.event.context,
        }
        for x in m.Tracking.objects.filter(order=order)
        .select_related("event")
        .order_by("-event__version")[offset : offset + 50]
    ]
    delivered = m.Delivery.objects.filter(order=order).select_related("event").first()
    if delivered:
        result["delivery"] = {
            "occurred_at": delivered.occurred_at,
            "source": delivered.event.context,
            "reason": delivered.reason,
        }
    result["blockers"] = [{"id": str(x.pk), "kind": x.kind} for x in active_blockers(order)]
    result["cases"] = [
        {"id": str(x.pk), "kind": x.kind, "state": x.state}
        for x in m.ReviewCase.objects.filter(order=order).order_by("-created_at", "pk")[offset : offset + 50]
    ]
    events = m.Event.objects.filter(order=order).order_by("-version")
    result["history_count"] = events.count()
    result["history"] = [
        {"id": str(x.pk), "version": x.version, "action": x.action, "context": x.context, "created_at": x.created_at}
        for x in events[(page - 1) * 50 : page * 50]
    ]
    return result
