"""Post-delivery disputes on the existing aftercare head.

A dispute is available at any time after actual delivery is confirmed, before or
after completion, and never rewrites an earlier completion event. Opening raises
the existing dispute hold; buyer withdrawal or an independent decision closes
that exact hold in the same transaction. An ordered refund becomes a retained
due following the existing report -> independent confirmation flow: approval is
never execution and no platform money moves."""

from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import PermissionDenied

from apps.foundation.codes import DISPUTE_REFUSALS, bounded
from apps.foundation.independence import eligible_reviewers
from apps.foundation.money import ZERO
from apps.organizations.access import Conflict
from apps.payments.access import account_for, audit
from apps.payments.validation import fail, money
from apps.runtime.locks import lock
from . import access
from . import aftercare as projection
from . import aftercare_commands as base
from .models import DisputeDecision, DisputeRequest, DisputeResponse, SellerOrder

OUTCOME_FOR_ACTION = {"dismiss": "dismissed", "resolve": "resolved_non_monetary", "refund": "refund_ordered"}


def refuse(code):
    fail("dispute", bounded(code, DISPUTE_REFUSALS))


def requesters(actor):
    if actor.context == "buyer":
        return SellerOrder.objects.filter(buyer=actor.account)
    if actor.context == "seller":
        return SellerOrder.objects.filter(seller_id__in=access.profiles(actor.account).values("pk"))
    raise PermissionDenied()


def requester_allowed(order, actor):
    return actor.context == "buyer" and order.buyer_id == account_for(actor).pk


def responder_allowed(order, actor):
    """The individual seller owner or an active member holding orders_negotiation."""
    return actor.context == "seller" and access.profiles(account_for(actor)).filter(pk=order.seller_id).exists()


def terminal(order):
    """Refusals that hold even while this dispute is the open one."""
    if not projection.delivered(order):
        refuse("dispute_not_delivered")
    if projection.cancelled(order):
        refuse("dispute_ineligible_cancelled")


def eligibility(order):
    terminal(order)
    if projection.pending_dispute(order):
        refuse("dispute_request_pending")


def requester_current(order, dispute):
    """The opening buyer must still be the current, active order buyer."""
    account = dispute.requester_account
    return (
        account.status == "active"
        and account.user.is_active
        and account.user.email_verified
        and order.buyer_id == account.pk
    )


def independent(order, user, *, dispute=None):
    from apps.payments.access import independent as goods_independent

    goods_independent(order, user)
    access.aftercare_participant(order, user)
    if dispute is not None and (
        DisputeResponse.objects.filter(dispute=dispute, actor__user=user).exists()
        or dispute.evidence_bindings.filter(evidence__creator__user=user).exists()
    ):
        raise PermissionDenied("A response or evidence author cannot decide this dispute.")


def reviewers(dispute):
    from apps.fulfilment import models as delivery_models
    from apps.fulfilment.review import reviewers as hold_reviewers

    case = (
        delivery_models.ReviewCase.objects.filter(blocker_id=dispute.blocker_id, state="open").first()
        if dispute.blocker_id
        else None
    )
    hold_candidates = {user.pk for user in hold_reviewers(case)} if case else None
    return [
        user
        for user in eligible_reviewers(
            "orders",
            "read_dispute",
            "decide_dispute",
            lambda user: independent(dispute.order, user, dispute=dispute),
        )
        if hold_candidates is None or user.pk in hold_candidates
    ]


def order_scope(actor):
    if actor.context == "owner":
        return SellerOrder.objects.all()
    if actor.context == "staff":
        return SellerOrder.objects.filter(disputes__in=access.dispute_scope(actor)).distinct()
    return requesters(actor)


def raise_hold(order, dispute, actor, reason):
    from apps.fulfilment import models as delivery_models
    from apps.fulfilment import services as delivery

    state = delivery.coordinator(order)
    event = delivery.emit(order, state, "dispute_hold", actor)
    blocker = delivery_models.Blocker.construction.create(order=order, event=event, kind="dispute", reason=reason)
    delivery.new_case(order, "blocker", blocker.pk, blocker=blocker)
    dispute.blocker = blocker
    dispute.save(update_fields=["blocker"])
    delivery.seal(event)
    return blocker


def close_hold(actor, order, dispute, reason):
    from apps.fulfilment import models as delivery_models
    from apps.fulfilment import review as delivery_review
    from apps.fulfilment import services as delivery

    blocker = dispute.blocker
    if blocker is None:
        raise Conflict("The exact linked dispute hold is required before decision.")
    case = delivery_models.ReviewCase.objects.select_for_update().filter(
        order=order, blocker=blocker, kind="blocker", state="open",
    ).first()
    if case is None:
        raise Conflict("The exact linked dispute case must still be open.")
    state = delivery.coordinator(order)
    _, event = delivery_review.decide(
        actor,
        order,
        state,
        "clear",
        {"case": case.pk, "case_version": case.version, "disposition": "decided", "reason": reason},
    )
    delivery.seal(event)
    return case


