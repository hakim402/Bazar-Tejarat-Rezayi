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
    # A broker failure after commit never masquerades as a failed message write.
    try:
        from .tasks import sweep_notifications

        sweep_notifications.delay()
    except Exception:
        pass  # Durable periodic sweep remains the recovery authority.


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
    if seller is not None:
        if actor.context != "seller":
            from rest_framework.exceptions import PermissionDenied

            raise PermissionDenied()
        get_object_or_404(
            BusinessProfile.objects.filter(
                Q(pk__in=access.seller_profiles_for(account).values("pk"))
                | Q(pk__in=profiles(account, invoices=True).values("pk"))
            ),
            pk=seller,
        )
        messages = messages.filter(seller_id=seller)
        orders = orders.filter(seller_id=seller)
    return Notice.objects.filter(account=account).filter(Q(conversation__in=messages) | Q(order__in=orders)), messages


def notices(actor, *, seller=None, page=1, unread=False):
    qs, _ = notice_scope(actor, seller)
    if unread:
        qs = qs.filter(read_at__isnull=True)
    rows = qs.select_related("event", "conversation", "order__invoice").order_by("-created_at", "pk")[
        (page - 1) * 20 : page * 20
    ]
    return {
        "count": qs.count(),
        "page": page,
        "results": [
            {
                "id": str(x.pk),
                "kind": x.event.kind,
                "conversation": str(x.conversation_id) if x.conversation_id else None,
                "order": str(x.order_id) if x.order_id else None,
                "invoice": str(x.order.invoice.pk) if x.order_id else None,
                "seller": str(x.order.seller_id if x.order_id else x.conversation.seller_id),
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
    preliminary = get_object_or_404(qs.select_related("conversation", "order"), pk=pk)
    access.lock_actor(
        actor, preliminary.order.seller_id if preliminary.order_id else preliminary.conversation.seller_id
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
    row.locale = data["locale"]
    row.version = 1 if created else row.version + 1
    row.save()
    return preference(actor)
