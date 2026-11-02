"""Fresh participant scope. Profile locks serialize company revocation before writes."""

from django.db.models import Q, Exists, OuterRef
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import NotFound, PermissionDenied
from apps.accounts.models import Account, User, BrowserAuthority, ContextGrant
from apps.organizations.models import BusinessProfile, Membership
from apps.marketplace.access import eligible_profiles
from apps.catalogue.models import Product
from .models import Conversation


def seller_profiles_for(account):
    member = Membership.objects.filter(company_id=OuterRef("pk"), account=account, active=True).filter(
        Q(is_owner=True) | Q(bundles__contains=["messaging"])
    )
    return BusinessProfile.objects.annotate(can_message=Exists(member)).filter(
        Q(kind="individual", account=account) | Q(kind="company", can_message=True)
    )


def profile_permission(profile, account):
    if account.context != "seller":
        return False
    if profile.kind == "individual":
        return profile.account_id == account.pk
    return (
        profile.kind == "company"
        and Membership.objects.filter(company=profile, account=account, active=True)
        .filter(Q(is_owner=True) | Q(bundles__contains=["messaging"]))
        .exists()
    )


def scope(actor, seller_id=None):
    account = actor.account
    if actor.context == "buyer":
        if seller_id is not None:
            raise PermissionDenied()
        return Conversation.objects.filter(buyer=account)
    if actor.context != "seller":
        raise PermissionDenied()
    profiles = seller_profiles_for(account)
    if seller_id is not None:
        get_object_or_404(profiles, pk=seller_id)
        profiles = profiles.filter(pk=seller_id)
    return Conversation.objects.filter(seller_id__in=profiles.values("pk"))


def conversation(actor, pk, *, lock=False):
    result = get_object_or_404(scope(actor), pk=pk)
    if lock:
        lock_actor(actor, result.seller_id)
        result = get_object_or_404(scope(actor).select_for_update(), pk=pk)
    return result


def lock_actor(actor, profile_id=None):
    # Match existing profile -> identity -> authority ordering. Always re-resolve
    # the grant after locks; request.user or a previously returned Account is not authority.
    if profile_id:
        get_object_or_404(BusinessProfile.objects.select_for_update(), pk=profile_id)
    account = actor.account
    User.objects.select_for_update().get(pk=actor.user.pk)
    if account:
        Account.objects.select_for_update().get(pk=account.pk)
    get_object_or_404(BrowserAuthority.objects.select_for_update(), pk=actor.request.session.get("authority"))
    grant = actor.request.session.get("grants", {}).get(actor.context, {})
    get_object_or_404(ContextGrant.objects.select_for_update(), pk=grant.get("grant_id"))
    return actor.account


def writable(item):
    # Scope known resources BEFORE any verification-file I/O, retaining R1.
    return (
        Product.objects.filter(pk=item.product_id, seller_id=item.seller_id, published__isnull=False).exists()
        and eligible_profiles([item.seller_id]).filter(pk=item.seller_id).exists()
    )


def require_write(item):
    Product.objects.select_for_update().get(pk=item.product_id)
    if not writable(item):
        from rest_framework.exceptions import ValidationError

        raise ValidationError({"conversation": ["read_only"]})


def recipient_allowed(item, account):
    account = (
        Account.objects.select_related("user")
        .filter(pk=account.pk, status="active", user__is_active=True, user__email_verified=True)
        .first()
    )
    if account is None:
        return False
    if account.context == "buyer":
        return account.pk == item.buyer_id
    return profile_permission(item.seller, account)


def recipients(item, sender):
    if sender.context == "seller":
        ids = [item.buyer_id]
    elif item.seller.kind == "company":
        ids = (
            Membership.objects.filter(company_id=item.seller_id, active=True)
            .filter(Q(is_owner=True) | Q(bundles__contains=["messaging"]))
            .values("account_id")
        )
    else:
        ids = [item.seller.account_id]
    return (
        Account.objects.select_related("user")
        .filter(
            pk__in=ids,
            context="buyer" if sender.context == "seller" else "seller",
            status="active",
            user__is_active=True,
            user__email_verified=True,
        )
        .exclude(user_id=sender.user_id)
        .order_by("pk")
    )


def not_self(profile, account):
    if profile.kind == "company":
        own = Membership.objects.filter(company=profile, account__user_id=account.user_id, active=True).exists()
    else:
        own = profile.account.user_id == account.user_id
    if own:
        from rest_framework.exceptions import ValidationError

        raise ValidationError({"product": ["self_enquiry"]})


def participant_attachment(actor, pk):
    from .models import Attachment

    account = actor.account
    item = get_object_or_404(Attachment.objects.select_related("message", "conversation"), pk=pk)
    if item.message_id:
        from django.db import connection
        if connection.vendor == "mysql" and not item.message.published:
            raise NotFound()
        conversation(actor, item.conversation_id)
    else:
        if item.creator_id != account.pk or item.creator.context != actor.context:
            raise NotFound()
        if item.conversation_id:
            conversation(actor, item.conversation_id)
        elif actor.context != "buyer":
            raise NotFound()
        from django.utils import timezone

        if item.expires_at is None or item.expires_at <= timezone.now():
            raise NotFound()
    return item
