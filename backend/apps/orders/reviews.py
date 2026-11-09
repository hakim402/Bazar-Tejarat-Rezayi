"""Buyer reviews of completed order sellers, with independent staff moderation.

One review per eligible completed order, rating the whole seller experience
(CR-116). Only staff-approved reviews of eligible completed orders reach the
public average and count (CR-117); reports never affect ratings. Submitted text
and language are preserved verbatim and an approved review's content is
immutable, while moderation may later withdraw it with retained history."""

from decimal import ROUND_HALF_UP, Decimal

from django.db import transaction
from django.db.models import Count, Sum
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import PermissionDenied

from apps.foundation.codes import REVIEW_REFUSALS, bounded
from apps.foundation.contracts import LOCALES
from apps.organizations.access import Conflict
from apps.payments.access import account_for, audit
from apps.payments.validation import fail
from apps.runtime.locks import lock
from . import access
from . import aftercare as projection
from . import aftercare_commands as base
from .models import Review, ReviewDecision, SellerOrder

MODERATION_ACTIONS = {"approve": "approved", "reject": "rejected", "withdraw": "withdrawn"}
AVERAGE_STEP = Decimal("0.1")


def refuse(code):
    fail("review", bounded(code, REVIEW_REFUSALS))


def buyers(actor):
    if actor.context != "buyer":
        raise PermissionDenied()
    return SellerOrder.objects.filter(buyer=actor.account)


def eligible_reviews(seller=None):
    """The single approved-eligible set. Orders, the public marketplace
    projection and the admin queue all read this; eligibility is never
    recomputed in a serializer or a page."""
    qs = Review.objects.filter(state="approved", order__completion__isnull=False).exclude(
        order__cancellation_requests__state="approved"
    )
    return qs.filter(order__seller_id=seller.pk) if seller is not None else qs


def aggregate(seller):
    """Public average and count. An empty set has no rating, never zero."""
    figures = eligible_reviews(seller).aggregate(total=Count("order_id"), ratings=Sum("rating"))
    if not figures["total"]:
        return {"count": 0, "average": None}
    average = (Decimal(figures["ratings"]) / Decimal(figures["total"])).quantize(
        AVERAGE_STEP, rounding=ROUND_HALF_UP
    )
    return {"count": figures["total"], "average": format(average, ".1f")}


def independent(order, user, *, review=None):
    from apps.payments.access import independent as goods_independent

    goods_independent(order, user)
    access.aftercare_participant(order, user)
    if review is not None and review.buyer.user_id == user.pk:
        raise PermissionDenied("The reviewing buyer cannot moderate this review.")


def order_scope(actor):
    if actor.context == "owner":
        return SellerOrder.objects.all()
    if actor.context == "staff":
        return SellerOrder.objects.filter(review__in=access.review_scope(actor)).distinct()
    return buyers(actor)


def _submit(actor, order, state, data):
    if actor.context != "buyer" or order.buyer_id != account_for(actor).pk:
        refuse("review_not_buyer")
    if not projection.completed(order):
        refuse("review_not_completed")
    if projection.reviewed(order):
        refuse("review_already_submitted")
    rating = data.get("rating")
    if type(rating) is not int or not 1 <= rating <= 5:
        refuse("review_rating_invalid")
    text = base.text(data.get("text"), field="text", maximum=2000)
    language = data.get("language")
    if language not in LOCALES:
        fail("language")
    event = base.emit(order, state, "review_submitted", actor)
    review = Review.objects.create(
        order=order,
        buyer=account_for(actor),
        rating=rating,
        text=text,
        language=language,
        event=event,
    )
    base.notify(order, event, sender=actor.user)
    audit(actor, review, "review_submitted", "Buyer review submitted for moderation")
    return {"review": str(review.pk), "state": review.state, "version": state.version}


def _withdraw(actor, order, state, data):
    review = get_object_or_404(
        Review.objects.select_for_update(), order=order, state="pending", buyer=account_for(actor)
    )
    reason = base.text(data.get("reason"))
    event = base.emit(order, state, "review_withdrawn", actor)
    ReviewDecision.objects.create(
        review=review,
        event=event,
        actor=actor.user,
        account=account_for(actor),
        context=actor.context,
        action="withdrawn",
        reason=reason,
    )
    review.state = "withdrawn"
    review.version += 1
    review.save(update_fields=["state", "version"])
    base.notify(order, event, sender=actor.user)
    audit(actor, review, "review_withdrawn", reason)
    return {"review": str(review.pk), "state": review.state, "version": state.version}


def mutate(actor, pk, action, data):
    key = base.identifier(data.get("command_id"))
    fingerprint = base.digest_of(action, pk, data)
    with transaction.atomic():
        lock("aftercare-command:" + str(key))
        order = base.lock_order(actor, pk, buyers(actor))
        old = base.previous(actor, order, key, action, fingerprint)
        if old is not None:
            return old
        _, state = base.ordered_state(order)
        base.expect(state.version, data.get("version"), refuse, "review_stale_version")
        if action == "review_submit":
            result = _submit(actor, order, state, data)
        elif action == "review_withdraw":
            result = _withdraw(actor, order, state, data)
        else:
            raise PermissionDenied()
        return base.remember(actor, order, key, action, fingerprint, result)


def reconcile(actor, order_pk, key):
    return base.lookup(actor, order_pk, base.identifier(key), buyers(actor))


def settle(actor, order_pk, key):
    return base.lookup(actor, order_pk, base.identifier(key), buyers(actor), fence=True)


def moderate(actor, pk, data):
    """Staff approve/reject a pending review, or withdraw an approved one."""
    key = base.identifier(data.get("command_id"))
    action = data.get("action")
    initial = get_object_or_404(access.review_scope(actor).select_related("order"), pk=pk)
    if action not in MODERATION_ACTIONS:
        fail("action")
    sealed = "review_moderate_" + action
    fingerprint = base.digest_of(sealed, initial.order_id, data)
    with transaction.atomic():
        lock("aftercare-command:" + str(key))
        order = base.lock_order(actor, initial.order_id, order_scope(actor))
        review = get_object_or_404(access.review_scope(actor).select_for_update(), pk=pk)
        old = base.previous(actor, order, key, sealed, fingerprint)
        if old is not None:
            return old
        _, state = base.ordered_state(order)
        base.expect(state.version, data.get("version"), refuse, "review_stale_version")
        base.expect(review.version, data.get("review_version"), refuse, "review_stale_version")
        if "moderate_review" not in access.aftercare_rights(actor):
            raise PermissionDenied()
        independent(order, actor.user, review=review)
        outcome = MODERATION_ACTIONS[action]
        if action == "withdraw":
            if review.state not in {"pending", "approved"}:
                refuse("review_not_moderatable")
        elif review.state != "pending":
            raise Conflict("This review already has a retained moderation decision.")
        reason = base.text(data.get("reason"))
        event = base.emit(order, state, "review_decided", actor)
        ReviewDecision.objects.create(
            review=review,
            event=event,
            actor=actor.user,
            account=account_for(actor),
            context=actor.context,
            action=outcome,
            reason=reason,
        )
        review.state = outcome
        review.version += 1
        review.save(update_fields=["state", "version"])
        base.notify(order, event, sender=None)
        audit(actor, review, "review_decided", reason)
        return base.remember(
            actor,
            order,
            key,
            sealed,
            fingerprint,
            {"review": str(review.pk), "state": review.state, "version": state.version},
        )