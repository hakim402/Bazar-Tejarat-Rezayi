"""Transactional notices; recipient authority is resolved at each disclosure boundary."""

import hashlib
from datetime import timedelta
from django.db import transaction
from django.db.models import F
from django.shortcuts import get_object_or_404
from django.utils import timezone
from apps.messaging import access
from apps.messaging.models import ReadState
from .models import Event, Notice, Outbox, Preference


def identity_digest(account, conversation=None):
    generation = ""
    if conversation is not None and conversation.seller.kind == "company":
        # Existing guarded membership/revocation/transfer services serialize on
        # this profile and advance its version. Old queued authority cannot replay
        # historical email after a membership is revoked and reinstated.
        generation = str(conversation.seller.version)
    return hashlib.sha256(
        f"{account.pk}:{account.user.email}:{account.user.credential_epoch}:{account.access_epoch}:{generation}".encode()
    ).hexdigest()


def enqueue_safely():
    from apps.runtime.jobs import enqueue
    from django.db import DatabaseError
    try:
        enqueue("notice_sweep")
    except DatabaseError:
        pass  # The periodic database sweep recovers the retained intent.


def message_committed(item, message, sender):
    event = Event.objects.create(kind="message", message=message)
    for recipient in access.recipients(item, sender).iterator(chunk_size=100):
        Notice.objects.create(event=event, account=recipient, conversation=item)
        state, _ = ReadState.objects.get_or_create(account=recipient, conversation=item)
        fingerprint = identity_digest(recipient, item)
        pending = Outbox.objects.filter(account=recipient, conversation=item, episode=state.episode).first()
        if state.latest_incoming <= state.last_read:
            state.episode += 1
        elif pending and (
            pending.status == "cancelled"
            or pending.identity_digest != fingerprint
            and pending.status in {"queued", "retry_due", "claimed"}
        ):
            if pending.status != "cancelled":
                pending.status = "cancelled"
                pending.version += 1
                pending.save(update_fields=["status", "version"])
            state.episode += 1
        state.latest_incoming = message.sequence
        state.save(update_fields=["latest_incoming", "episode"])
        preference = Preference.objects.filter(account=recipient).first()
        if preference is None or preference.message_email:
            due = timezone.now() + timedelta(seconds=60)
            if state.last_emailed_at:
                due = max(due, state.last_emailed_at + timedelta(minutes=15))
            Outbox.objects.get_or_create(
                account=recipient,
                conversation=item,
                episode=state.episode,
                defaults={"identity_digest": fingerprint, "due_at": due},
            )
    transaction.on_commit(enqueue_safely)


def report_status(report):
    event = Event.objects.create(kind="report_status", report=report, report_version=report.version)
    item = report.message.conversation
    if access.recipient_allowed(item, report.reporter):
        Notice.objects.create(event=event, account=report.reporter, conversation=item)


def notice_scope(actor, seller=None):
    from django.db.models import Q
    from apps.orders.access import scope as order_scope, profiles
    from apps.organizations.models import BusinessProfile
    from django.shortcuts import get_object_or_404

    account = actor.account
    messages = access.scope(actor)
    orders = order_scope(actor, invoices=True)
    from apps.orders.negotiations import scope as request_scope

    requests = request_scope(actor)
    from apps.payments.access import scope as payment_scope

    payments = payment_scope(actor)
    from apps.fulfilment.access import scope as fulfilment_scope

    fulfilments = fulfilment_scope(actor)
    if seller is not None:
        if actor.context != "seller":
            from rest_framework.exceptions import PermissionDenied

            raise PermissionDenied()
        get_object_or_404(
            BusinessProfile.objects.filter(
                Q(pk__in=access.seller_profiles_for(account).values("pk"))
                | Q(pk__in=profiles(account, invoices=True).values("pk"))
                | Q(pk__in=fulfilment_scope(actor).values("seller_id"))
            ),
            pk=seller,
        )
        messages = messages.filter(seller_id=seller)
        orders = orders.filter(seller_id=seller)
        requests = requests.filter(seller_id=seller)
        payments = payments.filter(seller_id=seller)
        fulfilments = fulfilments.filter(seller_id=seller)
    return Notice.objects.filter(account=account).filter(
        Q(conversation__in=messages)
        | Q(order__in=orders)
        | Q(negotiation__in=requests)
        | Q(payment_order__in=payments)
        | Q(fulfilment_order__in=fulfilments)
        | Q(aftercare_order__in=orders)
    ), messages


