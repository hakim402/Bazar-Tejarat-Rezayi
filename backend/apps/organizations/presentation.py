from django.utils import timezone
from rest_framework.exceptions import PermissionDenied

from .access import eligible_member, manage_profile, membership
from .models import BUNDLES
from .profiles import PROFILE_FIELDS, current_case, effective_entitlement


def profile_data(profile, actor):
    account = actor.account
    try:
        manage_profile(profile, actor)
        can_manage = True
    except PermissionDenied:
        membership(profile, actor)
        can_manage = False
    member = profile.memberships.filter(account=account, active=True).first() if profile.kind == "company" else None
    result = {
        "id": profile.pk,
        "kind": profile.kind,
        "display_name": profile.display_name,
        "version": profile.version,
        "revision": profile.revision,
        "review_status": current_case(profile).status,
        "entitlement": effective_entitlement(profile, account),
        "can_manage": can_manage,
        "my_membership_id": member.pk if member else None,
        "bundles": member.bundles if member else list(BUNDLES),
    }
    if can_manage:
        result.update({key: getattr(profile, key) for key in PROFILE_FIELDS})
    return result


def member_data(item):
    return {
        "id": item.pk,
        "account_id": item.account_id,
        "name": item.account.user.display_name,
        "is_owner": item.is_owner,
        "active": item.active,
        "bundles": item.bundles,
        "eligible": eligible_member(item),
    }


def invitation_data(item):
    mail = item.deliveries.order_by("-pk").first()
    return {
        "id": item.pk,
        "email": item.email,
        "bundles": item.bundles,
        "status": "expired" if item.status == "pending" and item.expires_at <= timezone.now() else item.status,
        "expires_at": item.expires_at,
        "version": item.version,
        "delivery_status": mail.status if mail else "queued",
    }


def transfer_data(item, *, private=False):
    return {
        **({"company_identity": item.company_identity} if private else {}),
        "company_revision": item.company_revision,
        "id": item.pk,
        "company_id": item.company_id,
        "company_name": item.company.display_name,
        "requester_id": item.requester_id,
        "recipient_id": item.recipient_id,
        "recipient_account_id": item.recipient.account_id,
        "recipient_name": item.recipient.account.user.display_name,
        "retained_bundles": item.retained_bundles,
        "status": item.status,
        "version": item.version,
        "reason": item.reason,
        "created_at": item.created_at,
    }
