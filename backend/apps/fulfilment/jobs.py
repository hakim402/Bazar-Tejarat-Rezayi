"""Fair bounded in-app notices/completion recovery on the one existing dispatcher."""

import os
import time
from datetime import timedelta
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from apps.accounts.models import Account
from apps.organizations.models import Membership, BusinessProfile
from apps.notifications.models import Notice, Event as NoticeEvent
from . import models as m


def recipients(order, sender=None):
    member = Membership.objects.filter(company_id=order.seller_id, active=True).filter(
        Q(is_owner=True)
        | Q(bundles__contains=["fulfilment"])
        | Q(bundles__contains=["payments_refunds"])
        | Q(bundles__contains=["orders_negotiation"])
    )
    scope = Q(pk=order.buyer_id)
    if order.seller.kind == "individual":
        scope |= Q(pk=order.seller.account_id, context="seller")
    else:
        scope |= Q(pk__in=member.values("account_id"), context="seller")
    return (
        Account.objects.filter(scope, status="active", user__is_active=True, user__email_verified=True)
        .exclude(user_id=sender)
        .order_by("pk")
    )


def fanout(pk, *, limit=50):
    with transaction.atomic():
        initial = m.NoticeCursor.objects.select_related("event__order__seller").get(pk=pk)
        profile = (
            BusinessProfile.objects.select_for_update(skip_locked=True).filter(pk=initial.event.order.seller_id).first()
        )
        if profile is None:
            # This transaction acquired no business lock and will not acquire
            # one later. Rotate scheduling only, without disclosure/progress,
            # so a busy seller cannot monopolize the bounded cursor prefix.
            pending = m.NoticeCursor.objects.select_for_update(skip_locked=True).filter(pk=pk, done=False).first()
            if pending:
                pending.next_check_at = timezone.now() + timedelta(seconds=15)
                pending.save(update_fields=["next_check_at"])
            return
        cursor = m.NoticeCursor.objects.select_for_update().get(pk=pk)
        if cursor.done:
            return
        event = cursor.event
        order = initial.event.order
        qs = recipients(order, event.actor_id)
        if cursor.after:
            qs = qs.filter(pk__gt=cursor.after)
        accounts = list(qs[: limit + 1])
        notice_event = NoticeEvent.objects.get(fulfilment_event=event)
        for account in accounts[:limit]:
            Notice.objects.get_or_create(event=notice_event, account=account, defaults={"fulfilment_order": order})
        if accounts[:limit]:
            cursor.after = accounts[:limit][-1].pk
        cursor.done = len(accounts) <= limit
        cursor.next_check_at = timezone.now() + timedelta(seconds=1)
        cursor.save(update_fields=["after", "done", "next_check_at"])


def sweep():
    from .completion import recover
    from .media import sweep_unbound

    deadline = time.monotonic() + min(20, max(1, float(os.environ.get("REZAYI_JOB_SECONDS", "20")) - 1))
    ids = list(
        m.State.objects.filter(next_check_at__lte=timezone.now())
        .order_by("next_check_at", "order_id")
        .values_list("pk", flat=True)[:6]
    )
    for pk in ids:
        if time.monotonic() >= deadline:
            return
        recover(pk)
    cursors = list(
        m.NoticeCursor.objects.filter(done=False, next_check_at__lte=timezone.now())
        .order_by("next_check_at", "event_id")
        .values_list("pk", flat=True)[:2]
    )
    for pk in cursors:
        if time.monotonic() >= deadline:
            return
        fanout(pk)
    if time.monotonic() < deadline:
        sweep_unbound(limit=10)
