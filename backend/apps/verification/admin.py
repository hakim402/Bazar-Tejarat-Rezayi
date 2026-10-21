from django.http import FileResponse
from django.shortcuts import get_object_or_404
from django.urls import path, reverse
from django.utils.html import format_html
from rest_framework.exceptions import APIException
from django.core.exceptions import PermissionDenied

from apps.accounts.admin import owner_site
from apps.organizations.access import Actor
from apps.organizations.admin import ReadOnlyAdmin, WorkflowAdmin
from .models import Evidence, ReviewCase
from .services import download_evidence


class CaseAdmin(WorkflowAdmin):
    list_display = ["id", "profile", "revision", "status", "assigned_to", "version"]
    list_filter = ["status", "profile__kind"]


class EvidenceAdmin(ReadOnlyAdmin):
    list_display = ["id", "case", "category", "size"]

    def get_readonly_fields(self, request, obj=None):
        return ["id", "case", "category", "content_type", "size", "created_at", "protected_download"]

    def protected_download(self, obj):
        return format_html(
            '<a href="{}">Download with logged owner oversight</a>',
            reverse("admin:verification_evidence_download", args=[obj.pk]),
        )

    def get_urls(self):
        return [
            path(
                "<uuid:pk>/download/", self.admin_site.admin_view(self.download), name="verification_evidence_download"
            ),
            *super().get_urls(),
        ]

    def download(self, request, pk):
        get_object_or_404(Evidence, pk=pk)
        try:
            item, stream = download_evidence(Actor(request, "owner"), pk)
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
