from django.conf import settings
from django.core.files.base import ContentFile
from django.core.files.storage import storages
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.accounts.models import Account
from apps.foundation.storage import FileLocation
from apps.organizations.access import Conflict, assert_version, company_lock, event, independent, manage_profile
from apps.organizations.profiles import MATERIAL, current_case, next_revision, snapshot
from .files import MAX_FILES, validate_file
from .models import Evidence, ReviewCase


def categories(profile):
    return (
        ["identity"]
        if profile.kind == "individual"
        else ["business", "representative_identity", "representative_authority"]
    )


def reviewer(case, actor, permission):
    account = actor.staff(permission)
    independent(case.profile, actor)
    if actor.context != "owner" and case.assigned_to_id != account.pk:
        raise PermissionDenied("This case is assigned to another reviewer.")
    return account


def applicant_case(actor, profile):
    manage_profile(profile, actor)
    return current_case(profile)


@transaction.atomic
def upload_evidence(actor, profile_id, upload, category, version, replace_id=None):
    profile = company_lock(profile_id)
    case = applicant_case(actor, profile)
    assert_version(case, version)
    if category not in categories(profile):
        raise ValidationError({"category": ["Choose an applicable evidence category."]})
    if case.status != "draft":
        raise Conflict("Start a new revision before replacing submitted evidence.")
    replaced = None
    if replace_id:
        replaced = case.evidence.filter(pk=replace_id).first()
        if not replaced:
            raise PermissionDenied()
    if case.evidence.count() >= MAX_FILES and not replaced:
        raise ValidationError({"file": ["At most ten files per revision."]})
    content, kind, digest, key = validate_file(upload)
    alias = settings.NEW_PRIVATE_STORAGE_ALIAS
    storage = storages[alias]
    saved = None
    try:
        saved = storage.save(key, ContentFile(content))
        item = Evidence.objects.create(
            case=case,
            category=category,
            storage_alias=alias,
            key=saved,
            content_type=kind,
            size=len(content),
            sha256=digest,
        )
        if replaced:
            replaced.delete()  # Only a draft reference; immutable previous revision still owns its bytes.
        case.version += 1
        case.save()
        event(actor, "verification_evidence_uploaded", item)
    except Exception:
        if saved:
            storage.delete(saved)  # Only the just-created opaque key, never a pre-existing reference.
        raise
    return item


@transaction.atomic
def application_action(actor, profile_id, data):
    profile = company_lock(profile_id)
    case = applicant_case(actor, profile)
    assert_version(case, data["version"])
    if data["action"] == "revise":
        if case.status == "draft":
            return case
        case = next_revision(profile)
        profile.version += 1
        profile.save(update_fields=["version"])
        event(actor, "verification_revision_started", case, after="draft")
        return case
    if case.status != "draft":
        raise Conflict()
    requests = data.get("alternative_requests", {})
    if not set(requests).issubset(categories(profile)):
        raise ValidationError({"alternative_requests": ["Unknown category."]})
    case.alternative_requests = requests
    if data["action"] == "submit":
        if any(
            not getattr(profile, field).strip()
            for field in MATERIAL
            if field != "representative" or profile.kind != "individual"
        ):
            raise ValidationError({"profile": ["Complete the legal, activity, private contact and location details."]})
        present = set(case.evidence.values_list("category", flat=True))
        missing = [key for key in categories(profile) if key not in present and not requests.get(key, "").strip()]
        if missing:
            raise ValidationError({"evidence": missing})
        # Check persisted storage before submitting; never approve missing recorded evidence.
        if any(not storages[item.storage_alias].exists(item.key) for item in case.evidence.all()):
            raise ValidationError({"evidence": ["Evidence is unavailable; replace it before submission."]})
        case.snapshot, case.status, case.submitted_at = snapshot(profile), "submitted", timezone.now()
    case.version += 1
    case.save()
    event(actor, "verification_" + data["action"], case, after=case.status)
    return case


@transaction.atomic
def review_action(actor, pk, data):
    preliminary = ReviewCase.objects.get(pk=pk)
    profile = company_lock(preliminary.profile_id)
    case = ReviewCase.objects.select_related("profile__account").get(pk=pk)
    assert_version(case, data["version"])
    if case.revision != profile.revision or case.status not in {"submitted", "under_review"}:
        raise Conflict()
    before = case.status
    previous_assignee = str(case.assigned_to_id) if case.assigned_to_id else None
    action = data["action"]
    if action == "assign":
        actor.staff("assign_review")
        independent(profile, actor)
        target = (
            Account.objects.select_related("user")
            .filter(
                pk=data.get("assigned_to"),
                context="staff",
                status="active",
                user__is_active=True,
                user__email_verified=True,
            )
            .first()
        )
        if (
            not target
            or not target.permission_groups.filter(
                permissions__content_type__app_label="verification", permissions__codename="decide_review"
            ).exists()
        ):
            raise ValidationError({"assigned_to": ["Select an active authorized reviewer."]})
        if (
            target.user_id == profile.account.user_id
            or profile.memberships.filter(account__user_id=target.user_id).exists()
        ):
            raise PermissionDenied("Another authorized reviewer must handle this case.")
        case.assigned_to, case.status = target, "under_review"
    else:
        reviewer(case, actor, "decide_review")
        alternatives = data.get("accepted_alternatives", {})
        if not set(alternatives).issubset(categories(profile)):
            raise ValidationError({"accepted_alternatives": ["Unknown category."]})
        if action == "approved":
            present = set(case.evidence.values_list("category", flat=True))
            if any(key not in present and not alternatives.get(key, "").strip() for key in categories(profile)):
                raise ValidationError(
                    {"evidence": ["Each category requires evidence or a reasoned accepted alternative."]}
                )
            if any(not storages[item.storage_alias].exists(item.key) for item in case.evidence.all()):
                raise ValidationError({"evidence": ["Evidence is unavailable; approval refused."]})
        case.status, case.reason, case.accepted_alternatives = action, data["reason"], alternatives
        case.decided_at = timezone.now()
    case.version += 1
    case.save()
    event(
        actor,
        "verification_" + action,
        case,
        reason=data["reason"],
        before={"status": before, "assigned_to": previous_assignee} if action == "assign" else before,
        after={"status": case.status, "assigned_to": str(case.assigned_to_id)} if action == "assign" else case.status,
    )
    if data.get("internal_note"):
        event(actor, "verification_internal_note", case, reason=data["internal_note"])
    return case


def authorize_case(actor, case, *, evidence=False):
    if actor.context in {"staff", "owner"}:
        reviewer(case, actor, "read_evidence")
    else:
        manage_profile(case.profile, actor)


def download_evidence(actor, pk):
    item = Evidence.objects.select_related("case__profile__account").get(pk=pk)
    authorize_case(actor, item.case, evidence=True)
    location = FileLocation(item.storage_alias, item.key)
    stream = location.open()
    event(actor, "verification_evidence_downloaded", item)
    return item, stream
