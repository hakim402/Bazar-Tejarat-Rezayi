"""Owner review presentation; every decision still uses the shared guarded service."""

from django.contrib import messages
from django.db.models import Q
from django.core.exceptions import PermissionDenied
from django.http import HttpResponseRedirect
from django.shortcuts import get_object_or_404, render
from django.urls import reverse
from rest_framework.exceptions import APIException

from apps.accounts.admin_copy import COPY as ADMIN_COPY
from apps.accounts.models import Account, AuditEvent
from apps.accounts.admin_access import admin_actor, permits, is_owner
from apps.organizations.owner_copy import COPY
from .forms import ReviewWorkflowForm
from .services import authorize_case, categories, review_action, reviewer


def workflow(admin, request, pk):
    case = get_object_or_404(
        admin.get_queryset(request).select_related("profile__account", "assigned_to__user"), pk=pk
    )
    actor = admin_actor(request)
    try:
        if not is_owner(request) and permits(request, "verification", "assign_review"):
            from apps.organizations.access import independent
            independent(case.profile, actor)
        elif permits(request, "verification", "decide_review") and not permits(request, "verification", "read_evidence"):
            reviewer(case, actor, "decide_review")
        else:
            authorize_case(actor, case)
    except APIException:
        raise PermissionDenied from None
    can_read = permits(request, "verification", "read_evidence") and (
        is_owner(request) or case.assigned_to_id == actor.account.pk)
    reviewers = Account.objects.filter(
        context="staff", status="active", user__is_staff=True, user__is_active=True, user__email_verified=True,
        user__groups__permissions__content_type__app_label="verification",
        user__groups__permissions__codename="decide_review",
    ).exclude(user_id=case.profile.account.user_id).exclude(
        user_id__in=case.profile.memberships.values("account__user_id")
    ).distinct()
    has_reviewers = permits(request, "verification", "assign_review") and reviewers.exists()
    current = case.revision == case.profile.revision
    can_decide = permits(request, "verification", "decide_review") and (
        is_owner(request) or case.assigned_to_id == actor.account.pk)
    can_act = can_decide or permits(request, "verification", "assign_review")
    editable = current and case.status in {"submitted", "under_review"} and can_act
    t = COPY["en"]
    form = ReviewWorkflowForm(
        request.POST if request.method == "POST" else None,
        case=case, locale="en", initial={"version": case.version},
    )
    form.fields["action"].choices = [
        ("", ADMIN_COPY["review_choose"]),
        *([(action, t[action]) for action in ("approved", "rejected", "needs_information")]
          if permits(request, "verification", "decide_review") and (is_owner(request) or case.assigned_to_id == actor.account.pk) else []),
        *([("assign", t["assign"])] if has_reviewers else []),
    ]
    if has_reviewers:
        form.fields["assigned_to"].queryset = reviewers
        form.fields["assigned_to"].help_text = ADMIN_COPY["review_assignment_help"]
    else:
        form.fields.pop("assigned_to")
    if not can_read:
        for name, field in form.fields.items():
            if name.startswith("alternative_"):
                field.initial = ""
    if request.method == "POST" and form.is_valid():
        data = form.cleaned_data
        if data.get("assigned_to") is not None:
            data["assigned_to"] = data["assigned_to"].pk
        try:
            review_action(actor, case.pk, data)
        except APIException as error:
            # Domain errors are controlled messages, never storage/configuration exceptions.
            if isinstance(error.detail, dict):
                for field, detail in error.detail.items():
                    form.add_error(field if field in form.fields else None, detail)
            else:
                form.add_error(None, error.detail)
        else:
            messages.success(request, t["success"])
            return HttpResponseRedirect(request.path)
    fields = (
        ("display_name", ADMIN_COPY["review_business_name"]), ("legal_name", ADMIN_COPY["review_legal_name"]),
        ("business_type", ADMIN_COPY["review_activity"]), ("location", ADMIN_COPY["review_location"]),
        ("contact_phone", ADMIN_COPY["review_phone"]), ("representative", ADMIN_COPY["review_representative"]),
    )
    evidence = list(case.evidence.order_by("category", "created_at", "pk")) if permits(request, "verification", "read_evidence") and (is_owner(request) or case.assigned_to_id == actor.account.pk) else []
    rows = []
    for category in categories(case.profile):
        rows.append({
            "label": t[category], "requested": case.alternative_requests.get(category),
            "accepted": case.accepted_alternatives.get(category),
            "files": [{"url": reverse("admin:verification_evidence_download", args=[item.pk]),
                       "type": item.content_type, "size": item.size}
                      for item in evidence if item.category == category],
        })
    latest = case.profile.cases.filter(revision=case.profile.revision).first() if not current else None
    context = dict(
        admin.admin_site.each_context(request), title=ADMIN_COPY["review_title"], resource=case, review_copy=ADMIN_COPY,
        form=form, t=t, editable=editable, can_act=can_act, current=current, evidence_rows=rows if can_read else [], can_read=can_read,
        snapshot=[{"label": label, "value": case.snapshot.get(key, "")} for key, label in fields] if can_read else [],
        has_reviewers=has_reviewers, review_events=AuditEvent.objects.filter(Q(resource_type="verification.reviewcase", resource_id=case.pk) | Q(resource_type="verification.evidence", state__case_id=str(case.pk))).order_by("created_at") if can_read else [], latest_url=(
            reverse("admin:verification_reviewcase_workflow", args=[latest.pk]) if latest else None
        ),
    )
    response = render(request, "verification/owner_review.html", context)
    response["Cache-Control"] = "private, no-store"
    response["Referrer-Policy"] = "same-origin"
    return response
