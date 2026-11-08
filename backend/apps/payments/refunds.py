"""Seller-issued goods refund dues, reports and independent staff decisions.

A due is sealed at creation and bounded by confirmed received money. A
confirmed report reduces the remaining refund due only; it never reduces
confirmed received, edits a sealed receipt or moves platform money."""

from django.db import transaction
from django.db.models import Sum
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import NotFound, PermissionDenied

from apps.foundation.independence import eligible_reviewers
from apps.foundation.money import ZERO
from apps.orders import aftercare
from apps.orders.access import aftercare_rights
from apps.orders.models import SellerOrder
from apps.organizations.access import Conflict
from apps.runtime.locks import lock
from . import access, queries, services, validation as v
from .models import RefundDecision, RefundDue, RefundReport, RefundSeal


def due_total(order):
    return RefundDue.objects.filter(order_id=order.pk).aggregate(value=Sum("amount"))["value"] or ZERO


def refunded_total(order):
    return (
        RefundReport.objects.filter(due__order_id=order.pk, decision__action="confirmed")
        .aggregate(value=Sum("amount"))["value"]
        or ZERO
    )


def create_due(order, state, actor, cause, amount, reason):
    """Seal one bounded refund due inside the caller's ordered transaction.

    Total dues stay within confirmed received so confirmed refunds can never
    exceed what the seller actually confirmed, whatever earlier dues exist."""
    if cause not in {"cancellation", "amendment", "excess"}:
        v.fail("cause")
    confirmed = queries.confirmed(order)
    bounded = min(amount, confirmed - due_total(order))
    if bounded <= ZERO:
        return None
    event = services.emit(order, state, "refund_due_created", actor)
    due = RefundDue.objects.create(order=order, cause=cause, amount=bounded, currency=order.currency, event=event)
    RefundSeal.objects.create(due=due)
    from apps.notifications.aftercare_events import publish

    publish(order, payment_event=event, sender_user=actor.user if actor else None)
    return due


def independent(order, user):
    access.independent(order, user)
    if RefundReport.objects.filter(due__order_id=order.pk, actor__user=user).exists():
        raise PermissionDenied("An independent reviewer is required.")


def reviewers(due):
    return eligible_reviewers(
        "payments",
        "read_payments",
        "decide_goods_refund",
        lambda user: independent(due.order, user),
        active_staff_account=True,
    )


def refund_scope(actor):
    if actor.context == "owner":
        return RefundDue.objects.all()
    if actor.context != "staff" or "read_payments" not in access.rights(actor):
        return RefundDue.objects.none()
    qs = (
        RefundDue.objects.exclude(order__buyer__user=actor.user)
        .exclude(order__seller__account__user=actor.user)
        .exclude(order__seller__memberships__account__user=actor.user)
        .exclude(order__buyer__business_profiles__memberships__account__user=actor.user)
        .exclude(order__goods_receipts__actor__user=actor.user)
        .exclude(order__payment_plans__actor__user=actor.user)
        .exclude(order__amendments__actor__user=actor.user)
        .exclude(reports__actor__user=actor.user)
    )
    if "assign_aftercare" not in aftercare_rights(actor):
        qs = qs.filter(assigned_to=actor.user)
    return qs.distinct()


def order_scope(actor):
    if actor.context == "owner":
        return SellerOrder.objects.all()
    if actor.context == "staff":
        return SellerOrder.objects.filter(refund_dues__in=refund_scope(actor)).distinct()
    return SellerOrder.objects.none()


def require_due(actor, due, *, decide=False):
    if "read_payments" not in access.rights(actor) or not refund_scope(actor).filter(pk=due.pk).exists():
        raise NotFound()
    if actor.context != "owner" and due.assigned_to_id != actor.user.pk:
        raise NotFound()
    if decide:
        if due.assigned_to_id != actor.user.pk:
            raise PermissionDenied("Assign an independent eligible reviewer first.")
        independent(due.order, actor.user)