def withdraw_hold(actor, order, dispute, reason):
    """Close only this buyer's linked dispute hold, never an ordinary staff clear."""
    from apps.fulfilment import models as delivery_models
    from apps.fulfilment import services as delivery

    if not requester_allowed(order, actor) or dispute.state != "withdrawn" or dispute.blocker_id is None:
        raise Conflict("The exact withdrawn buyer dispute hold is required.")
    case = get_object_or_404(
        delivery_models.ReviewCase.objects.select_for_update(),
        order=order, blocker_id=dispute.blocker_id, kind="blocker", state="open",
    )
    state = delivery.coordinator(order)
    event = delivery.emit(order, state, "dispute_withdrawn", actor)
    delivery_models.BlockerClosure.construction.create(
        order=order, event=event, blocker_id=dispute.blocker_id, disposition="withdrawn", reason=reason,
    )
    delivery_models.CaseEvent.construction.create(
        order=order, event=event, case=case, case_version=case.version + 1,
        action="withdraw", assigned_to=case.assigned_to, reason=reason,
    )
    case.state = "resolved"
    case.version += 1
    case.save(update_fields=["state", "version"])
    delivery.seal(event)
    return case


def assign_hold(actor, order, dispute, assigned, reason):
    """The linked dispute hold follows the reviewer assigned to the dispute."""
    from apps.fulfilment import models as delivery_models
    from apps.fulfilment import review as delivery_review
    from apps.fulfilment import services as delivery

    blocker = dispute.blocker
    if blocker is None or assigned is None:
        return None
    case = delivery_models.ReviewCase.objects.select_for_update().filter(blocker=blocker, state="open").first()
    if case is None:
        return None
    if case.assigned_to_id == assigned.pk:
        return case
    state = delivery.coordinator(order)
    _, event = delivery_review.decide(
        actor,
        order,
        state,
        "assign",
        {"case": case.pk, "case_version": case.version, "assigned_to": assigned.pk, "reason": reason},
    )
    delivery.seal(event)
    return case


def _open(actor, order, state, data):
    from apps.payments.services import bind

    if not requester_allowed(order, actor):
        raise PermissionDenied()
    eligibility(order)
    reason = base.text(data.get("reason"))
    event = base.emit(order, state, "dispute_opened", actor)
    dispute = DisputeRequest.objects.create(
        order=order,
        requester_account=account_for(actor),
        reason=reason,
        event=event,
    )
    bind(actor, order, data.get("evidence") or [], dispute=dispute)
    raise_hold(order, dispute, actor, reason)
    base.notify(order, event, sender=actor.user)
    audit(actor, dispute, "dispute_opened", reason)
    return {"dispute": str(dispute.pk), "state": dispute.state, "version": state.version}


def _withdraw(actor, order, state, data):
    dispute = get_object_or_404(
        DisputeRequest.objects.select_for_update(),
        pk=data.get("dispute"),
        order=order,
        state="pending",
        requester_account=account_for(actor),
    )
    if not requester_allowed(order, actor):
        refuse("dispute_not_requester")
    reason = base.text(data.get("reason"))
    event = base.emit(order, state, "dispute_withdrawn", actor)
    dispute.state = "withdrawn"
    dispute.version += 1
    dispute.save(update_fields=["state", "version"])
    withdraw_hold(actor, order, dispute, reason)
    from apps.fulfilment.completion import reconcile_locked

    reconcile_locked(order)
    base.notify(order, event, sender=actor.user)
    audit(actor, dispute, "dispute_withdrawn", reason)
    return {"dispute": str(dispute.pk), "state": dispute.state, "version": state.version}


def _respond(actor, order, state, data):
    if not responder_allowed(order, actor):
        refuse("dispute_not_responder")
    dispute = get_object_or_404(
        DisputeRequest.objects.select_for_update(), pk=data.get("dispute"), order=order, state="pending"
    )
    if DisputeResponse.objects.filter(dispute=dispute).exists():
        raise Conflict("This dispute already has a retained seller response.")
    text = base.text(data.get("text"), field="text", maximum=2000)
    event = base.emit(order, state, "dispute_response", actor)
    DisputeResponse.objects.create(dispute=dispute, actor=account_for(actor), text=text, event=event)
    dispute.version += 1
    dispute.save(update_fields=["version"])
    base.notify(order, event, sender=actor.user)
    audit(actor, dispute, "dispute_response", "Seller dispute response recorded")
    return {"dispute": str(dispute.pk), "state": dispute.state, "version": state.version}


def mutate(actor, pk, action, data):
    key = base.identifier(data.get("command_id"))
    fingerprint = base.digest_of(action, pk, data)
    with transaction.atomic():
        lock("aftercare-command:" + str(key))
        order = base.lock_order(actor, pk, requesters(actor))
        if actor.context not in {"buyer", "seller"}:
            raise PermissionDenied()
        old = base.previous(actor, order, key, action, fingerprint)
        if old is not None:
            return old
        _, state = base.ordered_state(order)
        base.expect(state.version, data.get("version"), refuse, "dispute_stale_version")
        if action == "dispute_open":
            result = _open(actor, order, state, data)
        elif action == "dispute_withdraw":
            result = _withdraw(actor, order, state, data)
        elif action == "dispute_respond":
            result = _respond(actor, order, state, data)
        else:
            raise PermissionDenied()
        return base.remember(actor, order, key, action, fingerprint, result)


