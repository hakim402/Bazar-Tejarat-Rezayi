"""Recoverable second transaction; original financial command history never changes."""

import uuid
from django.db import transaction
from django.db.models import Max
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from apps.organizations.models import BusinessProfile
from apps.organizations.access import Conflict
from apps.runtime.locks import lock
from .models import AllocationIntent, AllocationAttempt, StockPlan
from . import queries, services


def before_stock(_order):
    """Crash/concurrency test seam; no authority bypass."""
    return None


def execute(order_id, *, now=None, skip_busy=False):
    initial = AllocationIntent.objects.filter(order_id=order_id).first()
    if not initial or initial.state not in {"pending", "blocked_zero"} or not initial.plan_id:
        return None
    number = (initial.attempts.aggregate(n=Max("number"))["n"] or 0) + 1
    token = uuid.uuid5(initial.id, f"{initial.plan_id}:{number}")
    with transaction.atomic():
        # All token mutexes precede business locks, including the stock token.
        lock("payment-intent:" + str(initial.id))
        lock(int(token.hex[:15], 16))

        profile = (
            BusinessProfile.objects.select_for_update(skip_locked=skip_busy).filter(pk=initial.order.seller_id).first()
        )
        if profile is None:
            return None
        state = services.coordinator(initial.order)
        intent = AllocationIntent.objects.select_for_update().select_related("order").get(order_id=order_id)
        if intent.plan_id != initial.plan_id or (intent.attempts.aggregate(n=Max("number"))["n"] or 0) + 1 != number:
            return None
        if intent.allocation_id or intent.state not in {"pending", "blocked_zero"}:
            return None
        if queries.confirmed(intent.order) <= 0:
            if intent.state != "blocked_zero":
                intent.state = "blocked_zero"
                intent.version += 1
                intent.checked_at = timezone.now()
                intent.save()
            return {"state": "blocked_zero"}
        if intent.state == "blocked_zero":
            intent.state = "pending"
            intent.version += 1
            intent.save()
        plan = StockPlan.objects.get(pk=intent.plan_id)
        before_stock(order_id)
        from apps.inventory.payment_allocation import reserve

        try:
            result = reserve(intent, plan, token, now=now)
        except (ValidationError, Conflict):
            intent.state = "review_required"
            intent.version += 1
            intent.checked_at = timezone.now()
            intent.save()
            services.new_case(intent.order, "shortage", intent.id)
            event = services.emit(intent.order, state, "allocation_review")
            services.notify(event)
            return {"state": "review_required"}
        event = services.emit(
            intent.order, state, "allocation_shortage" if result.get("shortage") else "stock_reserved"
        )
        attempt = AllocationAttempt.objects.create(
            event=event,
            id=token,
            intent=intent,
            number=number,
            plan=plan,
            operation_id=result["operation"],
            shortage_id=result.get("shortage"),
        )
        intent.state = "shortage" if result["status"] == "shortage" else "reserved"
        intent.allocation_id = result.get("allocation")
        intent.version += 1
        intent.checked_at = timezone.now()
        intent.save()
        if attempt.shortage_id:
            services.new_case(intent.order, "shortage", intent.id, shortage=attempt.shortage)
        services.notify(event)
        return result
