"""Fresh marketplace permissions, business ownership, and batched public eligibility."""

from django.core.files.storage import storages
from django.core.files.storage.handler import InvalidStorageError
from django.core.exceptions import SuspiciousFileOperation
from django.db.models import Exists, OuterRef, Q, Subquery
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import PermissionDenied
from apps.accounts.admin_access import permission_codes
from apps.organizations.access import independent, manage_profile, visible_profiles
from apps.organizations.models import BusinessProfile, Membership
from apps.organizations.profiles import effective_entitlement
from apps.verification.models import ReviewCase, Evidence
from .models import PERMISSIONS


def eligible_profiles(profile_ids=None):
    approved = ReviewCase.objects.filter(profile_id=OuterRef("pk"), revision=OuterRef("revision"), status="approved")
    member = Membership.objects.filter(company_id=OuterRef("pk"), account_id=OuterRef("account_id"), active=True)
    profiles = BusinessProfile.objects.filter(kind__in=["individual", "company"], account__context="seller", account__status="active", account__user__is_active=True, account__user__email_verified=True).annotate(
        approved_case=Subquery(approved.values("pk")[:1]), owner_membership=Exists(member)
    ).filter(approved_case__isnull=False).filter(Q(kind="individual") | Q(owner_membership=True))
    if profile_ids is not None:
        profiles = profiles.filter(pk__in=profile_ids)
    # Filesystem continuity cannot be expressed in SQL. Batch only evidence metadata,
    # exclude invalid seller IDs in SQL before product counting/pagination, and never cache across requests.
    invalid = set()
    seen = {}
    rows = Evidence.objects.filter(case_id__in=Subquery(profiles.values("approved_case"))).values_list("case__profile_id", "storage_alias", "key")
    for profile_id, alias, key in rows.iterator(chunk_size=500):
        try:
            if (alias, key) not in seen:
                seen[alias, key] = storages[alias].exists(key)
            exists = seen[alias, key]
        except (OSError, SuspiciousFileOperation, InvalidStorageError):
            from apps.catalogue.media import StorageUnavailable
            raise StorageUnavailable() from None
        if not exists:
            invalid.add(profile_id)
    return profiles.exclude(pk__in=invalid)


def seller(actor, profile_id, *, write=False, lock=False):
    if actor.context != "seller":
        raise PermissionDenied()
    get_object_or_404(visible_profiles(actor), pk=profile_id)
    profile = get_object_or_404(BusinessProfile.objects.select_for_update() if lock else BusinessProfile.objects.all(), pk=profile_id)
    if profile.kind not in {"individual", "company"} or not effective_entitlement(profile, actor.account):
        raise PermissionDenied()
    if write:
        manage_profile(profile, actor)
    return profile


def permissions(actor):
    actor.account
    return set(PERMISSIONS) if actor.context == "owner" else set(permission_codes(actor.account, "marketplace")) if actor.context == "staff" else set()


def staff(actor, permission, revision=None, *, assigned=False):
    if permission not in permissions(actor):
        raise PermissionDenied()
    if revision is not None:
        independent(revision.store.profile, actor)
        if assigned and actor.context != "owner" and revision.assigned_to_id != actor.account.pk:
            raise PermissionDenied()
