"""Request-only durable notices; never the conversation email cursor."""

from django.db import transaction
from django.db.models import Q
from apps.accounts.models import Account
from apps.organizations.models import Membership, BusinessProfile
from .models import Event, Notice, OrderNoticeCursor


def committed(request_event, sender):
    event = Event.objects.create(kind="negotiation", negotiation_event=request_event)
    OrderNoticeCursor.objects.create(event=event, sender_id=sender.user_id)
    fanout(event.pk)
    from .services import enqueue_safely

    transaction.on_commit(enqueue_safely)


@transaction.atomic
def fanout(pk):
    preliminary = OrderNoticeCursor.objects.select_related("event__negotiation_event__request").get(pk=pk)
    request = preliminary.event.negotiation_event.request
    BusinessProfile.objects.select_for_update().get(pk=request.seller_id)
    cursor = OrderNoticeCursor.objects.select_for_update(skip_locked=True).filter(pk=pk, complete=False).first()
    if cursor is None:
        return
    members = (
        Membership.objects.filter(company_id=request.seller_id, active=True)
        .filter(Q(is_owner=True) | Q(bundles__contains=["orders_negotiation"]))
        .values("account_id")
    )
    ids = (
        Q(pk=request.buyer_id) | Q(pk=request.seller.account_id, context="seller")
        if request.seller.kind == "individual"
        else Q(pk=request.buyer_id) | Q(pk__in=members, context="seller")
    )
    qs = (
        Account.objects.filter(ids, status="active", user__is_active=True, user__email_verified=True)
        .exclude(user_id=cursor.sender_id)
        .order_by("pk")
    )
    if cursor.after_account:
        qs = qs.filter(pk__gt=cursor.after_account)
    batch = list(qs[:101])
    for account in batch[:100]:
        Notice.objects.get_or_create(event=cursor.event, account=account, defaults={"negotiation": request})
    if batch:
        cursor.after_account = batch[min(99, len(batch) - 1)].pk
    cursor.complete = len(batch) <= 100
    cursor.version += 1
    cursor.save()
