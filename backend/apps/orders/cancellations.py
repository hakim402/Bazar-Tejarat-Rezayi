"""Cancellation requests, withdrawals and independent terminal decisions.

Every cancellation takes effect before dispatch only. A pending request raises
the existing operational hold; approval is terminal and releases the unshipped
advance allocation exactly once."""

import uuid

from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import PermissionDenied

from apps.foundation.independence import eligible_reviewers
from apps.foundation.money import ZERO
from apps.organizations.access import Conflict
from apps.payments.access import account_for, audit
from apps.payments.validation import fail
from apps.runtime.locks import lock
from . import access
from . import aftercare as projection
from . import aftercare_commands as base
from .models import (
    CancellationDecision,
    CancellationRequest,
    InvoiceAdjustment,
    SellerOrder,
)


def refuse(code):
    fail("cancellation", code)


def requesters(actor):
    if actor.context == "buyer":
        return SellerOrder.objects.filter(buyer=actor.account)
    if actor.context == "seller":
        return SellerOrder.objects.filter(seller_id__in=access.profiles(actor.account).values("pk"))
    raise PermissionDenied()


def requester_allowed(order, actor):
    account = account_for(actor)
    if actor.context == "buyer":
        return order.buyer_id == account.pk
    if actor.context == "seller":
        return access.profiles(account).filter(pk=order.seller_id).exists()
    return False


def terminal(order):
    """Refusals that hold even while this request is the open one."""
    if projection.completed(order):
        refuse("cancellation_ineligible_completed")
    if projection.dispatched(order):
        refuse("cancellation_ineligible_dispatched")
    if projection.cancelled(order):
        refuse("cancellation_already_decided")


def eligibility(order):
    terminal(order)
    if projection.pending_cancellation(order):
        refuse("cancellation_request_pending")


def requester_current(order, request):
    account = request.requester_account
    if account is None:
        user = request.requester_user
        return (
            request.requester_context == "staff"
            and user.is_active
            and user.email_verified
            and user.is_staff
        )
    if not account.user.is_active or not account.user.email_verified or account.status != "active":
        return False
    if request.requester_context == "buyer":
        return order.buyer_id == account.pk
    return access.profiles(account).filter(pk=order.seller_id).exists()


def independent(order, user, *, request=None):
    from apps.payments.access import independent as goods_independent

    goods_independent(order, user)
    access.aftercare_participant(order, user)
    if request is not None and request.requester_user_id == user.pk:
        raise PermissionDenied("The initiating staff member cannot decide this cancellation.")


def reviewers(request):
    from apps.fulfilment import models as delivery_models
    from apps.fulfilment.review import reviewers as hold_reviewers

    case = delivery_models.ReviewCase.objects.filter(blocker_id=request.blocker_id, state="open").first() if request.blocker_id else None
    hold_candidates = {user.pk for user in hold_reviewers(case)} if case else None
    return [
        user for user in eligible_reviewers(
            "orders",
            "read_aftercare",
            "decide_cancellation",
            lambda user: independent(request.order, user, request=request),
        )
        if hold_candidates is None or user.pk in hold_candidates
    ]


def order_scope(actor):
    if actor.context == "owner":
        return SellerOrder.objects.all()
    if actor.context == "staff":
        return SellerOrder.objects.filter(cancellation_requests__in=access.cancellation_scope(actor)).distinct()
    return requesters(actor)


def raise_hold(order, request, actor, reason):
    from apps.fulfilment import models as delivery_models
    from apps.fulfilment import services as delivery

    state = delivery.coordinator(order)
    event = delivery.emit(order, state, "cancellation_hold", actor)
    blocker = delivery_models.Blocker.construction.create(order=order, event=event, kind="cancellation", reason=reason)
    delivery.new_case(order, "blocker", blocker.pk, blocker=blocker)
    delivery.seal(event)
    request.blocker = blocker
    request.save(update_fields=["blocker"])
    return blocker


def close_hold(actor, order, request, reason):
    from apps.fulfilment import models as delivery_models
    from apps.fulfilment import review as delivery_review
    from apps.fulfilment import services as delivery

    blocker = request.blocker
    if blocker is None:
        return None
    case = delivery_models.ReviewCase.objects.select_for_update().filter(blocker=blocker).first()
    if case is None or case.state != "open":
        return None
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


def assign_hold(actor, order, request, assigned, reason):
    """The linked cancellation hold follows the reviewer assigned to the request."""
    from apps.fulfilment import models as delivery_models
    from apps.fulfilment import review as delivery_review
    from apps.fulfilment import services as delivery

    blocker = request.blocker
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


def release_allocation(actor, order, token):
    from apps.inventory.payment_allocation import RecordedIdentity, release_whole

    return release_whole(
        order,
        token,
        RecordedIdentity(actor.user, account_for(actor), actor.context),
        "cancellation:" + str(order.pk),
    )


