from django.core.paginator import Paginator
from django.http import FileResponse
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from apps.accounts.models import Account
from apps.organizations.views import OrganizationView
from apps.organizations.models import OwnershipTransfer
from apps.organizations.presentation import transfer_data
from apps.organizations.contracts import TransferAction, TransferData, TransferQueue
from apps.organizations.transfers import transfer_action
from . import contracts as c
from .models import ReviewCase
from .presentation import case_data, queue_item
from .services import application_action, authorize_case, download_evidence, review_action, upload_evidence


def page_of(queryset, request):
    try:
        number = int(request.query_params.get("page", 1))
        if not 0 < number <= 100000:
            raise ValueError
    except ValueError:
        raise ValidationError({"page": ["Use a valid page number."]}) from None
    return Paginator(queryset, 20).get_page(number)


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


class QueueView(OrganizationView):
    @extend_schema(operation_id="QueueView_get", responses=c.QueueResult)
    def get(self, request):
        actor = self.actor("staff")
        account = actor.staff("view_queue")
        cases = (
            ReviewCase.objects.select_related("profile")
            .exclude(status="draft")
            .exclude(profile__account__user=actor.user)
            .exclude(profile__memberships__account__user=actor.user)
        )
        status = request.query_params.get("status", "")
        if status:
            cases = cases.filter(status=status)
        page = page_of(cases.distinct().order_by("-created_at"), request)
        reviewers = []
        permissions = list(
            account.permission_groups.filter(permissions__content_type__app_label="verification")
            .values_list("permissions__codename", flat=True)
            .distinct()
        )
        if "assign_review" in permissions:
            reviewers = [
                {"id": a.pk, "name": a.user.display_name}
                for a in Account.objects.select_related("user")
                .filter(
                    context="staff",
                    status="active",
                    user__is_active=True,
                    user__email_verified=True,
                    permission_groups__permissions__content_type__app_label="verification",
                    permission_groups__permissions__codename="decide_review",
                )
                .distinct()
            ]
        return Response(
            {
                "current_account_id": account.pk,
                "results": [queue_item(case) for case in page],
                "count": page.paginator.count,
                "page": page.number,
                "reviewers": reviewers,
                "permissions": permissions,
            }
        )


class CaseView(OrganizationView):
    @extend_schema(operation_id="CaseView_get", responses=c.CaseData)
    def get(self, request, pk):
        actor = self.actor("staff")
        case = get_object_or_404(ReviewCase.objects.select_related("profile__account"), pk=pk)
        authorize_case(actor, case)
        return Response(case_data(case, staff=True))

    @extend_schema(operation_id="CaseView_post", request=c.ReviewAction, responses=c.CaseOperation)
    def post(self, request, pk):
        actor = self.actor("staff")
        case = review_action(actor, pk, self.data(c.ReviewAction))
        return Response(c.CaseOperation(case).data)


class TransferQueueView(OrganizationView):
    @extend_schema(operation_id="TransferQueueView_get", responses=TransferQueue)
    def get(self, request):
        actor = self.actor("staff")
        actor.staff("review_transfer")
        query = (
            OwnershipTransfer.objects.select_related("company", "recipient__account__user")
            .exclude(company__account__user=actor.user)
            .exclude(company__memberships__account__user=actor.user)
        )
        if request.query_params.get("status"):
            query = query.filter(status=request.query_params["status"])
        page = page_of(query.distinct().order_by("-created_at"), request)
        return Response(
            {"results": [transfer_data(t) for t in page], "count": page.paginator.count, "page": page.number}
        )


class TransferReviewView(OrganizationView):
    @extend_schema(operation_id="TransferReviewView_get", responses=TransferData)
    def get(self, request, pk):
        from apps.organizations.access import independent

        actor = self.actor("staff")
        actor.staff("review_transfer")
        item = get_object_or_404(
            OwnershipTransfer.objects.select_related("company__account", "recipient__account__user"), pk=pk
        )
        independent(item.company, actor)
        return Response(transfer_data(item, private=True))

    @extend_schema(operation_id="TransferReviewView_post", request=TransferAction, responses=TransferData)
    def post(self, request, pk):
        actor = self.actor("staff")
        data = self.data(TransferAction)
        if data["action"] not in {"approve", "reject"}:
            raise PermissionDenied()
        return Response(transfer_data(transfer_action(actor, pk, data), private=True))
