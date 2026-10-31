"""Durable typed in-app order intent with bounded current-recipient fan-out."""

from django.db import transaction
from django.db.models import Q
from apps.accounts.models import Account
from apps.organizations.models import Membership, BusinessProfile
from .models import Event, Notice, OrderNoticeCursor


def recipients(order, sender_id):
    members = (
        Membership.objects.filter(company_id=order.seller_id, active=True)
        .filter(
            Q(is_owner=True) | Q(bundles__contains=["orders_negotiation"]) | Q(bundles__contains=["payments_refunds"])
        )
        .values("account_id")
    )
    account_ids = Q(pk__in=members) if order.seller.kind == "company" else Q(pk=order.seller.account_id)
    return (
        Account.objects.filter(
            account_ids, context="seller", status="active", user__is_active=True, user__email_verified=True
        )
        .exclude(user_id=sender_id)
        .order_by("pk")
    )


def order_committed(order, sender):
    event = Event.objects.create(kind="order_accepted", order=order)
    Notice.objects.create(event=event, account_id=order.buyer_id, order=order)
    OrderNoticeCursor.objects.create(event=event, sender_id=sender.user_id)
    fanout(event.pk)
    from .services import enqueue_safely

    transaction.on_commit(enqueue_safely)


@transaction.atomic
def fanout(event_id):
    # Profile lock matches membership revocation. Reads remain freshly scoped even
    # if account activation changes immediately after intent creation.
    preliminary = OrderNoticeCursor.objects.select_related("event__order").get(pk=event_id)
    BusinessProfile.objects.select_for_update().get(pk=preliminary.event.order.seller_id)
    cursor = OrderNoticeCursor.objects.select_for_update(skip_locked=True).filter(pk=event_id, complete=False).first()
    if cursor is None:
        return
    order = cursor.event.order
    qs = recipients(order, cursor.sender_id)
    if cursor.after_account:
        qs = qs.filter(pk__gt=cursor.after_account)
    batch = list(qs[:101])
    for account in batch[:100]:
        Notice.objects.get_or_create(event=cursor.event, account=account, defaults={"order": order})
    if batch:
        cursor.after_account = batch[min(99, len(batch) - 1)].pk
    cursor.complete = len(batch) <= 100
    cursor.version += 1
    cursor.save()


def sweep_orders():
    for pk in list(OrderNoticeCursor.objects.filter(complete=False).order_by("pk").values_list("pk", flat=True)[:10]):
        fanout(pk)
