"""Participant facts, versioned preparation and atomic whole-order dispatch."""

from decimal import Decimal
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError
from apps.organizations.access import Conflict
from apps.payments import queries as goods
from apps.payments.models import Finance
from . import models as m, queries, selection, validation as v
from .services import emit, new_case, bind, stock_token


def no_shipment(order):
    if m.Shipment.construction.filter(order=order).exists():
        raise Conflict("Actual dispatch history is immutable; refer requested changes to logistics review.")


def recipient(actor, order, state, data, **_):
    no_shipment(order)
    last = m.Recipient.objects.filter(order=order).order_by("-revision").first()
    v.expect(last.revision if last else 0, data.get("recipient_revision"))
    fields = {k: v.text(data.get(k), k, limit, 1) for k, limit in [("name", 120), ("phone", 40), ("address", 1500)]}
    fields["instructions"] = v.text(data.get("instructions", ""), "instructions", 1000, 0)
    event = emit(order, state, "recipient_revised", actor)
    item = m.Recipient.construction.create(
        order=order,
        event=event,
        revision=(last.revision if last else 0) + 1,
        reason=v.text(data.get("reason")),
        **fields,
    )
    return {"recipient": str(item.pk), "revision": item.revision}, event


def arrange(actor, order, state, data, **_):
    no_shipment(order)
    kind = data.get("arranger")
    if kind not in {"seller", "rezayi"} or actor.context == "seller" and kind != "seller":
        raise PermissionDenied()
    if queries.delivery_total(order) > 0 or m.Receipt.objects.filter(order=order).exists():
        raise Conflict("Retained provider receipts prevent changing the payee arrangement.")
    event = emit(order, state, "arrangement_proposed", actor)
    provider = m.Provider.construction.create(
        order=order,
        event=event,
        name=v.text(data.get("provider"), "provider", 160, 1),
        business_id=order.seller_id if data.get("self_delivery") is True else None,
    )
    item = m.Arrangement.construction.create(
        order=order,
        event=event,
        provider=provider,
        arranger=kind,
        instructions=v.text(data.get("instructions", ""), "instructions", 1000, 0),
    )
    if kind == "rezayi":
        new_case(order, "logistics", item.pk)
    return {"arrangement": str(item.pk), "provider": str(provider.pk)}, event


def prepare(actor, order, state, data, *, now=None):
    no_shipment(order)
    arrangement = m.Arrangement.objects.filter(order=order).order_by("-event__version").first()
    person = m.Recipient.objects.filter(order=order).order_by("-revision").first()
    if not arrangement or not person:
        raise Conflict("A named provider and current recipient revision are required.")
    if str(arrangement.pk) != str(data.get("arrangement")) or str(person.pk) != str(data.get("recipient")):
        raise Conflict()
    if actor.context == "seller" and arrangement.arranger != "seller":
        raise PermissionDenied("Assigned native logistics must prepare Rezayi arrangements.")
    try:
        allocation, rows = selection.prepared_lines(order, data, now=now)
    except selection.HeldStockUnavailable:
        # Preserve this expected blocked outcome and its review without publishing
        # an invalid preparation or changing the original money/stock facts.
        return blocked(actor, order, state, "stock_expired_inactive_or_unavailable")
    event = emit(order, state, "prepared", actor)
    item = m.Preparation.construction.create(
        order=order,
        event=event,
        arrangement=arrangement,
        recipient=person,
        allocation=allocation,
        reason=v.text(data.get("reason")),
    )
    selection.store(item, rows)
    return {"preparation": str(item.pk)}, event


def partial(actor, order, state, data, **_):
    no_shipment(order)
    paid = goods.confirmed(order)
    if order.payment_method != "advance" or not Decimal(0) < paid < order.goods_total:
        raise Conflict("Partial authorization requires positive partial advance funds.")
    event = emit(order, state, "partial_authorized", actor)
    item = m.PartialPermission.construction.create(
        order=order, event=event, goods_version=data["goods_version"], reason=v.text(data.get("reason"))
    )
    return {"partial_permission": str(item.pk)}, event


def charge(actor, order, state, data, **_):
    no_shipment(order)
    arrangement = m.Arrangement.objects.filter(order=order).order_by("-event__version").first()
    if not arrangement or str(arrangement.provider_id) != str(data.get("provider")):
        raise Conflict("Review the current identified provider.")
    if data.get("currency") != order.currency:
        v.fail("currency", "order_currency")
    event = emit(order, state, "charge_proposed", actor)
    item = m.ChargeProposal.construction.create(
        order=order,
        event=event,
        provider=arrangement.provider,
        amount=v.money(data.get("amount"), zero=True),
        currency=order.currency,
        reason=v.text(data.get("reason")),
    )
    new_case(order, "charge", item.pk, proposal=item)
    return {"proposal": str(item.pk)}, event


