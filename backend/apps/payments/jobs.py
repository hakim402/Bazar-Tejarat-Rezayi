"""One fair bounded payment sweep; no scheduler/thread/provider startup work."""

import hashlib
import os
import time
from datetime import timedelta
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from apps.accounts.models import Account
from apps.organizations.models import Membership, BusinessProfile
from apps.orders.models import SellerOrder, OrderPolicy
from apps.notifications.models import Event as NoticeEvent, Notice, Preference
from .models import Finance, AllocationIntent, ReviewCase, CaseEvent, Reminder, NoticeCursor, Email, SweepCursor
from . import queries, services, media, allocation


def identity_digest(account, order):
    return hashlib.sha256(
        f"{account.pk}:{account.user.email}:{account.user.credential_epoch}:{account.access_epoch}:{order.seller.version}".encode()
    ).hexdigest()


def reminder_slot(order, *, now=None):
    now = now or timezone.now()
    due, generation = queries.deadline(order)
    from apps.orders import aftercare

    if (
        order.payment_method != "advance" or not due or due > now or aftercare.cancelled(order)
        or queries.confirmed(order) >= aftercare.accepted_total(order)
    ):
        return None
    hours = OrderPolicy.objects.get(pk=1).reminder_hours
    slot = 0 if not hours else int((now - due).total_seconds() // (hours * 3600))
    return generation, slot


def current_reminder(order, generation, slot):
    return reminder_slot(order) == (generation, slot)


def recipients(order, sender_id=None):
    member = (
        Membership.objects.filter(company_id=order.seller_id, active=True)
        .filter(Q(is_owner=True) | Q(bundles__contains=["payments_refunds"]))
        .values("account_id")
    )
    seller = (
        Q(pk__in=member, context="seller")
        if order.seller.kind == "company"
        else Q(pk=order.seller.account_id, context="seller")
    )
    qs = (
        Account.objects.filter(
            Q(pk=order.buyer_id) | seller, status="active", user__is_active=True, user__email_verified=True
        )
        .select_related("user")
        .order_by("pk")
    )
    return qs.exclude(user_id=sender_id) if sender_id else qs


@transaction.atomic
def fanout(pk):
    initial = NoticeCursor.objects.select_related("event__order__seller").get(pk=pk)
    BusinessProfile.objects.select_for_update().get(pk=initial.event.order.seller_id)
    cursor = NoticeCursor.objects.select_for_update(skip_locked=True).filter(pk=pk, complete=False).first()
    if cursor is None:
        return
    order = initial.event.order
    event = NoticeEvent.objects.get(payment_event_id=pk)
    qs = recipients(order, cursor.sender_id)
    if cursor.after_account:
        qs = qs.filter(pk__gt=cursor.after_account)
    batch = list(qs[:101])
    for account in batch[:100]:
        Notice.objects.get_or_create(event=event, account=account, defaults={"payment_order": order})
        if cursor.generation is not None and current_reminder(order, cursor.generation, cursor.slot):
            pref = Preference.objects.filter(account=account).first()
            if pref is None or pref.payment_email:
                Email.objects.get_or_create(
                    order=order,
                    account=account,
                    generation=cursor.generation,
                    slot=cursor.slot,
                    defaults={"identity_digest": identity_digest(account, order)},
                )
    if batch:
        cursor.after_account = batch[min(99, len(batch) - 1)].pk
    cursor.complete = len(batch) <= 100
    cursor.version += 1
    cursor.save()


def system_case(order, state, case, active):
    if case.overdue_active == active:
        return
    event = services.emit(order, state, "overdue_reopened" if active else "overdue_cleared")
    CaseEvent.objects.create(
        case=case,
        event=event,
        version=case.version + 1,
        action="system_reopen" if active else "system_clear",
        context="system",
        reason="Current confirmed balance and effective deadline",
    )
    case.overdue_active = active
    case.state = "open" if active else "resolved"
    case.assigned_to = None if active else case.assigned_to
    case.version += 1
    case.save()
    services.notify(event)


@transaction.atomic
def check_order(pk):
    order = SellerOrder.objects.select_related("seller").get(pk=pk)
    from apps.orders import aftercare

    # Skip busy business work in cron instead of monopolizing the global runner.
    if not BusinessProfile.objects.select_for_update(skip_locked=True).filter(pk=order.seller_id).exists():
        return
    state = services.coordinator(order)
    now = timezone.now()
    if aftercare.cancelled(order):
        state.checked_at = now
        state.next_check_at = now + timedelta(hours=24)
        state.save(update_fields=["checked_at", "next_check_at"])
        return
    slot = reminder_slot(order)
    for case in (
        ReviewCase.objects.select_for_update()
        .filter(order=order, kind="overdue", overdue_active=True)
        .order_by("pk")[:5]
    ):
        if slot is None or case.generation != slot[0]:
            system_case(order, state, case, False)
    if slot:
        generation, number = slot
        case = services.new_case(order, "overdue", generation, generation=generation)
        if not case.overdue_active:
            system_case(order, state, case, True)
        if not Reminder.objects.filter(order=order, generation=generation, slot=number).exists():
            event = services.emit(order, state, "overdue_reminder")
            Reminder.objects.create(order=order, generation=generation, slot=number, event=event)
            services.notify(event, generation=generation, slot=number)
    due, _ = queries.deadline(order)
    state.checked_at = now
    state.next_check_at = (
        max(now + timedelta(seconds=60), min(due, now + timedelta(hours=24)))
        if due and not slot
        else now + timedelta(hours=24)
        if queries.confirmed(order) >= aftercare.accepted_total(order)
        else now + timedelta(seconds=60)
    )
    state.save(update_fields=["checked_at", "next_check_at"])


@transaction.atomic
def candidates(name, qs, *, limit=5):
    cursor, _ = SweepCursor.objects.get_or_create(name=name)
    cursor = SweepCursor.objects.select_for_update().get(pk=name)
    ordered = qs.order_by("pk")
    rows = (
        list(ordered.filter(pk__gt=cursor.after_id).values_list("pk", flat=True)[:limit])
        if cursor.after_id
        else list(ordered.values_list("pk", flat=True)[:limit])
    )
    if not rows and cursor.after_id:
        rows = list(ordered.values_list("pk", flat=True)[:limit])
    if rows:
        cursor.after_id = rows[-1]
    cursor.updated_at = timezone.now()
    cursor.save()
    return rows


def sweep():
    budget = min(20, max(1, float(os.environ.get("REZAYI_JOB_SECONDS", "20"))))
    deadline = time.monotonic() + budget
    with transaction.atomic():
        SweepCursor.objects.get_or_create(name="sectors")
        cursor = SweepCursor.objects.select_for_update().get(pk="sectors")
        first = cursor.sector % 5
        cursor.sector = (first + 1) % 5
        cursor.updated_at = timezone.now()
        cursor.save()
    # Rotate sectors and candidate UUIDs even when a business is busy. Expensive
    # stock work cannot permanently starve deadlines, mail or staged cleanup.
    for index in [(first + i) % 5 for i in range(5)]:
        if time.monotonic() + 1 >= deadline:
            return
        if index == 0:
            rows = candidates("allocation", AllocationIntent.objects.filter(state__in=["pending", "blocked_zero"]))
            for pk in rows:
                if time.monotonic() + 1 >= deadline:
                    return
                allocation.execute(pk, skip_busy=True)
        elif index == 1:
            rows = candidates(
                "new_due",
                SellerOrder.objects.filter(payment_method="advance", due_at__lte=timezone.now(), finance__isnull=True),
            )
            for pk in rows:
                if time.monotonic() + 1 >= deadline:
                    return
                check_order(pk)
            rows = candidates("due", Finance.objects.filter(next_check_at__lte=timezone.now()))
            for pk in rows:
                if time.monotonic() + 1 >= deadline:
                    return
                check_order(pk)
        elif index == 2:
            for pk in candidates("fanout", NoticeCursor.objects.filter(complete=False), limit=3):
                if time.monotonic() + 1 >= deadline:
                    return
                fanout(pk)
        elif index == 3 and time.monotonic() + 3 < deadline:
            from .delivery import dispatch

            pk = (
                Email.objects.filter(
                    status__in=["queued", "retry_due", "claimed", "dispatching"], due_at__lte=timezone.now()
                )
                .order_by("due_at", "pk")
                .values_list("pk", flat=True)
                .first()
            )
            if pk:
                dispatch(pk)
        elif index == 4:
            media.sweep_unbound(limit=10)
