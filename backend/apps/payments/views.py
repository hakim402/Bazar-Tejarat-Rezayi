from drf_spectacular.utils import extend_schema, OpenApiTypes
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.response import Response
from django.shortcuts import get_object_or_404
from apps.orders.views import OrderView
from apps.messaging.views import query, throttle
from . import access, contracts as c, queries, services, media
from .models import Claim, Receipt


class Profiles(OrderView):
    @extend_schema(operation_id="payments_profiles", parameters=[c.Query], responses=OpenApiTypes.OBJECT)
    def get(self, request):
        actor = self.actor("seller")
        data = query(request, c.Query)
        rows = access.profiles(actor.account, summary=True).order_by("pk")
        writers = set(access.profiles(actor.account).values_list("pk", flat=True))
        return Response(
            {
                "count": rows.count(),
                "page": data["page"],
                "results": [
                    {
                        "id": str(x.pk),
                        "name": x.display_name,
                        "read": True,
                        "write": x.pk in writers,
                        "evidence": x.pk in writers,
                        "selection": x.pk in writers,
                    }
                    for x in rows[(data["page"] - 1) * 20 : data["page"] * 20]
                ],
            }
        )


class Orders(OrderView):
    @extend_schema(operation_id="payments_orders", parameters=[c.Query], responses=c.Page)
    def get(self, request, context):
        return Response(c.Page(queries.page(self.actor(context), **query(request, c.Query))).data)


class Detail(OrderView):
    @extend_schema(operation_id="payments_detail", parameters=[c.Query], responses=c.Detail)
    def get(self, request, context, pk):
        data = query(request, c.Query)
        return Response(
            c.Detail(queries.detail(self.actor(context), pk, page=data["page"], seller=data.get("seller"))).data
        )


class SubmitClaim(OrderView):
    @extend_schema(operation_id="payment_claim_submit", request=c.ClaimCommand, responses=c.Outcome)
    def post(self, request, pk):
        query(request)
        actor = self.actor("buyer")
        throttle(actor, "payment_claim", pk, limit=30)
        return Response(c.Outcome(services.mutate(actor, pk, "claim", self.data(c.ClaimCommand))).data, status=201)


class DirectReceipt(OrderView):
    @extend_schema(operation_id="payment_receipt_record", request=c.ReceiptCommand, responses=c.Outcome)
    def post(self, request, pk):
        query(request)
        actor = self.actor("seller")
        throttle(actor, "payment_receipt", pk, limit=30)
        return Response(c.Outcome(services.mutate(actor, pk, "receipt", self.data(c.ReceiptCommand))).data, status=201)


class ClaimAction(OrderView):
    @extend_schema(operation_id="payment_claim_decide", request=c.ConfirmCommand, responses=c.Outcome)
    def post(self, request, context, pk, action):
        query(request)
        actor = self.actor(context)
        throttle(actor, "payment_claim_decision", pk, limit=30)
        row = get_object_or_404(Claim.objects.filter(order__in=access.scope(actor, write=context == "seller")), pk=pk)
        data = self.data(c.ConfirmCommand if action == "confirm" else c.DecisionCommand)
        return Response(c.Outcome(services.mutate(actor, row.order_id, action, {**data, "claim": row.pk})).data)


class Correction(OrderView):
    @extend_schema(operation_id="payment_receipt_correction", request=c.CorrectionCommand, responses=c.Outcome)
    def post(self, request, pk):
        query(request)
        actor = self.actor("seller")
        throttle(actor, "payment_correction", pk, limit=30)
        row = get_object_or_404(Receipt.objects.filter(order__in=access.scope(actor, write=True)), pk=pk)
        return Response(
            c.Outcome(
                services.mutate(
                    actor, row.order_id, "correction", {**self.data(c.CorrectionCommand), "receipt": row.pk}
                )
            ).data,
            status=201,
        )


class Extension(OrderView):
    @extend_schema(operation_id="payment_deadline_extension", request=c.ExtensionCommand, responses=c.Outcome)
    def post(self, request, pk):
        query(request)
        actor = self.actor("seller")
        throttle(actor, "payment_extension", pk, limit=30)
        return Response(
            c.Outcome(services.mutate(actor, pk, "extension", self.data(c.ExtensionCommand))).data, status=201
        )


class StockPlan(OrderView):
    @extend_schema(operation_id="payment_stock_plan", request=c.PlanCommand, responses=c.Outcome)
    def post(self, request, pk):
        query(request)
        actor = self.actor("seller")
        throttle(actor, "payment_selection", pk, limit=30)
        return Response(c.Outcome(services.mutate(actor, pk, "plan", self.data(c.PlanCommand))).data, status=201)


class StockSelection(OrderView):
    @extend_schema(operation_id="payment_stock_selection", parameters=[c.Query], responses=OpenApiTypes.OBJECT)
    def get(self, request, pk):
        from .selection import selection

        data = query(request, c.Query)
        return Response(selection(self.actor("seller"), pk, page=data["page"]))


class Command(OrderView):
    @extend_schema(operation_id="payment_command_lookup", responses=c.Settled)
    def get(self, request, context, pk, key):
        query(request)
        return Response(c.Settled(services.reconcile(self.actor(context), pk, key)).data)


class Settle(OrderView):
    @extend_schema(operation_id="payment_command_settle", request=c.Empty, responses=c.Settled)
    def post(self, request, context, pk, key):
        query(request)
        self.data(c.Empty)
        actor = self.actor(context)
        throttle(actor, "payment_settle", pk, limit=30)
        return Response(c.Settled(services.reconcile(actor, pk, key, settle=True)).data)


class Upload(OrderView):
    parser_classes = [MultiPartParser, FormParser]

    @extend_schema(operation_id="payment_evidence_stage", request=c.UploadCommand, responses=c.Image)
    def post(self, request, context, pk):
        query(request)
        actor = self.actor(context)
        get_object_or_404(access.scope(actor, write=context == "seller"), pk=pk)
        throttle(actor, "payment_upload", pk, limit=20)
        data = self.data(c.UploadCommand)
        return Response(c.Image(media.upload(actor, pk, data["command_id"], data["file"])).data, status=201)


class Evidence(OrderView):
    @extend_schema(operation_id="payment_evidence_read", responses=OpenApiTypes.BINARY)
    def get(self, request, context, pk):
        query(request)
        return media.response(self.actor(context), pk, head=request.method == "HEAD")


class History(Detail):
    @extend_schema(operation_id="payments_history", parameters=[c.Query], responses=c.Detail)
    def get(self, request, context, pk):
        return super().get(request, context, pk)


class ConfirmClaim(ClaimAction):
    @extend_schema(operation_id="payment_claim_confirm", request=c.ConfirmCommand, responses=c.Outcome)
    def post(self, request, pk):
        return super().post(request, "seller", pk, "confirm")


class RejectClaim(ClaimAction):
    @extend_schema(operation_id="payment_claim_reject", request=c.DecisionCommand, responses=c.Outcome)
    def post(self, request, pk):
        return super().post(request, "seller", pk, "reject")


class WithdrawClaim(ClaimAction):
    @extend_schema(operation_id="payment_claim_withdraw", request=c.DecisionCommand, responses=c.Outcome)
    def post(self, request, pk):
        return super().post(request, "buyer", pk, "withdraw")
