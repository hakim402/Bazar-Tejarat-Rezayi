from django.http import FileResponse, Http404, HttpResponseRedirect
from django.shortcuts import get_object_or_404
from django.urls import path, reverse
from django.utils.html import format_html
from rest_framework.exceptions import APIException
from django.core.exceptions import PermissionDenied

from apps.accounts.admin import owner_site
from apps.accounts.admin_copy import COPY as ADMIN_COPY
from apps.accounts.admin_access import admin_actor, permits, is_owner
from apps.organizations.admin import ReadOnlyAdmin, WorkflowAdmin
from .models import Evidence, ReviewCase
from .services import download_evidence


class CaseAdmin(WorkflowAdmin):
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

    list_display = ["profile", "revision", "status", "submitted_at", "review_case", "assigned_to"]
    list_filter = ["status", "profile__kind"]
    search_fields = ["profile__display_name", "profile__legal_name"]
    list_select_related = ["profile", "assigned_to__user"]
    ordering = ["-submitted_at", "-created_at"]
    list_display_links = ["profile"]

    def review_case(self, obj):
        return format_html('<a href="{}">Review case</a>', reverse(
            "admin:verification_reviewcase_workflow", args=[obj.pk]
        ))

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

    list_display = ["id", "case", "category", "size"]

    def get_readonly_fields(self, request, obj=None):
        return ["id", "case", "category", "content_type", "size", "created_at", "protected_download"]

    def protected_download(self, obj):
        return format_html(
            '<a href="{}">{}</a>',
            reverse("admin:verification_evidence_download", args=[obj.pk]), ADMIN_COPY["protected_evidence"],
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