def claim(actor, order, state, data, **_):
    final = queries.current_charge(order)
    if not final or final.amount == 0:
        raise Conflict("A finalized positive delivery charge is required; zero needs no receipt.")
    if str(final.pk) != str(data.get("charge")):
        raise Conflict()
    if data.get("currency") != order.currency:
        v.fail("currency", "order_currency")
    event = emit(order, state, "delivery_claimed", actor)
    item = m.Claim.construction.create(
        order=order,
        event=event,
        charge=final,
        amount=v.money(data.get("amount")),
        currency=order.currency,
        paid_at=v.paid_time(data.get("paid_at")),
        description=v.text(data.get("description"), "description", 500, 1),
    )
    bind(actor, order, data.get("evidence", []), purpose="claim", claim=item)
    new_case(order, "payment", item.pk, claim=item)
    return {"claim": str(item.pk)}, event


def withdraw(actor, order, state, data, **_):
    item = get_object_or_404(
        m.Claim.objects.select_for_update(), pk=data.get("claim"), order=order, event__account=actor.account
    )
    if m.ClaimDecision.construction.filter(claim=item).exists():
        raise Conflict()
    event = emit(order, state, "claim_withdrawn", actor)
    m.ClaimDecision.construction.create(
        order=order, event=event, claim=item, action="withdrawn", reason=v.text(data.get("reason"))
    )
    m.ReviewCase.objects.select_for_update().get(claim=item)
    # Participant withdrawal is a retained fact; pending review projects withdrawn without staff impersonation.
    return {"claim": str(item.pk), "state": "withdrawn"}, event


def correction(actor, order, state, data, **_):
    receipt = get_object_or_404(
        queries.effective_receipts(m.Receipt.objects.select_for_update()), pk=data.get("receipt"), order=order
    )
    if actor.context == "buyer" and receipt.claim.event.account_id != actor.account.pk:
        raise PermissionDenied()
    v.expect(receipt.effective_version, data.get("receipt_version"))
    if m.Correction.objects.filter(receipt=receipt, case__state="open").exists():
        raise Conflict("A correction is already pending.")
    event = emit(order, state, "correction_proposed", actor)
    item = m.Correction.construction.create(
        order=order,
        event=event,
        receipt=receipt,
        target_version=receipt.effective_version,
        amount=v.money(data.get("amount"), zero=True),
        paid_at=v.paid_time(data.get("paid_at")),
        description=v.text(data.get("description"), "description", 500, 1),
        reason=v.text(data.get("reason")),
    )
    bind(actor, order, data.get("evidence", []), purpose="correction", correction=item)
    new_case(order, "correction", item.pk, correction=item)
    return {"correction": str(item.pk)}, event


def blocker(actor, order, state, data, **_):
    kind = data.get("kind")
    if kind not in {"cancellation", "dispute"}:
        v.fail("kind")
    event = emit(order, state, "operational_hold", actor)
    item = m.Blocker.construction.create(order=order, event=event, kind=kind, reason=v.text(data.get("reason")))
    new_case(order, "blocker", item.pk, blocker=item)
    return {"blocker": str(item.pk)}, event


def packet(actor, order, state, data):
    preparation = get_object_or_404(
        m.Preparation.objects.select_related("recipient", "arrangement__provider", "order"),
        pk=data.get("preparation"),
        order=order,
    )
    current_person = m.Recipient.objects.filter(order=order).order_by("-revision").first()
    arrangement = m.Arrangement.objects.filter(order=order).order_by("-event__version").first()
    charge = queries.current_charge(order)
    if (
        not current_person
        or preparation.recipient_id != current_person.pk
        or not arrangement
        or preparation.arrangement_id != arrangement.pk
    ):
        raise Conflict("Re-prepare the current recipient and arrangement.")
    if not charge or charge.provider_id != arrangement.provider_id:
        raise Conflict("Staff must finalize the current provider delivery charge.")
    if actor.context == "seller" and arrangement.arranger != "seller":
        raise PermissionDenied()
    paid = goods.confirmed(order)
    finance = Finance.objects.get(order=order)
    permission = (
        m.PartialPermission.objects.filter(order=order, goods_version=finance.version)
        .order_by("-event__version")
        .first()
    )
    body = {
        "version": state.version,
        "goods_version": finance.version,
        "preparation": str(preparation.pk),
        "recipient": str(current_person.pk),
        "recipient_revision": current_person.revision,
        "arrangement": str(arrangement.pk),
        "arranger": arrangement.arranger,
        "provider": str(arrangement.provider_id),
        "provider_name": arrangement.provider.name,
        "charge": str(charge.pk),
        "charge_amount": format(charge.amount, ".2f"),
        "currency": order.currency,
        "goods_confirmed": format(paid, ".2f"),
        "goods_total": format(order.goods_total, ".2f"),
        "partial_permission": str(permission.pk) if permission else None,
        "lines": selection.display(preparation),
        "stock_effect": "consume_hold" if order.payment_method == "advance" else "deduct_cod",
        "reason": v.text(data.get("reason")),
    }
    body["review"] = v.digest("dispatch_review", order.pk, body)
    return body, preparation, charge, permission


