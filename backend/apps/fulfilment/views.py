"""Private buyer/seller transport only. Staff mutations remain native admin."""

from django.db import transaction
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from rest_framework import serializers as s
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.response import Response
from rest_framework.exceptions import PermissionDenied
from drf_spectacular.utils import extend_schema, OpenApiTypes
from apps.orders.views import OrderView, ProtectedDocumentView
from apps.messaging.views import query, throttle
from apps.payments.models import Finance
from . import access, models as m, contracts as c, queries, services, media, selection, documents, validation as v


class Profiles(OrderView):
    @extend_schema(operation_id="fulfilment_profiles", parameters=[c.Query], responses=OpenApiTypes.OBJECT)
    def get(self, request):
        actor = self.actor("seller")
        data = query(request, c.Query)
        qs = access.profiles(actor.account).order_by("pk")
        if data.get("seller"):
            qs = qs.filter(pk=data["seller"])
        return Response(
            {
                "count": qs.count(),
                "page": data["page"],
                "results": [
                    {"id": str(p.pk), "name": p.display_name} for p in qs[(data["page"] - 1) * 20 : data["page"] * 20]
                ],
            }
        )


class Orders(OrderView):
    @extend_schema(operation_id="fulfilment_orders", parameters=[c.Query], responses=c.Page)
    def get(self, request, context):
        return Response(c.Page(queries.page(self.actor(context), **query(request, c.Query))).data)


class Detail(OrderView):
    @extend_schema(operation_id="fulfilment_detail", parameters=[c.Query], responses=c.Detail)
    def get(self, request, context, pk):
        data = query(request, c.Query)
        return Response(
            c.Detail(queries.detail(self.actor(context), pk, seller=data.get("seller"), page=data["page"])).data
        )


class History(Detail):
    @extend_schema(operation_id="fulfilment_history", parameters=[c.Query], responses=c.Detail)
    def get(self, request, context, pk):
        return super().get(request, context, pk)


class Transition(OrderView):
    action = ""
    serializer = c.Reason

    def post(self, request, context, pk):
        query(request)
        actor = self.actor(context)
        throttle(actor, "fulfilment_" + self.action, pk, limit=30)
        data = self.data(self.serializer)
        result = services.mutate(actor, pk, self.action, data)
        return Response(c.Outcome({"result": result, "current": queries.detail(actor, pk)}).data, status=201)


# Distinct concrete operation IDs retain typed input shapes without a public staff-action endpoint.


class Recipient(Transition):
    action = "recipient"
    serializer = c.RecipientCommand

    @extend_schema(operation_id="fulfilment_recipient", request=c.RecipientCommand, responses=c.Outcome)
    def post(self, request, context, pk):
        return super().post(request, context, pk)


class Arrangement(Transition):
    action = "arrange"
    serializer = c.ArrangementCommand

    @extend_schema(operation_id="fulfilment_arrange", request=c.ArrangementCommand, responses=c.Outcome)
    def post(self, request, context, pk):
        return super().post(request, context, pk)


class Prepare(Transition):
    action = "prepare"
    serializer = c.PrepareCommand

    @extend_schema(operation_id="fulfilment_prepare", request=c.PrepareCommand, responses=c.Outcome)
    def post(self, request, context, pk):
        return super().post(request, context, pk)


class Partial(Transition):
    action = "partial"
    serializer = c.Reason

    @extend_schema(operation_id="fulfilment_partial", request=c.Reason, responses=c.Outcome)
    def post(self, request, context, pk):
        return super().post(request, context, pk)


class Charge(Transition):
    action = "charge"
    serializer = c.ChargeCommand

    @extend_schema(operation_id="fulfilment_charge", request=c.ChargeCommand, responses=c.Outcome)
    def post(self, request, context, pk):
        return super().post(request, context, pk)


class Claim(Transition):
    action = "claim"
    serializer = c.ClaimCommand

    @extend_schema(operation_id="fulfilment_claim", request=c.ClaimCommand, responses=c.Outcome)
    def post(self, request, context, pk):
        return super().post(request, context, pk)


class Withdraw(Transition):
    action = "withdraw"
    serializer = c.WithdrawCommand

    @extend_schema(operation_id="fulfilment_withdraw", request=c.WithdrawCommand, responses=c.Outcome)
    def post(self, request, context, pk):
        return super().post(request, context, pk)


class DeliveryRefund(Transition):
    action = "refund"
    serializer = c.RefundCommand

    @extend_schema(operation_id="fulfilment_delivery_refund", request=c.RefundCommand, responses=c.Outcome)
    def post(self, request, context, pk):
        return super().post(request, context, pk)


class Correction(Transition):
    action = "correction"
    serializer = c.CorrectionCommand

    @extend_schema(operation_id="fulfilment_correction", request=c.CorrectionCommand, responses=c.Outcome)
    def post(self, request, context, pk):
        return super().post(request, context, pk)


class Dispatch(Transition):
    action = "dispatch"
    serializer = c.DispatchCommand

    @extend_schema(operation_id="fulfilment_dispatch", request=c.DispatchCommand, responses=c.Outcome)
    def post(self, request, context, pk):
        return super().post(request, context, pk)


class Tracking(Transition):
    action = "tracking"
    serializer = c.TrackingCommand

    @extend_schema(operation_id="fulfilment_tracking", request=c.TrackingCommand, responses=c.Outcome)
    def post(self, request, context, pk):
        return super().post(request, context, pk)


