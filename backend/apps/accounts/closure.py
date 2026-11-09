"""Self-service buyer/seller account closure that never erases history.

Closure archives one context. Orders, money, disputes, reviews, messages and audit
stay intact; reopening is a super-admin Account status change in native admin.
"""

from django.contrib.auth import logout
from django.db import transaction
from django.db.models import Exists, F, OuterRef, Q
from rest_framework.exceptions import ValidationError

from .models import Account, User
from .services import AuthFailure, audit, get_grant, rate_limit, revoke_context

BLOCKERS = (
    "open_orders",
    "refunds_outstanding",
    "pending_disputes",
    "open_negotiations",
    "open_payment_reviews",
    "open_delivery_reviews",
    "sole_company_owner",
)


def _orders(account):
    from apps.orders.models import SellerOrder

    if account.context == "buyer":
        return SellerOrder.objects.filter(buyer=account)
    return SellerOrder.objects.filter(seller__kind="individual", seller__account=account)


def _sole_companies(account):
    from apps.organizations.models import Membership

    others = Membership.objects.filter(
        company_id=OuterRef("company_id"), is_owner=True, active=True, account__status="active"
    ).exclude(account=account)
    return Membership.objects.filter(account=account, is_owner=True, active=True).exclude(Exists(others))


def blockers(account):
    """Ordered blocker codes; an empty list means the context may be closed."""
    from apps.fulfilment import models as fm
    from apps.orders import aftercare
    from apps.orders.models import CancellationRequest, DisputeRequest, Negotiation
    from apps.payments.models import ReviewCase as PaymentCase

    orders = _orders(account)
    scope = {"order__in": orders.values("pk")}
    annotated = aftercare.annotate(orders)
    open_orders = annotated.filter(aftercare_cancelled=False).exclude(
        Exists(fm.Completion.objects.filter(order_id=OuterRef("pk")))
    )
    party = Q(buyer=account) if account.context == "buyer" else Q(seller__kind="individual", seller__account=account)
    found = {
        "open_orders": open_orders.exists()
        or CancellationRequest.objects.filter(**scope, state="pending").exists(),
        "refunds_outstanding": annotated.filter(refund_due_total__gt=F("refund_confirmed_total")).exists(),
        "pending_disputes": DisputeRequest.objects.filter(**scope, state="pending").exists(),
        "open_negotiations": Negotiation.objects.filter(party, state__in=["submitted", "correction_requested"]).exists(),
        "open_payment_reviews": PaymentCase.objects.filter(**scope, state="open").exists(),
        "open_delivery_reviews": fm.ReviewCase.objects.filter(**scope, state="open").exists(),
        "sole_company_owner": account.context == "seller" and _sole_companies(account).exists(),
    }
    return [code for code in BLOCKERS if found[code]]


def closure_status(request, context):
    account = get_grant(request, context)
    return {"context": context, "blockers": blockers(account)}


def close_account(request, context, password):
    account = get_grant(request, context)
    rate_limit(request, "account_close", identity=str(request.user.pk), limit=5)
    with transaction.atomic():
        user = User.objects.select_for_update().get(pk=request.user.pk)
        request.user = user
        account = Account.objects.select_for_update().get(pk=get_grant(request, context).pk)
        if not user.check_password(password):
            raise AuthFailure()
        found = blockers(account)
        if found:
            raise ValidationError({"blockers": found})
        revoke_context(request, context)
        account.status = Account.Status.ARCHIVED
        account.save(update_fields=["status", "access_epoch"])
        audit(
            "account_closed",
            request=request,
            user=user,
            account=account,
            context=context,
            fields=["status"],
            reason="self_service",
            state={"status": {"before": "active", "after": "archived"}},
        )
        remaining = Account.objects.filter(user=user, status="active").exclude(context="staff").exists()
    if not remaining:
        logout(request)
    return {"closed": True, "context": context}
