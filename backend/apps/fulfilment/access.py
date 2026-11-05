"""Fresh field/action/resource scope; recipient access is separate from money review."""

from django.db.models import Q, Exists, OuterRef
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import NotFound, PermissionDenied
from apps.accounts.admin_access import permission_codes
from apps.accounts.models import Account, User
from apps.messaging.access import lock_actor
from apps.organizations.models import BusinessProfile, Membership
from apps.orders.models import SellerOrder
from apps.payments.access import audit as audit
from apps.payments.access import account_for, independent as goods_independent
from .models import PERMISSIONS, ReviewCase, Provider, Claim, Correction


def rights(actor):
    return (
        {p for p, _ in PERMISSIONS}
        if actor.context == "owner"
        else set(permission_codes(actor.account, "fulfilment"))
        if actor.context == "staff"
        else set()
    )


def profiles(account, role="summary"):
    bundles = {
        "summary": ["fulfilment", "orders_negotiation", "payments_refunds"],
        "logistics": ["fulfilment"],
        "finance": ["payments_refunds"],
        "concession": ["orders_negotiation"],
    }[role]
    allowed = Q(is_owner=True)
    for bundle in bundles:
        allowed |= Q(bundles__contains=[bundle])
    member = Membership.objects.filter(company_id=OuterRef("pk"), account=account, active=True).filter(allowed)
    return (
        BusinessProfile.objects.annotate(allowed_member=Exists(member)).filter(
            Q(kind="individual", account=account) | Q(kind="company", allowed_member=True)
        )
        if account.context == "seller"
        else BusinessProfile.objects.none()
    )


def case_scope(actor):
    if actor.context == "owner":
        return ReviewCase.objects.all()
    codes = rights(actor)
    if actor.context != "staff" or "read_fulfilment" not in codes:
        return ReviewCase.objects.none()
    qs = ReviewCase.objects.all()
    return qs if "assign_fulfilment" in codes else qs.filter(assigned_to=actor.user)


def scope(actor, *, seller=None, role="summary", assignment=False):
    if actor.context == "owner":
        qs = SellerOrder.objects.all()
    elif actor.context == "staff":
        cases = case_scope(actor)
        if not assignment:
            cases = cases.filter(assigned_to=actor.user)
        qs = SellerOrder.objects.filter(fulfilment_cases__in=cases).distinct()
    elif actor.context == "buyer":
        if seller:
            raise PermissionDenied()
        qs = SellerOrder.objects.filter(buyer=actor.account)
    elif actor.context == "seller":
        qs = SellerOrder.objects.filter(seller_id__in=profiles(actor.account, role).values("pk"))
    else:
        raise PermissionDenied()
    if seller:
        qs = qs.filter(seller_id=seller)
    return qs


def seller_has(actor, order, role):
    return actor.context == "seller" and profiles(actor.account, role).filter(pk=order.seller_id).exists()


def assigned(actor, order, kind=None):
    qs = case_scope(actor).filter(order_id=order.pk, assigned_to=actor.user)
    if kind:
        qs = qs.filter(kind=kind)
    return actor.context == "owner" or qs.exists()


def approved(order):
    from apps.verification.models import ReviewCase as Verification

    return Verification.objects.filter(
        profile_id=order.seller_id, revision=order.seller.revision, status="approved"
    ).exists()


def read_context(actor, orders):
    """Request-local list projection only; mutations always re-query after locks."""
    result = {"codes": rights(actor), "roles": {}, "approved": set(), "assigned": set()}
    if actor.context == "seller":
        for role in ["logistics", "finance", "concession"]:
            result["roles"][role] = set(profiles(actor.account, role).values_list("pk", flat=True))
        from apps.verification.models import ReviewCase as Verification
        from django.db.models import F

        result["approved"] = set(
            Verification.objects.filter(
                profile_id__in=[x.seller_id for x in orders], status="approved", revision=F("profile__revision")
            ).values_list("profile_id", flat=True)
        )
    elif actor.context == "staff":
        result["assigned"] = set(
            case_scope(actor)
            .filter(order_id__in=[x.pk for x in orders], assigned_to=actor.user)
            .values_list("order_id", "kind")
        )
    return result


