from django.db import IntegrityError, transaction
from rest_framework.exceptions import ValidationError

from apps.verification.models import ReviewCase
from .access import assert_version, company_lock, event, manage_profile
from .models import BUNDLES, BusinessProfile, Membership

MATERIAL = ("legal_name", "business_type", "contact_phone", "location", "representative")
PROFILE_FIELDS = ("display_name", *MATERIAL)


def snapshot(profile):
    return {field: getattr(profile, field) for field in PROFILE_FIELDS}


def current_case(profile):
    return ReviewCase.objects.get(profile=profile, revision=profile.revision)


def approved(profile):
    from django.core.files.storage import storages
    from django.core.exceptions import SuspiciousFileOperation
    from django.core.files.storage.handler import InvalidStorageError

    case = ReviewCase.objects.filter(profile=profile, revision=profile.revision, status="approved").first()
    if not case:
        return False
    try:
        # Keep the signed-off history, but never grant business access over missing reviewed evidence.
        return all(storages[item.storage_alias].exists(item.key) for item in case.evidence.all())
    except (OSError, SuspiciousFileOperation, InvalidStorageError):
        return False


def effective_entitlement(profile, account):
    from apps.accounts.models import Account

    profile = BusinessProfile.objects.get(pk=profile.pk)
    account = Account.objects.select_related("user").get(pk=account.pk)
    if account.status != "active" or not account.user.is_active or not account.user.email_verified:
        return False
    if profile.kind == "company":
        if not Membership.objects.filter(company=profile, account=account, active=True).exists():
            return False
    elif profile.account_id != account.pk:
        return False
    return approved(profile)


@transaction.atomic
def create_profile(actor, data):
    account = actor.account
    if data["kind"] not in (
        {"individual", "company"} if actor.context == "seller" else {"business"} if actor.context == "buyer" else set()
    ):
        raise ValidationError({"kind": ["Invalid profile for this account context."]})
    try:
        with transaction.atomic():
            profile = BusinessProfile.objects.create(account=account, **data)
    except IntegrityError:
        raise ValidationError({"kind": ["This profile already exists."]}) from None
    if profile.kind == "company":
        Membership.objects.create(company=profile, account=account, is_owner=True, bundles=list(BUNDLES))
    ReviewCase.objects.create(profile=profile, snapshot=snapshot(profile))
    event(actor, "business_profile_created", profile, after="draft")
    return profile


def next_revision(profile):
    previous = current_case(profile)
    profile.revision += 1
    profile.save(update_fields=["revision"])
    case = ReviewCase.objects.create(profile=profile, revision=profile.revision, snapshot=snapshot(profile))
    # Shared immutable storage references preserve previous evidence; replacements never overwrite bytes.
    for evidence in previous.evidence.all():
        evidence.pk = None
        evidence.case = case
        evidence.save()
    return case


@transaction.atomic
def update_profile(actor, pk, data):
    profile = company_lock(pk)
    manage_profile(profile, actor)
    assert_version(profile, data.pop("version"))
    case = current_case(profile)
    material_change = any(getattr(profile, field) != data.get(field, getattr(profile, field)) for field in MATERIAL)
    for field, value in data.items():
        setattr(profile, field, value)
    if material_change and case.status != "draft":
        next_revision(profile)
    profile.version += 1
    profile.save()
    case = current_case(profile)
    if case.status == "draft":
        case.snapshot = snapshot(profile)
        case.version += 1
        case.save()
    event(actor, "business_profile_updated", profile, after="material_revision" if material_change else "display_only")
    return profile