def reconcile(actor, order_pk, key):
    return base.lookup(actor, order_pk, base.identifier(key), requesters(actor))


def settle(actor, order_pk, key):
    return base.lookup(actor, order_pk, base.identifier(key), requesters(actor), fence=True)


def refund_bound(order):
    """Confirmed receipts less every retained prior due, never negative."""
    from apps.payments import refunds
    from apps.payments.queries import confirmed

    return max(confirmed(order) - refunds.due_total(order), ZERO)


def _decide(actor, order, state, finance, dispute, data, action):
    from apps.payments import refunds

    terminal(order)
    if not requester_current(order, dispute):
        refuse("dispute_not_requester")
    outcome = OUTCOME_FOR_ACTION[action]
    reason = base.text(data.get("reason"))
    amount = None
    due = None
    if action == "refund":
        amount = money(data.get("amount"))
        available = refund_bound(order)
        if available <= ZERO or amount > available:
            refuse("dispute_refund_amount_invalid")
    event = base.emit(order, state, "dispute_decided", actor)
    if action == "refund":
        due = refunds.create_due(order, finance, actor, "dispute", amount, reason)
        if due is None:
            refuse("dispute_refund_amount_invalid")
    DisputeDecision.objects.create(
        dispute=dispute,
        event=event,
        actor=actor.user,
        account=account_for(actor),
        context=actor.context,
        action=outcome,
        amount=amount,
        refund_due=due,
        reason=reason,
    )
    dispute.state = outcome
    dispute.version += 1
    dispute.save(update_fields=["state", "version"])
    if due is not None:
        from apps.payments.models import RefundSeal
        from apps.notifications.aftercare_events import publish

        RefundSeal.objects.create(due=due)
        publish(order, payment_event=due.event, sender_user=actor.user)
    close_hold(actor, order, dispute, reason)
    from apps.fulfilment.completion import reconcile_locked

    reconcile_locked(order)
    base.notify(order, event, sender=None)
    audit(actor, dispute, "dispute_decided", reason)
    return {
        "dispute": str(dispute.pk),
        "state": dispute.state,
        "version": state.version,
        "refund_due": str(due.pk) if due else None,
    }


def decide(actor, pk, data):
    key = base.identifier(data.get("command_id"))
    action = data.get("action")
    initial = get_object_or_404(access.dispute_scope(actor).select_related("order"), pk=pk)
    if action not in {"assign", "dismiss", "resolve", "refund"}:
        fail("action")
    sealed = "dispute_" + action
    fingerprint = base.digest_of(sealed, initial.order_id, data)
    with transaction.atomic():
        lock("aftercare-command:" + str(key))
        additional = [base.identifier(data["assigned_to"])] if action == "assign" and data.get("assigned_to") else []
        order = base.lock_order(actor, initial.order_id, order_scope(actor), additional_users=additional)
        dispute = get_object_or_404(access.dispute_scope(actor).select_for_update(), pk=pk)
        old = base.previous(actor, order, key, sealed, fingerprint)
        if old is not None:
            return old
        finance, state = base.ordered_state(order)
        base.expect(state.version, data.get("version"), refuse, "dispute_stale_version")
        base.expect(dispute.version, data.get("dispute_version"), refuse, "dispute_stale_version")
        assigned = None
        if action == "assign":
            if "assign_dispute" not in access.aftercare_rights(actor):
                raise PermissionDenied()
            if dispute.state != "pending":
                raise Conflict("This dispute already has a retained decision.")
            if data.get("assigned_to"):
                assigned = next((u for u in reviewers(dispute) if str(u.pk) == str(data["assigned_to"])), None)
                if assigned is None:
                    raise PermissionDenied("Choose an eligible independent reviewer.")
        else:
            if dispute.state != "pending":
                raise Conflict("This dispute already has a retained decision.")
            if "decide_dispute" not in access.aftercare_rights(actor):
                raise PermissionDenied()
            if dispute.assigned_to_id != actor.user.pk:
                raise PermissionDenied("Assign an independent eligible reviewer first.")
            independent(order, actor.user, dispute=dispute)
        if action == "assign":
            reason = base.text(data.get("reason"))
            base.emit(order, state, "dispute_assigned", actor)
            dispute.assigned_to = assigned
            dispute.version += 1
            dispute.save(update_fields=["assigned_to", "version"])
            assign_hold(actor, order, dispute, assigned, reason)
            audit(actor, dispute, "dispute_assigned", reason)
            result = {"dispute": str(dispute.pk), "state": dispute.state, "version": state.version}
        else:
            result = _decide(actor, order, state, finance, dispute, data, action)
        return base.remember(actor, order, key, sealed, fingerprint, result)