def capabilities(actor, order, *, read_scope=None):
    codes = read_scope["codes"] if read_scope is not None else rights(actor)
    native = actor.context in {"owner", "staff"}
    buyer = actor.context == "buyer" and actor.account.pk == order.buyer_id

    def role(name):
        return (
            order.seller_id in read_scope["roles"].get(name, set())
            if read_scope is not None
            else seller_has(actor, order, name)
        )

    def resource(kind=None):
        if actor.context == "owner":
            return True
        if read_scope is not None:
            return (
                (order.pk, kind) in read_scope["assigned"]
                if kind
                else any(pk == order.pk for pk, k in read_scope["assigned"])
            )
        return assigned(actor, order, kind)

    logistics = role("logistics")
    finance = role("finance")
    writable = (
        (order.seller_id in read_scope["approved"] if read_scope is not None else approved(order))
        if actor.context == "seller"
        else True
    )
    staff_logistics = native and resource("logistics")
    financial_read = (
        buyer
        or finance
        or native
        and resource()
        and bool(codes & {"confirm_delivery_payment", "correct_delivery_payment"})
    )
    return {
        "recipient": buyer or logistics or staff_logistics and "read_recipients" in codes,
        "recipient_edit": buyer,
        "prepare": logistics and writable or staff_logistics and "manage_logistics" in codes,
        "dispatch": logistics and writable or staff_logistics and "manage_logistics" in codes,
        "tracking": logistics and writable or staff_logistics and "manage_logistics" in codes,
        "deliver": buyer or logistics and writable or staff_logistics and "confirm_delivery" in codes,
        "partial": role("concession") and writable,
        "claim": buyer or finance and writable,
        "financial_details": financial_read,
        "evidence": buyer or finance or native and resource() and "read_delivery_evidence" in codes,
        "handover": logistics or staff_logistics and {"print_handover", "read_recipients"} <= codes,
        "native": native,
        "invoice": buyer or actor.context == "owner" or finance or role("concession"),
    }


def lock_order(actor, pk, *, assignment=False, additional_users=()):
    initial = get_object_or_404(scope(actor, assignment=assignment), pk=pk)
    buyer_profiles = BusinessProfile.objects.filter(account_id=initial.buyer_id, kind="business").values_list(
        "pk", flat=True
    )
    list(BusinessProfile.objects.select_for_update().filter(pk__in=[initial.seller_id, *buyer_profiles]).order_by("pk"))
    account = account_for(actor)
    ids = [initial.buyer_id] + ([account.pk] if account else [])
    users = [*Account.objects.filter(pk__in=ids).values_list("user_id", flat=True), actor.user.pk, *additional_users]
    list(User.objects.select_for_update().filter(pk__in=users).order_by("pk"))
    list(Account.objects.select_for_update().filter(pk__in=ids).order_by("pk"))
    lock_actor(actor)
    return get_object_or_404(
        scope(actor, assignment=assignment).select_related("seller__account__user", "buyer__user", "invoice"), pk=pk
    )


def independent(order, user, *, provider=None):
    goods_independent(order, user)
    if (
        Claim.objects.filter(order=order, event__actor=user).exists()
        or Correction.objects.filter(order=order, event__actor=user).exists()
    ):
        raise PermissionDenied("An independent reviewer is required.")
    providers = Provider.objects.filter(order=order)
    if provider:
        providers = providers.filter(pk=provider.pk)
    if (
        providers.filter(event__actor=user).exists()
        or providers.filter(Q(business__account__user=user) | Q(business__memberships__account__user=user)).exists()
    ):
        raise PermissionDenied("Provider-side actions require another reviewer.")


def require_case(actor, case, code, *, decide=False):
    if code not in rights(actor) or not case_scope(actor).filter(pk=case.pk).exists():
        raise NotFound()
    if actor.context != "owner" and case.assigned_to_id != actor.user.pk:
        raise NotFound()
    if decide:
        if case.assigned_to_id != actor.user.pk:
            raise PermissionDenied("Assign an independent eligible reviewer first.")
        independent(case.order, actor.user)


def recipient_allowed(order, account):
    account = (
        Account.objects.select_related("user")
        .filter(pk=account.pk, status="active", user__is_active=True, user__email_verified=True)
        .first()
    )
    return bool(
        account
        and (
            account.context == "buyer"
            and account.pk == order.buyer_id
            or account.context == "seller"
            and profiles(account).filter(pk=order.seller_id).exists()
        )
    )