def before_dispatch_commit(_order):
    """Owned crash/race test seam; no authority bypass."""
    return None


def blocked(actor, order, state, code, preparation=None, shortage=None):
    event = emit(order, state, "dispatch_blocked", actor)
    attempt = m.DispatchAttempt.construction.create(
        order=order, event=event, code=code, preparation=preparation, shortage_id=shortage
    )
    new_case(order, "stock", str(preparation.pk) if preparation else order.pk)
    return {"state": "blocked", "code": code, "attempt": str(attempt.pk)}, event


def dispatch(actor, order, state, data, *, now=None):
    no_shipment(order)
    if queries.active_blockers(order).filter(kind="cancellation").exists():
        return blocked(actor, order, state, "cancellation_hold")
    expected, preparation, charge, permission = packet(actor, order, state, data)
    if any(v.canonical(data.get(k)) != v.canonical(value) for k, value in expected.items()):
        raise Conflict("Commit the exact reviewed dispatch packet.")
    paid = goods.confirmed(order)
    if order.payment_method == "advance" and (paid <= 0 or paid < order.goods_total and not permission):
        return blocked(actor, order, state, "positive_funds_and_partial_permission", preparation)
    from apps.inventory.fulfilment import dispatch as write_stock

    token = stock_token(order.pk, v.identifier(data["command_id"]))
    try:
        from django.db import transaction

        with transaction.atomic():
            result = write_stock(actor, order, preparation, token, now=now)
    except (ValidationError, Conflict):
        return blocked(actor, order, state, "stock_expired_inactive_or_unavailable", preparation)
    if result.get("status") == "shortage":
        return blocked(actor, order, state, "stock_shortage", preparation, result.get("shortage"))
    event = emit(order, state, "dispatched", actor)
    shipment = m.Shipment.construction.create(
        order=order,
        event=event,
        preparation=preparation,
        charge=charge,
        operation_id=result["operation"],
        goods_version=data["goods_version"],
        goods_confirmed=paid,
        dispatched_at=now or timezone.now(),
    )
    before_dispatch_commit(order)
    return {"shipment": str(shipment.pk), "state": "dispatched", "operation": str(shipment.operation_id)}, event


def tracking(actor, order, state, data, **_):
    shipment = get_object_or_404(m.Shipment, order=order)
    at = v.actual_time(data.get("occurred_at"), earliest=shipment.dispatched_at)
    event = emit(order, state, "tracking_recorded", actor)
    item = m.Tracking.construction.create(
        order=order,
        event=event,
        shipment=shipment,
        reference=v.text(data.get("reference"), "reference", 160, 1),
        occurred_at=at,
        reason=v.text(data.get("reason")),
    )
    return {"tracking": str(item.pk)}, event


def deliver(actor, order, state, data, **_):
    shipment = get_object_or_404(m.Shipment, order=order)
    if m.Delivery.construction.filter(shipment=shipment).exists():
        raise Conflict("Whole delivery is already recorded.")
    at = v.actual_time(data.get("occurred_at"), earliest=shipment.dispatched_at)
    event = emit(order, state, "delivered", actor)
    item = m.Delivery.construction.create(
        order=order, event=event, shipment=shipment, occurred_at=at, reason=v.text(data.get("reason"))
    )
    return {"delivery": str(item.pk), "source": actor.context}, event


APPLY = {
    name: globals()[name]
    for name in [
        "recipient",
        "arrange",
        "prepare",
        "partial",
        "charge",
        "claim",
        "withdraw",
        "correction",
        "blocker",
        "dispatch",
        "tracking",
        "deliver",
    ]
}
