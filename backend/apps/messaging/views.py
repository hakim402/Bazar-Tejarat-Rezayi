from drf_spectacular.utils import extend_schema, OpenApiTypes
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError
from apps.accounts.views import AuthView
from apps.accounts.services import rate_limit, TooManyRequests
from apps.organizations.access import Actor
from . import access, contracts as c, services, queries, media


def query(request, cls=None):
    if cls is None:
        if request.query_params:
            raise ValidationError({"query": ["unknown"]})
        return {}
    data = cls(data=request.query_params)
    data.is_valid(raise_exception=True)
    return data.validated_data


def throttle(actor, action, target="", *, limit=60):
    # Use the existing hashed actor/IP primitive; never log text or raw contacts.
    try:
        rate_limit(
            actor.request,
            "messaging_" + action,
            identity=str(actor.account.pk) + ":" + str(target),
            limit=limit,
            seconds=900,
        )
    except TooManyRequests as error:
        error.wait = 900
        raise


class PrivateView(AuthView):
    def actor(self, context):
        actor = Actor(self.request, context)
        actor.account
        if self.request.method in {"GET", "HEAD"}:
            throttle(actor, "query", self.request.path, limit=600)
        return actor

    def finalize_response(self, request, response, *args, **kwargs):
        result = super().finalize_response(request, response, *args, **kwargs)
        if result.status_code == 429:
            result["Retry-After"] = "900"
        return result


class Enquiries(PrivateView):
    @extend_schema(
        operation_id="messaging_create_enquiry",
        request=c.EnquiryCommand,
        responses={201: c.Sent, 409: c.ExistingConversation},
    )
    def post(self, request):
        actor = self.actor("buyer")
        query(request)
        throttle(actor, "enquiry", limit=20)
        try:
            result = services.create_enquiry(actor, self.data(c.EnquiryCommand))
        except services.ConversationExists as error:
            return Response(
                {"code": "conversation_exists", "conversation": str(error.detail["conversation"])}, status=409
            )
        return Response(c.Sent(result).data, status=201)


class Profiles(PrivateView):
    @extend_schema(operation_id="messaging_seller_profiles", parameters=[c.ListQuery], responses=c.MessagingProfiles)
    def get(self, request):
        actor = self.actor("seller")
        data = query(request, c.ListQuery)
        if data.get("seller") or data["unread"]:
            raise ValidationError({"query": ["unknown"]})
        return Response(c.MessagingProfiles(queries.profile_choices(actor, data["page"])).data)


class Conversations(PrivateView):
    @extend_schema(operation_id="messaging_conversations", parameters=[c.ListQuery], responses=c.ConversationPage)
    def get(self, request, context):
        actor = self.actor(context)
        data = query(request, c.ListQuery)
        return Response(c.ConversationPage(queries.inbox(actor, **data)).data)


class Conversation(PrivateView):
    @extend_schema(operation_id="messaging_conversation", responses=c.ConversationDetail)
    def get(self, request, context, pk):
        actor = self.actor(context)
        query(request)
        return Response(c.ConversationDetail(queries.detail(actor, pk)).data)


class Messages(PrivateView):
    @extend_schema(operation_id="messaging_history", parameters=[c.HistoryQuery], responses=c.MessagingHistory)
    def get(self, request, context, pk):
        actor = self.actor(context)
        data = query(request, c.HistoryQuery)
        return Response(c.MessagingHistory(queries.history(actor, pk, **data)).data)

    @extend_schema(operation_id="messaging_send", request=c.MessageCommand, responses={201: c.Sent})
    def post(self, request, context, pk):
        actor = self.actor(context)
        query(request)
        access.conversation(actor, pk)
        throttle(actor, "send", pk)
        return Response(c.Sent(services.send(actor, pk, self.data(c.MessageCommand))).data, status=201)


class Read(PrivateView):
    @extend_schema(operation_id="messaging_read", request=c.ReadCommand, responses=c.ReadResult)
    def post(self, request, context, pk):
        actor = self.actor(context)
        query(request)
        access.conversation(actor, pk)
        throttle(actor, "read", pk, limit=300)
        return Response(c.ReadResult(services.acknowledge(actor, pk, self.data(c.ReadCommand))).data)


class Upload(PrivateView):
    parser_classes = [MultiPartParser, FormParser]

    @extend_schema(operation_id="messaging_upload", request=c.UploadCommand, responses={201: c.ImageResult})
    def post(self, request, context, pk):
        actor = self.actor(context)
        query(request)
        access.conversation(actor, pk)
        throttle(actor, "upload", pk, limit=20)
        data = self.data(c.UploadCommand)
        return Response(c.ImageResult(media.upload(actor, pk, data["command_id"], data["file"])).data, status=201)


class EnquiryUpload(PrivateView):
    parser_classes = [MultiPartParser, FormParser]

    @extend_schema(operation_id="messaging_enquiry_upload", request=c.UploadCommand, responses={201: c.ImageResult})
    def post(self, request, pk):
        actor = self.actor("buyer")
        query(request)
        throttle(actor, "upload", pk, limit=20)
        data = self.data(c.UploadCommand)
        return Response(
            c.ImageResult(media.upload(actor, pk, data["command_id"], data["file"], enquiry=True)).data, status=201
        )


class Attachment(PrivateView):
    @extend_schema(operation_id="messaging_attachment", responses=OpenApiTypes.BINARY)
    def get(self, request, context, pk):
        actor = self.actor(context)
        query(request)
        return media.participant_response(actor, pk, head=request.method == "HEAD")


class Reports(PrivateView):
    @extend_schema(operation_id="messaging_reports", responses=c.ReportPage)
    def get(self, request, context, pk):
        actor = self.actor(context)
        query(request)
        return Response(c.ReportPage(queries.reports(actor, pk)).data)

    @extend_schema(operation_id="messaging_report", request=c.ReportCommand, responses={201: c.ReportResult})
    def post(self, request, context, pk):
        actor = self.actor(context)
        query(request)
        throttle(actor, "report", limit=10)
        return Response(c.ReportResult(services.report(actor, pk, self.data(c.ReportCommand))).data, status=201)