def _due(actor, order, state, data):
    if actor.context != "seller" or not access.capabilities(actor, order)["refund"]:
        raise PermissionDenied()
    if aftercare.cancelled(order):
        v.fail("refund", "order_cancelled")
    confirmed = queries.confirmed(order)
    accepted = aftercare.accepted_total(order)
    amount = v.money(data.get("amount"))
    excess = max(confirmed - accepted - due_total(order), ZERO)
    if amount > excess:
        v.fail("amount", "excess_bound")
    due = create_due(order, state, actor, "excess", amount, v.text(data.get("reason")))
    return {"refund_due": str(due.pk), "version": state.version}


def pending_report(due):
    return (
        RefundReport.objects.select_for_update()
        .filter(due=due, decision__isnull=True)
        .order_by("-created_at", "pk")
        .first()
    )


def _report(actor, order, state, data):
    if actor.context != "seller" or not access.capabilities(actor, order)["refund"]:
        raise PermissionDenied()
    due = get_object_or_404(RefundDue.objects.select_for_update(), pk=data.get("due"), order=order)
    if RefundDecision.objects.filter(report__due=due, action="confirmed").exists():
        raise Conflict("This refund due is already confirmed.")
    latest = (
        RefundReport.objects.select_for_update().filter(due=due).order_by("-created_at", "pk").first()
    )
    previous = None
    if latest is not None:
        decision = RefundDecision.objects.filter(report=latest).first()
        if decision is None:
            raise Conflict("A pending refund report already exists for this due.")
        if decision.action not in {"withdrawn", "rejected"}:
            raise Conflict()
        if str(data.get("previous") or latest.pk) != str(latest.pk):
            v.fail("previous", "latest_report")
        if RefundReport.objects.filter(previous=latest).exists():
            raise Conflict()
        previous = latest
    amount = v.money(data.get("amount"))
    if amount != due.amount:
        v.fail("amount", "exact_due_amount")
    fields = {
        "sent_at": v.paid_time(data.get("sent_at")),
        "reference": v.text(data.get("reference"), "reference", 160, 1),
        "description": v.text(data.get("description"), "description", 500, 1),
    }
    event = services.emit(order, state, "refund_reported", actor)
    report = RefundReport.objects.create(
        due=due, previous=previous, actor=actor.account, event=event, amount=amount, **fields
    )
    services.bind(actor, order, data.get("evidence", []), report=report)
    from apps.notifications.aftercare_events import publish

    publish(order, payment_event=event, sender_user=actor.user)
    return {"report": str(report.pk), "version": state.version}


def _withdraw(actor, order, state, data):
    report = get_object_or_404(
        RefundReport.objects.select_for_update(), pk=data.get("report"), due__order=order, actor=actor.account
    )
    if RefundDecision.objects.filter(report=report).exists():
        raise Conflict()
    if actor.context != "seller":
        raise PermissionDenied()
    reason = v.text(data.get("reason"))
    event = services.emit(order, state, "refund_withdrawn", actor)
    RefundDecision.objects.create(
        report=report,
        event=event,
        actor=actor.user,
        account=access.account_for(actor),
        context=actor.context,
        action="withdrawn",
        reason=reason,
    )
    from apps.notifications.aftercare_events import publish

    publish(order, payment_event=event, sender_user=actor.user)
    return {"report": str(report.pk), "state": "withdrawn", "version": state.version}


def mutate(actor, pk, action, data):
    key = v.identifier(data.get("command_id"), "command_id")
    fingerprint = v.digest(action, pk, data)
    with transaction.atomic():
        lock("payments-command:" + str(key))
        order = access.lock_order(actor, pk, write=actor.context == "seller")
        if actor.context != "seller":
            raise PermissionDenied()
        old = services.previous(actor, order, key, action, fingerprint)
        if old is not None:
            result = old
        else:
            state = services.coordinator(order)
            services.expect(state.version, data.get("version"))
            if action == "due":
                result = _due(actor, order, state, data)
            elif action == "report":
                result = _report(actor, order, state, data)
            elif action == "refund_withdraw":
                result = _withdraw(actor, order, state, data)
            else:
                raise PermissionDenied()
            result = services.command_result(actor, order, key, action, fingerprint, result)
    return result