def write_adjustment(actor, order, event, reason, *, cancellation, before_lines, before_total, after_lines, after_total):
    return InvoiceAdjustment.objects.create(
        order=order,
        invoice=order.invoice,
        cause="cancellation",
        cancellation=cancellation,
        before_lines=before_lines,
        after_lines=after_lines,
        before_total=before_total,
        after_total=after_total,
        reason=reason,
        actor=actor.user,
        event=event,
    )


def _request(actor, order, state, data):
    if not requester_allowed(order, actor):
        raise PermissionDenied()
    eligibility(order)
    reason = base.text(data.get("reason"))
    event = base.emit(order, state, "cancellation_requested", actor)
    request = CancellationRequest.objects.create(
        order=order,
        requester_account=account_for(actor),
        requester_context=actor.context,
        reason=reason,
        event=event,
    )
    raise_hold(order, request, actor, reason)
    base.notify(order, event, sender=actor.user)
    audit(actor, request, "cancellation_requested", reason)
    return {"request": str(request.pk), "state": request.state, "version": state.version}


def _withdraw(actor, order, state, data):
    request = get_object_or_404(
        CancellationRequest.objects.select_for_update(),
        pk=data.get("request"),
        order=order,
        state="pending",
        requester_context__in=["buyer", "seller"],
        requester_account=account_for(actor),
    )
    if not requester_allowed(order, actor):
        refuse("cancellation_not_requester")
    reason = base.text(data.get("reason"))
    event = base.emit(order, state, "cancellation_withdrawn", actor)
    request.state = "withdrawn"
    request.version += 1
    request.save(update_fields=["state", "version"])
    base.notify(order, event, sender=actor.user)
    audit(actor, request, "cancellation_withdrawn", reason)
    return {"request": str(request.pk), "state": request.state, "version": state.version}


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
            result = old
        else:
            _, state = base.ordered_state(order)
            base.expect(state.version, data.get("version"), refuse, "cancellation_stale_version")
            if action == "request":
                result = _request(actor, order, state, data)
            elif action == "withdraw":
                result = _withdraw(actor, order, state, data)
            else:
                raise PermissionDenied()
            result = base.remember(actor, order, key, action, fingerprint, result)
    return result


def reconcile(actor, order_pk, key):
    return base.lookup(actor, order_pk, base.identifier(key), requesters(actor))


def settle(actor, order_pk, key):
    return base.lookup(actor, order_pk, base.identifier(key), requesters(actor), fence=True)


def _approve(actor, order, state, finance, request, data, key):
    from apps.payments.queries import confirmed
    from apps.payments import refunds

    terminal(order)
    if not requester_current(order, request):
        refuse("cancellation_not_requester")
    reason = base.text(data.get("reason"))
    event = base.emit(order, state, "cancellation_approved", actor)
    before_lines = projection.before_lines_snapshot(order)
    before_total = projection.accepted_total(order)
    CancellationDecision.objects.create(
        request=request,
        event=event,
        actor=actor.user,
        account=account_for(actor),
        context=actor.context,
        action="approved",
        reason=reason,
    )
    request.state = "approved"
    request.version += 1
    request.save(update_fields=["state", "version"])
    release = release_allocation(actor, order, uuid.uuid5(order.pk, "cancellation-release:" + str(key)))
    received = confirmed(order)
    amount = max(received - refunds.due_total(order), ZERO)
    due = refunds.create_due(order, finance, actor, "cancellation", amount, reason) if amount > ZERO else None
    write_adjustment(
        actor,
        order,
        event,
        reason,
        cancellation=request,
        before_lines=before_lines,
        before_total=before_total,
        after_lines=[],
        after_total=ZERO,
    )
    close_hold(actor, order, request, reason)
    base.notify(order, event, sender=None)
    audit(actor, request, "cancellation_approved", reason)
    return {
        "request": str(request.pk),
        "state": request.state,
        "version": state.version,
        "release": str(release["operation"]) if release else None,
        "refund_due": str(due.pk) if due else None,
    }


def _reject(actor, order, state, request, data):
    terminal(order)
    if not requester_current(order, request):
        refuse("cancellation_not_requester")
    reason = base.text(data.get("reason"))
    event = base.emit(order, state, "cancellation_rejected", actor)
    CancellationDecision.objects.create(
        request=request,
        event=event,
        actor=actor.user,
        account=account_for(actor),
        context=actor.context,
        action="rejected",
        reason=reason,
    )
    request.state = "rejected"
    request.version += 1
    request.save(update_fields=["state", "version"])
    close_hold(actor, order, request, reason)
    base.notify(order, event, sender=None)
    audit(actor, request, "cancellation_rejected", reason)
    return {"request": str(request.pk), "state": request.state, "version": state.version}


