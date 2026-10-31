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
