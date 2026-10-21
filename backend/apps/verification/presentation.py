from apps.accounts.models import AuditEvent
from django.db.models import Q
from .services import categories


def queue_item(case):
    return {key: getattr(case, key) for key in ("id", "profile_id", "revision", "version", "status", "created_at")} | {
        "display_name": case.profile.display_name,
        "kind": case.profile.kind,
        "assigned_to": case.assigned_to_id,
    }


def case_data(case, *, staff=False):
    history = AuditEvent.objects.filter(
        Q(resource_type="verification.reviewcase", resource_id=case.pk)
        | Q(resource_type="verification.evidence", state__case_id=str(case.pk))
    ).order_by("created_at")
    if not staff:
        history = history.exclude(action__in=["verification_internal_note", "verification_evidence_downloaded"])
    events = list(history.values("id", "action", "reason", "created_at", "context"))
    if not staff:
        for item in events:
            if item["action"] == "verification_assign":
                item["reason"] = ""  # Assignment/takeover justification is operational, not an applicant decision.
    return queue_item(case) | {
        "snapshot": case.snapshot,
        "reason": case.reason,
        "categories": categories(case.profile),
        "alternative_requests": case.alternative_requests,
        "accepted_alternatives": case.accepted_alternatives,
        "evidence": list(case.evidence.values("id", "category", "content_type", "size")),
        "history": events,
    }
