from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema, OpenApiTypes
from rest_framework.response import Response
from apps.messaging.views import query, throttle
from .views import OrderView
from . import negotiations as n, negotiation_contracts as c
from .models import NegotiationSubmission


class NegotiationView(OrderView):
    def handle_exception(self, exc):
        from .services import SellerFailure
        from rest_framework.exceptions import ValidationError

        if isinstance(exc, SellerFailure):
            exc = ValidationError({"selection": [exc.code]})
        return super().handle_exception(exc)


class Submissions(NegotiationView):
    @extend_schema(operation_id="negotiation_submit", request=c.SubmissionCommand, responses=c.SubmissionResult)
    def post(self, request):
        actor = self.actor("buyer")
        query(request)
        throttle(actor, "negotiation_submit", limit=20)
        result = n.submit(actor, self.data(c.SubmissionCommand))
        return Response(c.SubmissionResult(result).data, status=202 if result["pending"] else 201)


class Preview(NegotiationView):
    @extend_schema(operation_id="negotiation_preview", request=c.SubmissionCommand, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        actor = self.actor("buyer")
        query(request)
        throttle(actor, "negotiation_preview", limit=30)
        return Response(n.preview_submission(actor, self.data(c.SubmissionCommand)))


class SubmissionDetail(NegotiationView):
    @extend_schema(operation_id="negotiation_submission", responses=c.SubmissionResult)
    def get(self, request, pk):
        query(request)
        row = get_object_or_404(NegotiationSubmission, buyer=self.actor("buyer").account, pk=pk)
        return Response(c.SubmissionResult(n.submission_data(row)).data)


class SubmissionByCommand(NegotiationView):
    @extend_schema(operation_id="negotiation_submission_by_command", responses=c.SubmissionResult)
    def get(self, request, pk):
        query(request)
        row = get_object_or_404(NegotiationSubmission, buyer=self.actor("buyer").account, key=pk)
        return Response(c.SubmissionResult(n.submission_data(row)).data)


class Resume(NegotiationView):
    @extend_schema(operation_id="negotiation_resume", request=OpenApiTypes.OBJECT, responses=c.SubmissionResult)
    def post(self, request, pk):
        from .contracts import EmptyCommand

        query(request)
        self.data(EmptyCommand)
        actor = self.actor("buyer")
        throttle(actor, "negotiation_resume", pk, limit=20)
        return Response(c.SubmissionResult(n.resume(actor, pk)).data)


class Requests(NegotiationView):
    @extend_schema(operation_id="negotiations_list", parameters=[c.RequestQuery], responses=c.RequestPage)
    def get(self, request, context):
        return Response(c.RequestPage(n.page(self.actor(context), query(request, c.RequestQuery))).data)


class Detail(NegotiationView):
    @extend_schema(operation_id="negotiations_detail", parameters=[c.RequestQuery], responses=c.RequestResult)
    def get(self, request, context, pk):
        data = query(request, c.RequestQuery)
        return Response(
            c.RequestResult(n.detail(self.actor(context), pk, data.get("seller"), data["history_page"])).data
        )


class Action(NegotiationView):
    command = c.ActionCommand

    @extend_schema(operation_id="negotiation_action", request=c.ActionCommand, responses=OpenApiTypes.OBJECT)
    def post(self, request, context, pk, action):
        actor = self.actor(context)
        query(request)
        throttle(actor, "negotiation_action", pk, limit=30)
        return Response(n.transition(actor, pk, action, self.data(self.command)))


class Resubmit(Action):
    command = c.ResubmitCommand

    @extend_schema(operation_id="negotiation_resubmit", request=c.ResubmitCommand, responses=OpenApiTypes.OBJECT)
    def post(self, request, pk):
        return super().post(request, "buyer", pk, "resubmit")


class Finalize(Action):
    command = c.FinalizeCommand

    @extend_schema(operation_id="negotiation_finalize", request=c.FinalizeCommand, responses=OpenApiTypes.OBJECT)
    def post(self, request, pk):
        return super().post(request, "seller", pk, "finalize")


class FinalPreview(NegotiationView):
    @extend_schema(operation_id="negotiation_final_preview", request=c.FinalizeCommand, responses=OpenApiTypes.OBJECT)
    def post(self, request, pk):
        actor = self.actor("seller")
        query(request)
        throttle(actor, "negotiation_final_preview", pk, limit=30)
        return Response(n.transition(actor, pk, "finalize", self.data(c.FinalizeCommand), preview=True))


class Reconcile(NegotiationView):
    @extend_schema(operation_id="negotiation_command", responses=OpenApiTypes.OBJECT)
    def get(self, request, context, pk, key):
        query(request)
        return Response(n.reconcile(self.actor(context), pk, key))


class SettleCommand(NegotiationView):
    @extend_schema(
        operation_id="negotiation_command_settle", request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT
    )
    def post(self, request, context, pk, key):
        from .contracts import EmptyCommand

        query(request)
        self.data(EmptyCommand)
        actor = self.actor(context)
        throttle(actor, "negotiation_reconcile", pk, limit=30)
        return Response(n.settle_command(actor, pk, key))


class SettleSubmission(NegotiationView):
    @extend_schema(
        operation_id="negotiation_submission_settle", request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT
    )
    def post(self, request, pk):
        from .contracts import EmptyCommand

        query(request)
        self.data(EmptyCommand)
        actor = self.actor("buyer")
        throttle(actor, "negotiation_submission_reconcile", limit=30)
        return Response(n.settle_submission(actor, pk))


class Withdraw(Action):
    @extend_schema(operation_id="negotiation_withdraw", request=c.ActionCommand, responses=OpenApiTypes.OBJECT)
    def post(self, request, pk):
        return super().post(request, "buyer", pk, "withdraw")


class Reject(Action):
    @extend_schema(operation_id="negotiation_reject", request=c.ActionCommand, responses=OpenApiTypes.OBJECT)
    def post(self, request, pk):
        return super().post(request, "seller", pk, "reject")


class Correction(Action):
    @extend_schema(
        operation_id="negotiation_request_correction", request=c.ActionCommand, responses=OpenApiTypes.OBJECT
    )
    def post(self, request, pk):
        return super().post(request, "seller", pk, "request-correction")
