"""Aftercare coordinator, sealed commands and shared ordered locks."""

from django.db import transaction
from apps.accounts.models import Account
from apps.organizations.access import Conflict
from apps.payments.access import lock_order as goods_lock_order
from apps.payments.services import coordinator as goods_coordinator
from apps.payments.validation import digest as fingerprint, identifier as uuid_of, text as bounded_text
from apps.runtime.locks import lock
from .models import Aftercare, AftercareCommand, AftercareEvent


def coordinator(order):
    Aftercare.objects.get_or_create(order=order)
    return Aftercare.objects.select_for_update().get(order=order)


def account_for(actor):
    account = actor.account if actor else None
    return account if isinstance(account, Account) else None


def emit(order, state, action, actor=None):
    event = AftercareEvent.objects.create(
        order=order,
        version=state.version + 1,
        action=action,
        actor=actor.user if actor else None,
        account=account_for(actor),
        context=actor.context if actor else "system",
    )
    state.version += 1
    state.save(update_fields=["version"])
    return event


def notify(order, event, *, sender=None):
    from apps.notifications.aftercare_events import publish

    publish(order, aftercare_event=event, sender_user=sender)


def previous(actor, order, key, action, digest):
    old = AftercareCommand.objects.filter(pk=key).first()
    if not old:
        return None
    account = account_for(actor)
    if (
        old.actor_id != actor.user.pk
        or old.account_id != (account.pk if account else None)
        or old.context != actor.context
        or old.order_id != order.pk
        or old.action != action
        or old.digest != digest
    ):
        raise Conflict("This command identity is settled or was used for different input.")
    return old.result


def remember(actor, order, key, action, digest, result, event=None):
    """Bind the command to the event it produced, as the goods ledger does."""
    if event is None:
        event = (
            AftercareEvent.objects.filter(
                order=order, version=result.get("version"), actor_id=actor.user.pk
            )
            .first()
        )
    AftercareCommand.objects.create(
        id=key,
        order=order,
        actor=actor.user,
        account=account_for(actor),
        context=actor.context,
        event=event,
        action=action,
        digest=digest,
        result=result,
    )
    return result


def lock_order(actor, pk, selected, *, additional_users=()):
    """Canonical aftercare lock sequence reusing the goods financial lock."""
    return goods_lock_order(actor, pk, additional_users=additional_users, selected=selected)


def ordered_state(order):
    """Finance before aftercare state, per the canonical lock order."""
    finance = goods_coordinator(order)
    state = coordinator(order)
    return finance, state


def expect(actual, submitted, refuse, code):
    """Optimistic concurrency: a stale or non-integer version never mutates."""
    if type(submitted) is not int or actual != submitted:
        refuse(code)


@transaction.atomic
def lookup(actor, order_pk, key, selected, *, fence=False):
    if fence:
        lock("aftercare-command:" + str(key))
    order = lock_order(actor, order_pk, selected)
    command = AftercareCommand.objects.filter(pk=key).first()
    account = account_for(actor)
    if command:
        if (
            command.order_id != order.pk
            or command.actor_id != actor.user.pk
            or command.account_id != (account.pk if account else None)
            or command.context != actor.context
        ):
            raise Conflict()
        return {"state": "rejected" if command.action == "absence_fence" else "applied", "result": command.result}
    if fence:
        remember(actor, order, key, "absence_fence", "0" * 64, {"settled": True})
        return {"state": "rejected", "result": {"settled": True}}
    return {"state": "unknown", "result": None}


def identifier(value, field="command_id"):
    return uuid_of(value, field)


def text(value, field="reason", maximum=1000, minimum=3):
    return bounded_text(value, field, maximum, minimum)


def digest_of(action, pk, data):
    return fingerprint(action, str(pk), data)