def notices(actor, *, seller=None, page=1, unread=False):
    qs, _ = notice_scope(actor, seller)
    if unread:
        qs = qs.filter(read_at__isnull=True)
    rows = qs.select_related(
        "fulfilment_order",
        "event__fulfilment_event",
        "event",
        "conversation",
        "order__invoice",
        "negotiation",
        "event__negotiation_event",
        "payment_order",
        "event__payment_event",
        "aftercare_order",
        "event__aftercare_event",
    ).order_by("-created_at", "pk")[(page - 1) * 20 : page * 20]
    return {
        "count": qs.count(),
        "page": page,
        "results": [
            {
                "id": str(x.pk),
                "kind": x.event.kind,
                "fulfilment": str(x.fulfilment_order_id) if x.fulfilment_order_id else None,
                "payment": str(x.payment_order_id) if x.payment_order_id else None,
                "aftercare": str(x.aftercare_order_id) if x.aftercare_order_id else None,
                "negotiation": str(x.negotiation_id) if x.negotiation_id else None,
                "action": x.event.fulfilment_event.action
                if x.event.fulfilment_event_id
                else x.event.payment_event.action
                if x.event.payment_event_id
                else x.event.aftercare_event.action
                if x.event.aftercare_event_id
                else x.event.negotiation_event.action
                if x.event.negotiation_event_id
                else "",
                "conversation": str(x.conversation_id) if x.conversation_id else None,
                "order": str(x.order_id) if x.order_id else None,
                "invoice": str(x.order.invoice.pk) if x.order_id else None,
                "seller": str(
                    x.fulfilment_order.seller_id
                    if x.fulfilment_order_id
                    else x.payment_order.seller_id
                    if x.payment_order_id
                    else x.aftercare_order.seller_id
                    if x.aftercare_order_id
                    else x.negotiation.seller_id
                    if x.negotiation_id
                    else x.order.seller_id
                    if x.order_id
                    else x.conversation.seller_id
                ),
                "read": x.read_at is not None,
                "created_at": x.created_at,
            }
            for x in rows
        ],
    }


def counts(actor, seller=None):
    qs, messages = notice_scope(actor, seller)
    return {
        "unread_notices": qs.filter(read_at__isnull=True).count(),
        "unread_threads": ReadState.objects.filter(
            account=actor.account, conversation__in=messages, latest_incoming__gt=F("last_read")
        ).count(),
    }


@transaction.atomic
def read_notice(actor, pk):
    qs, _ = notice_scope(actor)
    preliminary = get_object_or_404(
        qs.select_related("conversation", "order", "negotiation", "payment_order", "fulfilment_order", "aftercare_order"),
        pk=pk,
    )
    access.lock_actor(
        actor,
        preliminary.fulfilment_order.seller_id
        if preliminary.fulfilment_order_id
        else preliminary.payment_order.seller_id
        if preliminary.payment_order_id
        else preliminary.aftercare_order.seller_id
        if preliminary.aftercare_order_id
        else preliminary.negotiation.seller_id
        if preliminary.negotiation_id
        else preliminary.order.seller_id
        if preliminary.order_id
        else preliminary.conversation.seller_id,
    )
    qs, _ = notice_scope(actor)
    row = get_object_or_404(qs.select_for_update(), pk=pk)
    if not row.read_at:
        row.read_at = timezone.now()
        row.save(update_fields=["read_at"])
    return {"read": True}


def preference(actor):
    account = actor.account
    row = Preference.objects.filter(account=account).first()
    return {
        "message_email": row.message_email if row else True,
        "payment_email": row.payment_email if row else True,
        "aftercare_email": row.aftercare_email if row else True,
        "locale": row.locale if row else "fa-AF",
        "version": row.version if row else 0,
    }


@transaction.atomic
def set_preference(actor, data):
    account = access.lock_actor(actor)
    row, created = Preference.objects.get_or_create(account=account)
    from apps.messaging.services import CommandConflict

    if data["version"] != (0 if created else row.version):
        raise CommandConflict()
    row.message_email = data["message_email"]
    row.payment_email = data.get("payment_email", row.payment_email)
    row.aftercare_email = data.get("aftercare_email", row.aftercare_email)
    row.locale = data["locale"]
    row.version = 1 if created else row.version + 1
    row.save()
    return preference(actor)
