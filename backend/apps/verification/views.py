from django.http import FileResponse
from drf_spectacular.utils import extend_schema
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from apps.organizations.views import OrganizationView
from . import contracts as c
from .presentation import case_data
from .services import application_action, authorize_case, download_evidence, upload_evidence



class ApplicationView(OrganizationView):
    @extend_schema(operation_id="ApplicationView_get", responses=c.ApplicationData)
    def get(self, request, context, pk):
        actor = self.actor(context)
        profile = self.profile(actor, pk)
        cases = profile.cases.select_related("profile__account").order_by("-revision")
        authorize_case(actor, cases[0])
        return Response({"current": case_data(cases[0]), "revisions": [case_data(case) for case in cases]})

    @extend_schema(operation_id="ApplicationView_post", request=c.ApplicationAction, responses=c.CaseData)
    def post(self, request, context, pk):
        actor = self.actor(context)
        self.profile(actor, pk)
        return Response(case_data(application_action(actor, pk, self.data(c.ApplicationAction))))


class EvidenceView(OrganizationView):
    parser_classes = [MultiPartParser, FormParser]

    @extend_schema(operation_id="EvidenceView_post", request=c.EvidenceUpload, responses=c.EvidenceData)
    def post(self, request, context, pk):
        actor = self.actor(context)
        self.profile(actor, pk)
        if int(request.META.get("CONTENT_LENGTH") or 0) > 11 * 1024 * 1024:
            raise ValidationError({"file": ["Request exceeds the evidence upload limit."]})
        data = self.data(c.EvidenceUpload)
        item = upload_evidence(actor, pk, data["file"], data["category"], data["version"], data.get("replace_id"))
        return Response(c.EvidenceData(item).data, status=201)


class EvidenceDownloadView(OrganizationView):
    @extend_schema(operation_id="EvidenceDownloadView_get", responses={(200, "application/octet-stream"): bytes})
    def get(self, request, context, pk):
        actor = self.actor(context)
        item, stream = download_evidence(actor, pk)
        extension = {"application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png"}[item.content_type]
        response = FileResponse(
            stream, as_attachment=True, filename=f"evidence.{extension}", content_type="application/octet-stream"
        )
        response["Cache-Control"] = "private, no-store"
        response["X-Content-Type-Options"] = "nosniff"
        response["Content-Security-Policy"] = "sandbox; default-src 'none'"
        return response
