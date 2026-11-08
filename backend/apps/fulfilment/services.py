"""Command fencing and publication; one retained packet produces one whole effect."""

import hashlib
import uuid
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied
from apps.runtime.locks import lock
from apps.payments.services import coordinator as goods_coordinator
from apps.organizations.access import Conflict
from . import access, models as m, validation as v


def coordinator(order):
    m.State.objects.get_or_create(order=order)
    return m.State.objects.select_for_update().get(order=order)


def emit(order, state, action, actor=None):
    event = m.Event.construction.create(
        order=order,
        version=state.version + 1,
        action=action,
        actor=actor.user if actor else None,
        account=access.account_for(actor) if actor else None,
        context=actor.context if actor else "system",
    )
    state.version += 1
    state.next_check_at = timezone.now()
    state.save(update_fields=["version", "next_check_at"])
    return event


def publish(event):
    m.Publication.objects.create(event=event)
    from apps.notifications.models import Event as NoticeEvent
    from apps.runtime.jobs import enqueue

    NoticeEvent.objects.create(kind="fulfilment", fulfilment_event=event)
    m.NoticeCursor.objects.create(event=event)
    enqueue("fulfilment_sweep")


def seal(event):
    """Publish a fact without a separate participant notice; the aftercare
    notification channel owns the corresponding notice."""
    m.Publication.objects.create(event=event)


def new_case(order, kind, resource, *, audit_source=None, **target):
    key = hashlib.sha256(f"{order.pk}:{kind}:{resource}".encode()).hexdigest()
    case, created = m.ReviewCase.objects.get_or_create(key=key, defaults={"order": order, "kind": kind, **target})
    if created and kind == "exception":
        from apps.accounts.models import AuditEvent

        AuditEvent.objects.create(
            context="system",
            action="fulfilment_exception_queued",
            resource_type="fulfilment.reviewcase",
            resource_id=case.pk,
            reason="Current post-completion facts require independent review",
            state=audit_source or {"source": str(resource)},
        )
    return case


def allowed(actor, order, action):
    caps = access.capabilities(actor, order)
    required = {
        "recipient": "recipient_edit",
        "arrange": "prepare",
        "prepare": "prepare",
        "partial": "partial",
        "charge": "prepare",
        "claim": "claim",
        "withdraw": "claim",
        "correction": "claim",
        "dispatch": "dispatch",
        "tracking": "tracking",
        "deliver": "deliver",
    }
    if action in required:
        if not caps[required[action]]:
            raise PermissionDenied()
    elif action == "upload":
        if not caps["claim"]:
            raise PermissionDenied()
    elif action == "refund":
        if not caps["refund"]:
            raise PermissionDenied()
    elif action == "blocker":
        if (
            actor.context not in {"owner", "staff"}
            or "manage_delivery_holds" not in access.rights(actor)
            or not access.assigned(actor, order)
        ):
            raise PermissionDenied()
    elif not action.startswith("case_") or actor.context not in {"owner", "staff"}:
        raise PermissionDenied()


def previous(actor, order, key, action, digest):
    old = m.Command.objects.filter(pk=key).first()
    if old:
        account = access.account_for(actor)
        if (
            old.actor_id != actor.user.pk
            or old.account_id != (account.pk if account else None)
            or old.context != actor.context
            or old.order_id != order.pk
            or old.action != action
            or old.digest != digest
        ):
            raise Conflict("This command is already settled or belongs to a different packet.")
        return old.result
    return None


def remember(actor, order, key, action, digest, result, event=None):
    m.Command.objects.create(
        id=key,
        order=order,
        actor=actor.user,
        account=access.account_for(actor),
        context=actor.context,
        event=event,
        action=action,
        digest=digest,
        result=v.canonical(result),
    )
    return result


def stock_token(order, key):
    return uuid.uuid5(order, "fulfilment-dispatch:" + str(key))


FROZEN_TRANSITIONS = {
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
}


def mutate(actor, pk, action, data, *, now=None):
    key = v.identifier(data.get("command_id"), "command_id")
    digest = v.digest(action, pk, data)
    with transaction.atomic():
        lock("fulfilment-command:" + str(key))
        if action == "dispatch":
            lock(int(stock_token(v.identifier(pk), key).hex[:15], 16))
        order = access.lock_order(
            actor,
            pk,
            assignment=action == "case_assign",
            additional_users=[v.identifier(data["assigned_to"])] if action == "case_assign" else [],
        )
        finance = goods_coordinator(order)
        state = coordinator(order)
        allowed(actor, order, action)
        old = previous(actor, order, key, action, digest)
        if old is not None:
            return old
        if action in FROZEN_TRANSITIONS:
            from apps.orders import aftercare

            if aftercare.cancelled(order):
                raise Conflict("A cancelled order accepts no new fulfilment actions.")
        v.expect(state.version, data.get("version"))
        v.expect(finance.version, data.get("goods_version"))
        access.audit(actor, order, "fulfilment_" + action, "Guarded physical/delivery transition")
        if action.startswith("case_"):
            from .review import decide

            result, event = decide(actor, order, state, action.removeprefix("case_"), data)
        else:
            from .transitions import APPLY

            result, event = APPLY[action](actor, order, state, data, now=now)
        publish(event)
        result = {**result, "version": event.version}
        remember(actor, order, key, action, digest, result, event)
        from .completion import reconcile_locked

        reconcile_locked(order)
        return result


@transaction.atomic
def lookup(actor, pk, key, *, fence=False):
    if fence:
        lock("fulfilment-command:" + str(key))
    order = access.lock_order(actor, pk)
    command = m.Command.objects.filter(pk=key).first()
    account = access.account_for(actor)
    if command:
        if (
            command.order_id != order.pk
            or command.actor_id != actor.user.pk
            or command.account_id != (account.pk if account else None)
            or command.context != actor.context
        ):
            raise Conflict()
        if command.action != "absence_fence":
            allowed(actor, order, command.action)
        return {"state": "rejected" if command.action == "absence_fence" else "applied", "result": command.result}
    if fence:
        remember(actor, order, key, "absence_fence", "0" * 64, {"settled": True})
        return {"state": "rejected", "result": {"settled": True}}
    return {"state": "unknown", "result": None}


def bind(actor, order, images, *, purpose, **target):
    if not isinstance(images, list) or len(images) > 3 or len(set(str(x) for x in images)) != len(images):
        v.fail("evidence", "three_unique_images")
    for pk in sorted(images, key=str):
        image = get_object_or_404(
            m.Evidence.objects.select_for_update(),
            pk=pk,
            order=order,
            creator=actor.account,
            purpose=purpose,
            expires_at__gt=timezone.now(),
            binding__isnull=True,
        )
        m.EvidenceBinding.objects.create(evidence=image, **target)