class Deliver(Transition):
    action = "deliver"
    serializer = c.DeliveryCommand

    @extend_schema(operation_id="fulfilment_deliver", request=c.DeliveryCommand, responses=c.Outcome)
    def post(self, request, context, pk):
        return super().post(request, context, pk)


class Preview(OrderView):
    @extend_schema(
        operation_id="fulfilment_dispatch_preview", request=c.DispatchReviewCommand, responses=c.DispatchPreview
    )
    @transaction.atomic
    def post(self, request, context, pk):
        query(request)
        actor = self.actor(context)
        throttle(actor, "fulfilment_preview", pk, limit=60)
        data = self.data(c.DispatchReviewCommand)
        order = access.lock_order(actor, pk)
        services.allowed(actor, order, "dispatch")
        state = get_object_or_404(m.State, order=order)
        finance = get_object_or_404(Finance, order=order)
        v.expect(state.version, data["version"])
        v.expect(finance.version, data["goods_version"])
        from .transitions import packet

        body, preparation, charge, permission = packet(actor, order, state, data)
        body["command_id"] = str(data["command_id"])
        private = None
        if access.capabilities(actor, order)["recipient"]:
            access.audit(
                actor,
                preparation.recipient,
                "fulfilment_preview_recipient",
                "Review current sealed recipient before dispatch",
            )
            x = preparation.recipient
            private = {"name": x.name, "phone": x.phone, "address": x.address, "instructions": x.instructions}
        return Response(c.DispatchPreview({"packet": body, "recipient": private}).data)


class StockOptions(OrderView):
    @extend_schema(operation_id="fulfilment_stock_options", parameters=[c.Query], responses=OpenApiTypes.OBJECT)
    def get(self, request, context, pk):
        actor = self.actor(context)
        data = query(request, c.Query)
        order = get_object_or_404(access.scope(actor, seller=data.get("seller")), pk=pk)
        if not access.capabilities(actor, order)["prepare"]:
            raise PermissionDenied()
        return Response(selection.options(order, page=data["page"], q=data["q"]))


class Command(OrderView):
    @extend_schema(operation_id="fulfilment_command_lookup", responses=c.Recovery)
    def get(self, request, context, pk, key):
        query(request)
        return Response(c.Recovery(services.lookup(self.actor(context), pk, key)).data)


class Reconcile(OrderView):
    @extend_schema(operation_id="fulfilment_command_reconcile", request=OpenApiTypes.OBJECT, responses=c.Recovery)
    def post(self, request, context, pk, key):
        query(request)
        actor = self.actor(context)
        throttle(actor, "fulfilment_reconcile", pk, limit=60)
        from apps.messaging.contracts import Strict

        self.data(Strict)
        return Response(c.Recovery(services.lookup(actor, pk, key, fence=True)).data)


class Upload(OrderView):
    parser_classes = [MultiPartParser, FormParser]

    @extend_schema(
        operation_id="fulfilment_evidence_upload", request=OpenApiTypes.BINARY, responses=OpenApiTypes.OBJECT
    )
    def post(self, request, context, pk):
        query(request)
        actor = self.actor(context)
        throttle(actor, "fulfilment_upload", pk, limit=20)
        if set(request.data) != {"command_id", "purpose", "file"} or any(
            len(request.data.getlist(k)) != 1 for k in request.data
        ):
            raise s.ValidationError({"upload": ["one_file_and_command"]})
        return Response(
            media.upload(
                actor, pk, v.identifier(request.data["command_id"]), request.data["purpose"], request.data["file"]
            ),
            status=201,
        )


class Evidence(ProtectedDocumentView):
    @extend_schema(operation_id="fulfilment_evidence_bytes", responses=OpenApiTypes.BINARY)
    def get(self, request, context, pk):
        query(request)
        return media.response(self.actor(context), pk)

    def head(self, request, context, pk):
        query(request)
        return media.response(self.actor(context), pk, head=True)


class LineImage(ProtectedDocumentView):
    @extend_schema(operation_id="fulfilment_line_image", responses={(200, "image/jpeg"): bytes})
    def get(self, request, context, pk, line_id):
        from apps.catalogue.views import image_response

        return image_response(queries.line_image(self.actor(context), pk, line_id), request)


class Handover(ProtectedDocumentView):
    @extend_schema(operation_id="fulfilment_handover", parameters=[c.HandoverQuery], responses=OpenApiTypes.BINARY)
    def get(self, request, context, pk):
        data = query(request, c.HandoverQuery)
        snapshot = documents.snapshot(self.actor(context), pk, data["locale"])
        raw = (
            documents.pdf_bytes(snapshot, data["locale"])
            if data["format"] == "pdf"
            else documents.html_bytes(snapshot, data["locale"])
        )
        response = HttpResponse(
            raw, content_type="application/pdf" if data["format"] == "pdf" else "text/html; charset=utf-8"
        )
        response["Cache-Control"] = "private, no-store"
        response["X-Robots-Tag"] = "noindex, nofollow"
        response["Referrer-Policy"] = "no-referrer"
        response["X-Content-Type-Options"] = "nosniff"
        response["Content-Security-Policy"] = documents.HANDOVER_CSP
        response["Content-Disposition"] = 'inline; filename="recipient-handover.' + data["format"] + '"'
        return response

    def head(self, request, context, pk):
        response = self.get(request, context, pk)
        response["Content-Length"] = str(len(response.content))
        response.content = b""
        return response
