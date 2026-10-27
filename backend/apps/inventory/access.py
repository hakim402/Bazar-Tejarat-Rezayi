"""Inventory capabilities extend the existing fresh grant and business membership gates."""

from django.shortcuts import get_object_or_404
from rest_framework.exceptions import PermissionDenied
from apps.organizations.access import visible_profiles, membership
from apps.organizations.profiles import effective_entitlement
from apps.organizations.models import BusinessProfile


def authorize(actor, profile_id, write=False):
    profile = get_object_or_404(visible_profiles(actor), pk=profile_id)
    if actor.context != "seller" or not effective_entitlement(profile, actor.account):
        raise PermissionDenied("Current seller approval is required.")
    if profile.kind == "company":
        bundles = membership(profile, actor).bundles
        if "catalogue" not in bundles and (write or "fulfilment" not in bundles):
            raise PermissionDenied("This business permission does not allow this stock action.")
    return profile


def capabilities(actor, profile):
    eligible = effective_entitlement(profile, actor.account)
    bundles = membership(profile, actor).bundles if profile.kind == "company" else ["catalogue"]
    return {
        "read": eligible and bool(set(bundles) & {"catalogue", "fulfilment"}),
        "write": eligible and "catalogue" in bundles,
    }


def staff(actor, permission):
    account = actor.account
    from apps.accounts.admin_access import permission_codes
    if actor.context == "owner":
        return
    if actor.context != "staff" or permission not in permission_codes(account, "inventory"):
        raise PermissionDenied()


def lock_profile(actor, profile_id, write=False):
    authorize(actor, profile_id, write)
    profile = BusinessProfile.objects.select_for_update().get(pk=profile_id)
    authorize(actor, profile.pk, write)
    return profile
