"""Automatic immutable initial completion; later exceptions preserve actual history."""

from datetime import timedelta
from django.db import connection, transaction
from django.db.models import Max
from django.utils import timezone
from apps.accounts.models import AuditEvent
from apps.orders.models import SellerOrder
from apps.payments.services import coordinator as goods_coordinator
from apps.organizations.models import BusinessProfile
from . import models as m, queries


def reconcile_locked(order):
    if not connection.in_atomic_block:
        raise RuntimeError("Completion requires the caller's ordered business/financial locks.")
    if not m.Delivery.objects.filter(order_id=order.pk).exists():
        return None
    from .services import coordinator, emit, publish, new_case

    state = coordinator(order)
    current = queries.annotate(SellerOrder.objects.filter(pk=order.pk)).get()
    facts = queries.dimensions(current)
    prior = m.Completion.objects.filter(order=order).first()
    if prior:
        if not facts["eligible"]:
            # Case assignment/resolution changes State.version, so it cannot
            # identify a new adverse episode. Bind to actual financial/hold
            # causes instead; recovery and review of the same facts dedupe.
            provider_version = (
                m.CaseEvent.objects.filter(
                    order=order, action="approve", case__kind__in=["charge", "payment", "correction"]
                ).aggregate(value=Max("event__version"))["value"]
                or 0
            )
            hold_version = m.Blocker.objects.filter(order=order).aggregate(value=Max("event__version"))["value"] or 0
            refund_version = (
                m.DeliveryRefundDecision.objects.filter(order=order, action="confirmed").aggregate(
                    value=Max("event__version")
                )["value"]
                or 0
            )
            cause = {
                "completion": str(prior.pk),
                "goods_version": current.payment_version,
                "provider_version": provider_version,
                "hold_version": hold_version,
                "refund_version": refund_version,
            }
            from .validation import digest

            new_case(order, "exception", digest("completion_exception", order.pk, cause), audit_source=cause)
        return prior
    if not facts["eligible"]:
        return None
    delivery = m.Delivery.objects.get(order=order)
    causal = state.version
    event = emit(order, state, "completed")
    item = m.Completion.construction.create(
        order=order, event=event, delivery=delivery, goods_version=current.payment_version, delivery_version=causal
    )
    AuditEvent.objects.create(
        context="system",
        action="fulfilment_completed",
        resource_type="orders.sellerorder",
        resource_id=order.pk,
        reason="Whole delivered order and both authoritative settlements satisfy current gates",
        state={"goods_version": current.payment_version, "delivery_version": causal},
    )
    publish(event)
    return item


def recover(pk):
    with transaction.atomic():
        initial = SellerOrder.objects.get(pk=pk)
        profile = BusinessProfile.objects.select_for_update(skip_locked=True).filter(pk=initial.seller_id).first()
        if profile is None:
            # No business lock was acquired, and this path performs no domain
            # transition. Rotate the scheduling field without waiting on it.
            pending = m.State.objects.select_for_update(skip_locked=True).filter(order=initial).first()
            if pending:
                pending.next_check_at = timezone.now() + timedelta(seconds=15)
                pending.save(update_fields=["next_check_at"])
            return False
        goods_coordinator(initial)
        state = m.State.objects.select_for_update().filter(order=initial).first()
        if not state:
            return False
        reconcile_locked(initial)
        state.refresh_from_db()
        state.checked_at = timezone.now()
        state.next_check_at = timezone.now() + timedelta(minutes=5)
        state.save(update_fields=["checked_at", "next_check_at"])
        return True
