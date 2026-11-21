from django.http import FileResponse, Http404, HttpResponseRedirect
from django.contrib import admin
from django.contrib.admin import SimpleListFilter
from django.shortcuts import get_object_or_404
from django.urls import path, reverse
from rest_framework.exceptions import APIException
from django.core.exceptions import PermissionDenied
from django.utils.translation import gettext_lazy as _

from apps.accounts.admin import owner_site
from apps.accounts.admin.copy import COPY as ADMIN_COPY
from apps.accounts.admin.access import admin_actor, permits, is_owner
from apps.accounts.admin.display import short_id
from apps.catalogue.admin.helpers import link_button
from apps.catalogue.admin.presentation import seller_cell
from apps.orders.admin_presentation import account_cell
from apps.organizations.admin import ReadOnlyAdmin, WorkflowAdmin
from .models import Evidence, ReviewCase
from .services import cases_requiring_another_reviewer, download_evidence


class IndependentReviewerFilter(SimpleListFilter):
    title = _("Reviewer")
    parameter_name = "reviewer"

    def lookups(self, request, model_admin):
        from apps.accounts.admin.review_queues import review_labels

        return (("independent", review_labels()["another_reviewer"]),)

    def queryset(self, request, queryset):
        if self.value() == "independent" and is_owner(request):
            return queryset.filter(cases_requiring_another_reviewer(request.user))
        return queryset


class CaseAdmin(WorkflowAdmin):
    def get_list_filter(self, request):
        filters = super().get_list_filter(request)
        return [*filters, IndependentReviewerFilter] if is_owner(request) else filters

    def staff_view(self, request, obj=None):
        if not permits(request, "verification", "view_queue", "read_evidence", "decide_review", "assign_review"):
            return False
        return obj is None or self.staff_queryset(request, ReviewCase.objects.filter(pk=obj.pk)).exists()

    def get_search_fields(self, request):
        return self.search_fields if is_owner(request) else ["profile__display_name"]

    def staff_queryset(self, request, qs):
        qs = qs.exclude(status="draft").exclude(profile__account__user=request.user).exclude(
            profile__memberships__account__user=request.user)
        if not permits(request, "verification", "assign_review", "view_queue"):
            qs = qs.filter(assigned_to=admin_actor(request).account)
        return qs.distinct()

    list_display = ["business_identity", "revision", "status", "reviewer", "submitted_at", "review_case"]
    list_filter = ["status", "profile__kind"]
    search_fields = ["profile__display_name", "profile__legal_name"]
    list_select_related = ["profile__account__user", "assigned_to__user"]
    ordering = ["-submitted_at", "-created_at"]
    list_display_links = ["business_identity"]
    badge_fields = ("status",)

    @admin.display(description=_("Business"))
    def business_identity(self, obj):
        return seller_cell(obj.profile)

    @admin.display(description=_("Assigned reviewer"))
    def reviewer(self, obj):
        return account_cell(obj.assigned_to) if obj.assigned_to_id else _("Unassigned")

    def review_case(self, obj):
        return link_button(reverse("admin:verification_reviewcase_workflow", args=[obj.pk]), _("Open guarded review"), "fact_check")

    def change_view(self, request, object_id, form_url="", extra_context=None):
        if request.method != "GET":
            raise PermissionDenied
        obj = self.get_object(request, object_id)
        if obj is None:
            raise Http404
        return HttpResponseRedirect(reverse("admin:verification_reviewcase_workflow", args=[obj.pk]))

    def workflow(self, request, pk):
        from .owner_review import workflow
        return workflow(self, request, pk)


class EvidenceAdmin(ReadOnlyAdmin):
    def staff_view(self, request, obj=None):
        if not permits(request, "verification", "read_evidence"):
            return False
        return obj is None or self.staff_queryset(request, Evidence.objects.filter(pk=obj.pk)).exists()

    def staff_queryset(self, request, qs):
        return qs.filter(case__assigned_to=admin_actor(request).account).exclude(
            case__profile__account__user=request.user).exclude(case__profile__memberships__account__user=request.user).distinct()

    list_display = ["record_reference", "business_identity", "category", "size", "created_at", "protected_download"]
    list_select_related = ["case__profile__account__user"]
    badge_fields = ("category",)

    @admin.display(description=_("Reference"))
    def record_reference(self, obj):
        return short_id(obj.pk)

    @admin.display(description=_("Business"))
    def business_identity(self, obj):
        return seller_cell(obj.case.profile)

    def get_readonly_fields(self, request, obj=None):
        return ["id", "case", "category", "content_type", "size", "created_at", "protected_download"]

    def protected_download(self, obj):
        return link_button(
            reverse("admin:verification_evidence_download", args=[obj.pk]), ADMIN_COPY["protected_evidence"], "download"
        )

    def get_urls(self):
        return [
            path(
                "<uuid:pk>/download/", self.admin_site.admin_view(self.download), name="verification_evidence_download"
            ),
            *super().get_urls(),
        ]

    def download(self, request, pk):
        get_object_or_404(self.get_queryset(request), pk=pk)
        try:
            item, stream = download_evidence(admin_actor(request), pk)
        except APIException:
            raise PermissionDenied from None
        response = FileResponse(
            stream, as_attachment=True, filename="evidence", content_type="application/octet-stream"
        )
        response["Cache-Control"] = "private, no-store"
        response["X-Content-Type-Options"] = "nosniff"
        response["Content-Security-Policy"] = "sandbox; default-src 'none'"
        return response


owner_site.register(ReviewCase, CaseAdmin)
owner_site.register(Evidence, EvidenceAdmin)
