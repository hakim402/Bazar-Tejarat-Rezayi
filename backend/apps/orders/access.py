"""Fresh order/financial capabilities; accepted history outlives publication."""

from django.db.models import Q, Exists, OuterRef
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import PermissionDenied
from django.core.files.storage import storages
from django.core.files.storage.handler import InvalidStorageError
from django.core.exceptions import SuspiciousFileOperation
from apps.messaging.access import lock_actor as lock_actor
from apps.organizations.models import BusinessProfile, Membership
from apps.verification.models import ReviewCase
from apps.catalogue.media import StorageUnavailable


def profiles(account, *, invoices=False):
    member = Membership.objects.filter(company_id=OuterRef("pk"), account=account, active=True).filter(
        Q(is_owner=True)
        | Q(bundles__contains=["orders_negotiation"])
        | (Q(bundles__contains=["payments_refunds"]) if invoices else Q(pk__isnull=True))
    )
    return (
        BusinessProfile.objects.annotate(order_member=Exists(member)).filter(
            Q(kind="individual", account=account) | Q(kind="company", order_member=True)
        )
        if account.context == "seller"
        else BusinessProfile.objects.none()
    )


def scope(actor, *, invoices=False, seller=None):
    from .models import SellerOrder

    account = actor.account
    if actor.context == "buyer":
        if seller is not None:
            raise PermissionDenied()
        return SellerOrder.objects.filter(buyer=account)
    if actor.context != "seller":
        raise PermissionDenied()
    selected = profiles(account, invoices=invoices)
    if seller is not None:
        selected = selected.filter(pk=get_object_or_404(selected, pk=seller).pk)
    return SellerOrder.objects.filter(seller_id__in=selected.values("pk"))


def owned(profile, account):
    return account.context == "seller" and (
        (profile.kind == "individual" and profile.account_id == account.pk)
        or (
            profile.kind == "company"
            and Membership.objects.filter(company=profile, account=account, active=True, is_owner=True).exists()
        )
    )


def verified_case(profile):
    case = ReviewCase.objects.filter(profile=profile, revision=profile.revision, status="approved").first()
    if not case:
        return None
    try:
        for item in case.evidence.all():
            if not storages[item.storage_alias].exists(item.key):
                return None
    except (OSError, SuspiciousFileOperation, InvalidStorageError):
        raise StorageUnavailable() from None
    return case


def can_receive(order, account):
    from apps.accounts.models import Account

    account = (
        Account.objects.select_related("user")
        .filter(pk=account.pk, status="active", user__is_active=True, user__email_verified=True)
        .first()
    )
    return bool(
        account
        and (
            (account.context == "buyer" and account.pk == order.buyer_id)
            or profiles(account, invoices=True).filter(pk=order.seller_id).exists()
        )
    )


def aftercare_rights(actor):
    from apps.accounts.admin_access import permission_codes
    from .models import AFTERCARE_PERMISSIONS

    return (
        {code for code, _ in AFTERCARE_PERMISSIONS}
        if actor.context == "owner"
        else set(permission_codes(actor.account, "orders"))
        if actor.context == "staff"
        else set()
    )


def aftercare_participant(order, user):
    """Current or historical participant identities excluded from decisions."""
    from rest_framework.exceptions import PermissionDenied
    from apps.organizations.models import Membership

    buyer_profiles = BusinessProfile.objects.filter(account_id=order.buyer_id).values("pk")
    if (
        user.pk in [order.buyer.user_id, order.seller.account.user_id]
        or Membership.objects.filter(
            Q(company_id=order.seller_id) | Q(company_id__in=buyer_profiles), account__user=user
        ).exists()
        or order.goods_receipts.filter(actor__user=user).exists()
        or order.payment_plans.filter(actor__user=user).exists()
        or order.amendments.filter(actor__user=user).exists()
    ):
        raise PermissionDenied("An independent reviewer must decide this case.")


def cancellation_scope(actor):
    from .models import CancellationRequest

    if actor.context == "owner":
        return CancellationRequest.objects.all()
    if actor.context != "staff" or "read_aftercare" not in aftercare_rights(actor):
        return CancellationRequest.objects.none()
    qs = (
        CancellationRequest.objects.exclude(order__buyer__user=actor.user)
        .exclude(order__seller__account__user=actor.user)
        .exclude(order__seller__memberships__account__user=actor.user)
        .exclude(order__buyer__business_profiles__memberships__account__user=actor.user)
        .exclude(order__goods_receipts__actor__user=actor.user)
        .exclude(order__payment_plans__actor__user=actor.user)
        .exclude(order__amendments__actor__user=actor.user)
        .exclude(requester_user=actor.user)
    )
    if "assign_aftercare" not in aftercare_rights(actor):
        qs = qs.filter(assigned_to=actor.user)
    return qs.distinct()


def amendment_scope(actor):
    from .models import Amendment

    if actor.context == "owner":
        return Amendment.objects.all()
    if actor.context != "staff" or "read_aftercare" not in aftercare_rights(actor):
        return Amendment.objects.none()
    qs = (
        Amendment.objects.exclude(order__buyer__user=actor.user)
        .exclude(order__seller__account__user=actor.user)
        .exclude(order__seller__memberships__account__user=actor.user)
        .exclude(order__buyer__business_profiles__memberships__account__user=actor.user)
        .exclude(order__goods_receipts__actor__user=actor.user)
        .exclude(order__payment_plans__actor__user=actor.user)
        .exclude(actor__user=actor.user)
    )
    if "assign_aftercare" not in aftercare_rights(actor):
        qs = qs.filter(assigned_to=actor.user)
    return qs.distinct()


def dispute_scope(actor):
    from .models import DisputeRequest

    if actor.context == "owner":
        return DisputeRequest.objects.all()
    if actor.context != "staff" or "read_dispute" not in aftercare_rights(actor):
        return DisputeRequest.objects.none()
    qs = (
        DisputeRequest.objects.exclude(order__buyer__user=actor.user)
        .exclude(order__seller__account__user=actor.user)
        .exclude(order__seller__memberships__account__user=actor.user)
        .exclude(order__buyer__business_profiles__memberships__account__user=actor.user)
        .exclude(order__goods_receipts__actor__user=actor.user)
        .exclude(order__payment_plans__actor__user=actor.user)
        .exclude(order__amendments__actor__user=actor.user)
        .exclude(requester_account__user=actor.user)
        .exclude(response__actor__user=actor.user)
        .exclude(evidence_bindings__evidence__creator__user=actor.user)
    )
    if "assign_dispute" not in aftercare_rights(actor):
        qs = qs.filter(assigned_to=actor.user)
    return qs.distinct()


def review_scope(actor):
    """Moderation queue. Seller-side actors for the business cannot moderate its
    reviews, including root (CR-77); reviews carry no assignee."""
    from .models import Review

    if actor.context == "owner":
        return Review.objects.all()
    if actor.context != "staff" or "read_review" not in aftercare_rights(actor):
        return Review.objects.none()
    return (
        Review.objects.exclude(order__buyer__user=actor.user)
        .exclude(order__seller__account__user=actor.user)
        .exclude(order__seller__memberships__account__user=actor.user)
        .exclude(order__buyer__business_profiles__memberships__account__user=actor.user)
        .exclude(order__goods_receipts__actor__user=actor.user)
        .exclude(order__payment_plans__actor__user=actor.user)
        .exclude(order__amendments__actor__user=actor.user)
        .exclude(buyer__user=actor.user)
        .distinct()
    )
