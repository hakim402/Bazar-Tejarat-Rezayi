"""Reusable current business gates; catalogue/checkout operations are later phases."""

from rest_framework.exceptions import PermissionDenied
from .access import membership
from .models import BUNDLES, BusinessProfile
from .profiles import effective_entitlement


def require_seller_approval(actor, profile_id, bundle=None):
    profile = BusinessProfile.objects.get(pk=profile_id)
    account = actor.account
    if (
        actor.context != "seller"
        or profile.kind not in {"individual", "company"}
        or not effective_entitlement(profile, account)
    ):
        raise PermissionDenied()
    if bundle is not None:
        if bundle not in BUNDLES:
            raise PermissionDenied()
        if profile.kind == "company" and bundle not in membership(profile, actor).bundles:
            raise PermissionDenied()
    return profile


def require_wholesale_verification(actor, profile_id):
    profile = BusinessProfile.objects.get(pk=profile_id)
    if actor.context != "buyer" or profile.kind != "business" or not effective_entitlement(profile, actor.account):
        raise PermissionDenied()
    # Future checkout must additionally enforce its product quantity/minimum rules.
    return profile
