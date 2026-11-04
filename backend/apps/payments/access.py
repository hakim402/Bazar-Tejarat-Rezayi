"""Financial membership, independent native review and fresh object locks."""

import uuid
from django.db.models import Q, Exists, OuterRef
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import PermissionDenied, NotFound
from apps.accounts.models import Account, User, AuditEvent
from apps.accounts.admin_access import permission_codes
from apps.organizations.models import BusinessProfile, Membership
from apps.messaging.access import lock_actor
from apps.orders.models import SellerOrder
from .models import ReviewCase, PERMISSIONS


def account_for(actor):
    account = actor.account
    return account if isinstance(account, Account) else None


def rights(actor):
    account = actor.account
    return (
        {p for p, _ in PERMISSIONS}
        if actor.context == "owner"
        else set(permission_codes(account, "payments"))
        if actor.context == "staff"
        else set()
    )


def profiles(account, *, summary=False):
    member = Membership.objects.filter(company_id=OuterRef("pk"), account=account, active=True).filter(
        Q(is_owner=True)
        | Q(bundles__contains=["payments_refunds"])
        | (Q(bundles__contains=["orders_negotiation"]) if summary else Q(pk__isnull=True))
    )
    return (
        BusinessProfile.objects.annotate(financial_member=Exists(member)).filter(
            Q(kind="individual", account=account) | Q(kind="company", financial_member=True)
        )
        if account.context == "seller"
        else BusinessProfile.objects.none()
    )


def scope(actor, *, write=False, seller=None):
    account = actor.account
    if actor.context == "owner":
        return SellerOrder.objects.all()
    if actor.context == "staff":
        if "read_payments" not in rights(actor):
            return SellerOrder.objects.none()
        return SellerOrder.objects.filter(payment_cases__in=case_scope(actor).filter(assigned_to=actor.user)).distinct()
    if actor.context == "buyer":
        if seller is not None:
            raise PermissionDenied()
        return SellerOrder.objects.filter(buyer=account)
    if actor.context != "seller":
        raise PermissionDenied()
    selected = profiles(account, summary=not write)
    if seller is not None:
        selected = selected.filter(pk=get_object_or_404(selected, pk=seller).pk)
    return SellerOrder.objects.filter(seller_id__in=selected.values("pk"))


def financial_member(order, account):
    return bool(account and account.context == "seller" and profiles(account).filter(pk=order.seller_id).exists())


def capabilities(actor, order):
    account = account_for(actor)
    buyer = actor.context == "buyer" and order.buyer_id == account.pk
    seller_reader = actor.context == "seller" and financial_member(order, account)
    seller = seller_reader
    if seller:
        from apps.verification.models import ReviewCase as Verification

        seller = Verification.objects.filter(
            profile=order.seller, revision=order.seller.revision, status="approved"
        ).exists()
    privileged = actor.context in {"owner", "staff"}
    return {
        "claim": buyer,
        "receipt": seller,
        "correction": seller,
        "extension": seller and order.payment_method == "advance",
        "selection": seller and order.payment_method == "advance",
        "details": buyer or seller_reader or privileged,
        "evidence": buyer or seller_reader or privileged and "read_payment_evidence" in rights(actor),
    }


def lock_order(actor, pk, *, write=False, additional_users=(), assignment=False):
    def selected():
        if assignment and actor.context == "staff" and "assign_payment_case" in rights(actor):
            return SellerOrder.objects.filter(payment_cases__in=case_scope(actor)).distinct()
        return scope(actor, write=write)

    initial = get_object_or_404(selected(), pk=pk)
    buyer_business = BusinessProfile.objects.filter(account_id=initial.buyer_id, kind="business").first()
    ids = [initial.seller_id] + ([buyer_business.pk] if buyer_business else [])
    list(BusinessProfile.objects.select_for_update().filter(pk__in=ids).order_by("pk"))
    account = account_for(actor)
    account_ids = [initial.buyer_id] + ([account.pk] if account else [])
    users = list(Account.objects.filter(pk__in=account_ids).values_list("user_id", flat=True)) + [
        actor.user.pk,
        *additional_users,
    ]
    list(User.objects.select_for_update().filter(pk__in=users).order_by("pk"))
    list(Account.objects.select_for_update().filter(pk__in=account_ids).order_by("pk"))
    lock_actor(actor)
    order = get_object_or_404(selected().select_related("seller__account__user", "buyer__user", "invoice"), pk=pk)
    if write and actor.context == "seller":
        from apps.verification.models import ReviewCase as Verification

        if not Verification.objects.filter(
            profile=order.seller, revision=order.seller.revision, status="approved"
        ).exists():
            raise PermissionDenied("Current business approval is required.")
    return order


def independent(order, user):
    buyer_profiles = BusinessProfile.objects.filter(account_id=order.buyer_id).values("pk")
    if (
        user.pk in [order.buyer.user_id, order.seller.account.user_id]
        or Membership.objects.filter(
            Q(company_id=order.seller_id) | Q(company_id__in=buyer_profiles), account__user=user
        ).exists()
        or order.goods_receipts.filter(actor__user=user).exists()
        or order.payment_plans.filter(actor__user=user).exists()
    ):
        raise PermissionDenied("An independent reviewer must decide this case.")


def case_scope(actor):
    codes = rights(actor)
    if actor.context == "owner":
        return ReviewCase.objects.all()
    if actor.context != "staff" or "read_payments" not in codes:
        return ReviewCase.objects.none()
    qs = (
        ReviewCase.objects.exclude(order__buyer__user=actor.user)
        .exclude(order__seller__account__user=actor.user)
        .exclude(order__seller__memberships__account__user=actor.user)
        .exclude(order__buyer__business_profiles__memberships__account__user=actor.user)
        .exclude(order__goods_receipts__actor__user=actor.user)
        .exclude(order__payment_plans__actor__user=actor.user)
    )
    if "assign_payment_case" not in codes:
        qs = qs.filter(assigned_to=actor.user)
    return qs.distinct()


def require_case(actor, case, permission="read_payments", *, decide=False):
    if permission not in rights(actor) or not case_scope(actor).filter(pk=case.pk).exists():
        raise NotFound()
    if actor.context != "owner" and case.assigned_to_id != actor.user.pk:
        raise NotFound()
    if decide:
        if case.assigned_to_id != actor.user.pk:
            raise PermissionDenied("Assign an independent eligible reviewer first.")
        independent(case.order, actor.user)


def audit(actor, target, action, reason="Protected financial access"):
    try:
        resource_id = uuid.UUID(str(target.pk))
        state = {}
    except ValueError:
        resource_id = uuid.uuid5(uuid.NAMESPACE_URL, f"{target._meta.label_lower}:{target.pk}")
        state = {"record_id": str(target.pk)}
    return AuditEvent.objects.create(
        actor=actor.user,
        account=account_for(actor),
        context=actor.context,
        action=action,
        resource_type=target._meta.label_lower,
        resource_id=resource_id,
        reason=reason,
        state=state,
    )


def recipient_allowed(order, account):
    account = (
        Account.objects.select_related("user")
        .filter(pk=account.pk, status="active", user__is_active=True, user__email_verified=True)
        .first()
    )
    return bool(
        account and (account.context == "buyer" and account.pk == order.buyer_id or financial_member(order, account))
    )