def decide(actor, pk, data):
    key = base.identifier(data.get("command_id"))
    action = data.get("action")
    initial = get_object_or_404(access.cancellation_scope(actor).select_related("order"), pk=pk)
    if action not in {"assign", "approve", "reject"}:
        fail("action")
    fingerprint = base.digest_of("cancellation_" + action, initial.order_id, data)
    token = uuid.uuid5(initial.order_id, "cancellation-release:" + str(key)) if action == "approve" else None
    with transaction.atomic():
        lock("aftercare-command:" + str(key))
        if token is not None:
            lock(int(token.hex[:15], 16))
        additional = [base.identifier(data["assigned_to"])] if action == "assign" and data.get("assigned_to") else []
        order = base.lock_order(actor, initial.order_id, order_scope(actor), additional_users=additional)
        request = get_object_or_404(access.cancellation_scope(actor).select_for_update(), pk=pk)
        old = base.previous(actor, order, key, "cancellation_" + action, fingerprint)
        if old is not None:
            return old
        finance, state = base.ordered_state(order)
        base.expect(state.version, data.get("version"), refuse, "cancellation_stale_version")
        base.expect(request.version, data.get("request_version"), refuse, "cancellation_stale_version")
        assigned = None
        if action == "assign":
            if "assign_aftercare" not in access.aftercare_rights(actor):
                raise PermissionDenied()
            if data.get("assigned_to"):
                assigned = next((u for u in reviewers(request) if str(u.pk) == str(data["assigned_to"])), None)
                if assigned is None:
                    raise PermissionDenied("Choose an eligible independent reviewer.")
        else:
            if request.state != "pending":
                raise Conflict("This cancellation request already has a retained decision.")
            if "decide_cancellation" not in access.aftercare_rights(actor):
                raise PermissionDenied()
            if request.assigned_to_id != actor.user.pk:
                raise PermissionDenied("Assign an independent eligible reviewer first.")
            independent(order, actor.user, request=request)
        if action == "assign":
            base.emit(order, state, "cancellation_assigned", actor)
            request.assigned_to = assigned
            reason = base.text(data.get("reason"))
            assign_hold(actor, order, request, assigned, reason)
        elif action == "approve":
            result = _approve(actor, order, state, finance, request, data, key)
        else:
            result = _reject(actor, order, state, request, data)
        if action == "assign":
            request.version += 1
            request.save(update_fields=["assigned_to", "version"])
            audit(actor, request, "cancellation_assigned", base.text(data.get("reason")))
            result = {"request": str(request.pk), "state": request.state, "version": state.version}
        return base.remember(actor, order, key, "cancellation_" + action, fingerprint, result)


def open_from_case(actor, case_pk, data):
    from apps.payments.access import case_scope as payment_cases

    if actor.context not in {"owner", "staff"} or "assign_aftercare" not in access.aftercare_rights(actor):
        raise PermissionDenied()
    case = get_object_or_404(payment_cases(actor).select_related("order"), pk=case_pk, kind="shortage")
    key = base.identifier(data.get("command_id"))
    fingerprint = base.digest_of("cancellation_open", case.order_id, data)
    with transaction.atomic():
        lock("aftercare-command:" + str(key))
        selected = SellerOrder.objects.filter(payment_cases__in=payment_cases(actor)).distinct()
        order = base.lock_order(actor, case.order_id, selected)
        case = get_object_or_404(payment_cases(actor).select_for_update(), pk=case_pk, kind="shortage")
        old = base.previous(actor, order, key, "cancellation_open", fingerprint)
        if old is not None:
            return old
        _, state = base.ordered_state(order)
        base.expect(state.version, data.get("version"), refuse, "cancellation_stale_version")
        eligibility(order)
        from apps.payments.access import require_case
        from apps.payments.models import AllocationIntent
        from apps.payments.queries import confirmed

        require_case(actor, case)
        if case.state not in {"open", "referred"} or confirmed(order) <= ZERO or not AllocationIntent.objects.filter(
            order=order, state__in=["shortage", "review_required"], allocation__isnull=True
        ).exists():
            raise Conflict("A current paid shortage case is required.")
        reason = base.text(data.get("reason"))
        event = base.emit(order, state, "cancellation_opened", actor)
        request = CancellationRequest.objects.create(
            order=order,
            requester_user=actor.user,
            requester_context="staff",
            payment_case=case,
            reason=reason,
            event=event,
        )
        raise_hold(order, request, actor, reason)
        base.notify(order, event, sender=None)
        audit(actor, request, "cancellation_opened", reason)
        result = {"request": str(request.pk), "state": request.state, "version": state.version}
        return base.remember(actor, order, key, "cancellation_open", fingerprint, result)