def _confirm(actor, order, state, due, data):
    report = pending_report(due)
    if report is None or report.amount != due.amount:
        raise Conflict("One pending report for the exact due amount is required before confirmation.")
    if refunded_total(order) + due.amount > queries.confirmed(order):
        raise Conflict("Confirmed refunds cannot exceed confirmed received money.")
    reason = v.text(data.get("reason"))
    event = services.emit(order, state, "refund_confirmed", actor)
    RefundDecision.objects.create(
        report=report,
        event=event,
        actor=actor.user,
        account=access.account_for(actor),
        context=actor.context,
        action="confirmed",
        reason=reason,
    )
    due.version += 1
    due.save(update_fields=["version"])
    access.audit(actor, due, "refund_confirmed", reason)
    from apps.notifications.aftercare_events import publish

    publish(order, payment_event=event, sender_user=None)
    return {"due": str(due.pk), "state": "confirmed", "version": state.version}


def _reject(actor, order, state, due, data):
    report = pending_report(due)
    if report is None:
        raise Conflict("A pending refund report is required before a decision.")
    reason = v.text(data.get("reason"))
    event = services.emit(order, state, "refund_rejected", actor)
    RefundDecision.objects.create(
        report=report,
        event=event,
        actor=actor.user,
        account=access.account_for(actor),
        context=actor.context,
        action="rejected",
        reason=reason,
    )
    due.version += 1
    due.save(update_fields=["version"])
    access.audit(actor, due, "refund_rejected", reason)
    from apps.notifications.aftercare_events import publish

    publish(order, payment_event=event, sender_user=None)
    return {"due": str(due.pk), "state": "rejected", "version": state.version}


def decide(actor, pk, data):
    key = v.identifier(data.get("command_id"))
    action = data.get("action")
    initial = get_object_or_404(refund_scope(actor).select_related("order"), pk=pk)
    if action not in {"assign", "confirm", "reject"}:
        v.fail("action")
    fingerprint = v.digest("refund_" + action, initial.order_id, data)
    with transaction.atomic():
        lock("payments-command:" + str(key))
        additional = [v.identifier(data["assigned_to"])] if action == "assign" and data.get("assigned_to") else []
        order = access.lock_order(actor, initial.order_id, selected=order_scope(actor), additional_users=additional)
        due = get_object_or_404(refund_scope(actor).select_for_update(), pk=pk)
        old = services.previous(actor, order, key, "refund_" + action, fingerprint)
        if old is not None:
            return old
        state = services.coordinator(order)
        services.expect(state.version, data.get("version"))
        services.expect(due.version, data.get("due_version"))
        assigned = None
        if action == "assign":
            if "assign_aftercare" not in aftercare_rights(actor):
                raise PermissionDenied()
            if data.get("assigned_to"):
                assigned = next((u for u in reviewers(due) if str(u.pk) == str(data["assigned_to"])), None)
                if assigned is None:
                    raise PermissionDenied("Choose an eligible independent reviewer.")
        else:
            if "decide_goods_refund" not in access.rights(actor):
                raise PermissionDenied()
            require_due(actor, due, decide=True)
            if RefundDecision.objects.filter(report__due=due, action="confirmed").exists():
                raise Conflict("This refund due already has a retained confirmation.")
        if action == "assign":
            event = services.emit(order, state, "refund_assigned", actor)
            due.assigned_to = assigned
        elif action == "confirm":
            result = _confirm(actor, order, state, due, data)
        else:
            result = _reject(actor, order, state, due, data)
        if action == "assign":
            due.version += 1
            due.save(update_fields=["assigned_to", "version"])
            access.audit(actor, due, "refund_assigned", v.text(data.get("reason")))
            from apps.notifications.aftercare_events import publish

            publish(order, payment_event=event, sender_user=None)
            result = {"due": str(due.pk), "state": "open", "version": state.version}
        return services.command_result(actor, order, key, "refund_" + action, fingerprint, result)
