from django.shortcuts import get_object_or_404
from django.http import HttpResponse
from rest_framework.response import Response
from rest_framework.exceptions import PermissionDenied, ValidationError
from drf_spectacular.utils import extend_schema, OpenApiTypes
from apps.messaging.views import PrivateView, query, throttle
from apps.cart.contracts import BoundedJSONParser
from apps.organizations.models import BusinessProfile
from . import services, queries, contracts as c, access
from .models import CheckoutSubmission


class OrderView(PrivateView):
    parser_classes = [BoundedJSONParser]

    def handle_exception(self, exc):
        from django.db import DatabaseError
        from apps.catalogue.media import StorageUnavailable

        if isinstance(exc, (DatabaseError, OSError)):
            exc = StorageUnavailable()
        return super().handle_exception(exc)


class Terms(OrderView):
    @extend_schema(operation_id="orders_terms", parameters=[c.TermsQuery], responses=c.TermsResult)
    def get(self, request, pk):
        actor = self.actor(query(request, c.TermsQuery)["context"])
        if actor.context == "seller":
            get_object_or_404(access.profiles(actor.account), pk=pk)
        # Buyer may read only currently public seller terms, never private contacts.
        else:
            get_object_or_404(
                __import__("apps.marketplace.access", fromlist=["eligible_profiles"]).eligible_profiles([pk]), pk=pk
            )
        return Response(c.TermsResult(services.terms(get_object_or_404(BusinessProfile, pk=pk))).data)

    @extend_schema(operation_id="orders_terms_save", request=c.TermsCommand, responses=c.TermsResult)
    def put(self, request, pk):
        actor = self.actor("seller")
        query(request)
        throttle(actor, "checkout_terms", pk, limit=30)
        return Response(c.TermsResult(services.set_terms(actor, pk, self.data(c.TermsCommand))).data)


class Profiles(OrderView):
    @extend_schema(operation_id="orders_profiles", responses=c.OrderProfiles)
    def get(self, request):
        actor = self.actor("seller")
        query(request)
        account = actor.account
        rows = list(access.profiles(account, invoices=True).order_by("pk")[:100])
        orders = set(access.profiles(account).values_list("pk", flat=True))
        return Response(
            c.OrderProfiles(
                {
                    "results": [
                        {
                            "id": str(p.pk),
                            "name": p.display_name,
                            "orders": p.pk in orders,
                            "invoices": True,
                            "terms": access.owned(p, account),
                        }
                        for p in rows
                    ]
                }
            ).data
        )


class Review(OrderView):
    @extend_schema(operation_id="orders_review", request=c.CheckoutCommand, responses=c.ReviewResult)
    def post(self, request):
        actor = self.actor("buyer")
        query(request)
        throttle(actor, "checkout_review", limit=30)
        return Response(c.ReviewResult(services.review(actor, self.data(c.CheckoutCommand))).data)


class Checkouts(OrderView):
    @extend_schema(
        operation_id="orders_checkout", request=c.CheckoutCommand, responses={201: c.Submission, 202: c.Submission}
    )
    def post(self, request):
        actor = self.actor("buyer")
        query(request)
        throttle(actor, "checkout", limit=20)
        result = services.submit(actor, self.data(c.CheckoutCommand))
        return Response(c.Submission(result).data, status=202 if result["pending"] else 201)

    @extend_schema(operation_id="orders_submissions", parameters=[c.Query], responses=c.SubmissionPage)
    def get(self, request):
        actor = self.actor("buyer")
        data = query(request, c.Query)
        if data.get("seller"):
            raise PermissionDenied()
        rows = (
            CheckoutSubmission.objects.filter(buyer=actor.account)
            .prefetch_related("outcomes__order__invoice", "outcomes__order__lines")
            .order_by("-created_at", "pk")
        )
        page = data["page"]
        return Response(
            c.SubmissionPage(
                {
                    "count": rows.count(),
                    "page": page,
                    "results": [queries.submission_row(x) for x in rows[(page - 1) * 20 : page * 20]],
                }
            ).data
        )


class CheckoutDetail(OrderView):
    @extend_schema(operation_id="orders_submission", parameters=[c.DocumentQuery], responses=c.Submission)
    def get(self, request, pk):
        query(request, c.DocumentQuery)
        return Response(c.Submission(queries.submission_data(self.actor("buyer"), pk)).data)


class Orders(OrderView):
    @extend_schema(operation_id="orders_list", parameters=[c.Query], responses=c.OrderPage)
    def get(self, request, context, invoices=False):
        actor = self.actor(context)
        data = query(request, c.Query)
        return Response(
            c.OrderPage(
                queries.order_page(
                    actor,
                    seller=data.get("seller"),
                    page=data["page"],
                    invoices=invoices,
                    q=data["q"],
                    state=data["state"],
                )
            ).data
        )


class OrderDetail(OrderView):
    @extend_schema(operation_id="orders_detail", parameters=[c.DocumentQuery], responses=c.OrderRow)
    def get(self, request, context, pk):
        actor = self.actor(context)
        query(request, c.DocumentQuery)
        row = get_object_or_404(queries.order_queryset(actor), pk=pk)
        return Response(c.OrderRow(queries.order_data(row, seller_list=actor.context == "seller")).data)


class InvoiceDetail(OrderView):
    @extend_schema(operation_id="orders_invoice", parameters=[c.Query], responses=c.OrderRow)
    def get(self, request, context, pk):
        actor = self.actor(context)
        data = query(request, c.Query)
        if data["page"] != 1 or data.get("seller"):
            raise PermissionDenied()
        return Response(c.OrderRow(queries.order_data(queries.document(actor, pk).order)).data)


class ProtectedDocumentView(OrderView):
    def perform_content_negotiation(self, request, force=False):
        # Binary/HTML success is an explicit HttpResponse; DRF error envelopes
        # always stay JSON even when the caller requests a document MIME type.
        from rest_framework.renderers import JSONRenderer

        renderer = JSONRenderer()
        return renderer, renderer.media_type


class PDF(ProtectedDocumentView):
    @extend_schema(operation_id="orders_invoice_pdf", parameters=[c.Query], responses=OpenApiTypes.BINARY)
    def get(self, request, context, pk):
        actor = self.actor(context)
        data = query(request, c.Query)
        if data["page"] != 1 or data.get("seller"):
            raise PermissionDenied()
        throttle(actor, "invoice_pdf", pk, limit=30)
        invoice = queries.document(actor, pk, action="invoice_pdf")
        from .documents import pdf_bytes

        response = HttpResponse(pdf_bytes(invoice, data["locale"]), content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="invoice-{invoice.number}.pdf"'
        response["X-Content-Type-Options"] = "nosniff"
        return response


class Resume(OrderView):
    @extend_schema(operation_id="orders_resume", request=c.EmptyCommand, responses=c.Submission)
    def post(self, request, pk):
        actor = self.actor("buyer")
        query(request)
        self.data(c.EmptyCommand)
        throttle(actor, "checkout_resume", pk, limit=20)
        row = get_object_or_404(CheckoutSubmission, buyer=actor.account, pk=pk)
        data = {**row.payload, "command_id": row.key}
        # Revalidate the original server-owned packet, including UUID types.
        parsed = c.CheckoutCommand(data=data)
        parsed.is_valid(raise_exception=True)
        result = services.submit(actor, parsed.validated_data)
        return Response(c.Submission(result).data, status=202 if result["pending"] else 200)


class Print(ProtectedDocumentView):
    @extend_schema(operation_id="orders_invoice_print", parameters=[c.Query], responses={200: OpenApiTypes.STR})
    def get(self, request, context, pk):
        actor = self.actor(context)
        data = query(request, c.Query)
        if data["page"] != 1 or data.get("seller"):
            raise PermissionDenied()
        throttle(actor, "invoice_print", pk, limit=30)
        invoice = queries.document(actor, pk, action="invoice_print")
        from .documents import html_document

        response = HttpResponse(html_document(invoice, data["locale"]), content_type="text/html; charset=utf-8")
        response["X-Content-Type-Options"] = "nosniff"
        response["Content-Security-Policy"] = (
            "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'"
        )
        return response


class Invoices(Orders):
    @extend_schema(operation_id="orders_invoices", parameters=[c.Query], responses=c.OrderPage)
    def get(self, request, context):
        return super().get(request, context, invoices=True)


class ByCommand(OrderView):
    @extend_schema(operation_id="orders_by_command", responses=c.Submission)
    def get(self, request, pk):
        actor = self.actor("buyer")
        query(request)
        row = get_object_or_404(CheckoutSubmission, buyer=actor.account, key=pk)
        return Response(c.Submission(queries.submission_data(actor, row.pk)).data)


class AftercareList(OrderView):
    @extend_schema(operation_id="aftercare_orders", parameters=[c.Query], responses=c.AftercarePage)
    def get(self, request, context):
        actor = self.actor(context)
        data = query(request, c.Query)
        if data.get("seller") and actor.context != "seller":
            raise PermissionDenied()
        from . import aftercare_queries

        return Response(c.AftercarePage(aftercare_queries.aftercare_page(actor, page=data["page"], seller=data.get("seller"), q=data["q"])).data)


class AftercareDetail(OrderView):
    @extend_schema(operation_id="aftercare_order_detail", parameters=[c.DocumentQuery], responses=c.AftercareDetail)
    def get(self, request, context, pk):
        actor = self.actor(context)
        query(request, c.DocumentQuery)
        from . import aftercare_queries

        return Response(c.AftercareDetail(aftercare_queries.aftercare_detail(actor, pk)).data)


class CancellationList(OrderView):
    @extend_schema(operation_id="aftercare_cancellations", parameters=[c.Query], responses=c.AftercarePage)
    def get(self, request, context):
        actor = self.actor(context)
        data = query(request, c.Query)
        if data.get("seller") and actor.context != "seller":
            raise PermissionDenied()
        from . import aftercare_queries

        return Response(c.AftercarePage(aftercare_queries.cancellation_page(actor, page=data["page"], seller=data.get("seller"))).data)


class CancellationDetail(OrderView):
    @extend_schema(operation_id="aftercare_cancellation_detail", parameters=[c.DocumentQuery], responses=c.CancellationDetail)
    def get(self, request, context, pk):
        actor = self.actor(context)
        query(request, c.DocumentQuery)
        from . import aftercare_queries

        return Response(aftercare_queries.cancellation_detail(actor, pk))


class SubmitCancellation(OrderView):
    @extend_schema(operation_id="aftercare_cancellation_request", request=c.CancellationCommand, responses=c.AftercareOutcome)
    def post(self, request, context, pk):
        query(request)
        actor = self.actor(context)
        throttle(actor, "cancellation_request", pk, limit=20)
        from . import aftercare_queries, cancellations

        outcome = cancellations.mutate(actor, pk, "request", self.data(c.CancellationCommand))
        return Response(
            c.AftercareOutcome({"outcome": outcome, "current": aftercare_queries.aftercare_detail(actor, pk)}).data,
            status=201,
        )


class WithdrawCancellation(OrderView):
    @extend_schema(operation_id="aftercare_cancellation_withdraw", request=c.CancellationWithdrawCommand, responses=c.AftercareOutcome)
    def post(self, request, context, pk):
        query(request)
        actor = self.actor(context)
        throttle(actor, "cancellation_withdraw", pk, limit=20)
        from . import aftercare_queries, cancellations
        from .models import CancellationRequest

        base = (
            CancellationRequest.objects.filter(order__buyer=actor.account)
            if actor.context == "buyer"
            else CancellationRequest.objects.filter(order__in=cancellations.requesters(actor))
        )
        row = get_object_or_404(base, pk=pk)
        data = self.data(c.CancellationWithdrawCommand)
        if data["request"] != row.pk:
            raise ValidationError({"request": ["The packet must match the requested resource."]})
        outcome = cancellations.mutate(actor, row.order_id, "withdraw", data)
        return Response(
            c.AftercareOutcome(
                {"outcome": outcome, "current": aftercare_queries.aftercare_detail(actor, row.order_id)}
            ).data
        )


class ProposeAmendment(OrderView):
    @extend_schema(operation_id="aftercare_amendment_propose", request=c.AmendmentCommand, responses=c.AftercareOutcome)
    def post(self, request, pk):
        query(request)
        actor = self.actor("seller")
        throttle(actor, "amendment_propose", pk, limit=20)
        from . import aftercare_queries, amendments

        outcome = amendments.mutate(actor, pk, "propose", self.data(c.AmendmentCommand))
        return Response(
            c.AftercareOutcome({"outcome": outcome, "current": aftercare_queries.aftercare_detail(actor, pk)}).data,
            status=201,
        )


class WithdrawAmendment(OrderView):
    @extend_schema(operation_id="aftercare_amendment_withdraw", request=c.AmendmentWithdrawCommand, responses=c.AftercareOutcome)
    def post(self, request, pk):
        query(request)
        actor = self.actor("seller")
        throttle(actor, "amendment_withdraw", pk, limit=20)
        from . import aftercare_queries, amendments
        from .models import Amendment

        row = get_object_or_404(Amendment.objects.filter(order__in=amendments.proposers(actor)), pk=pk)
        data = self.data(c.AmendmentWithdrawCommand)
        if data["amendment"] != row.pk:
            raise ValidationError({"amendment": ["The packet must match the requested resource."]})
        outcome = amendments.mutate(actor, row.order_id, "withdraw", data)
        return Response(
            c.AftercareOutcome(
                {"outcome": outcome, "current": aftercare_queries.aftercare_detail(actor, row.order_id)}
            ).data
        )


class AftercareCommand(OrderView):
    @extend_schema(operation_id="aftercare_command_lookup", responses=c.Settled)
    def get(self, request, context, pk, key):
        query(request)
        actor = self.actor(context)
        from . import cancellations

        return Response(c.Settled(cancellations.reconcile(actor, pk, key)).data)


class AftercareSettle(OrderView):
    @extend_schema(operation_id="aftercare_command_settle", request=c.EmptyCommand, responses=c.Settled)
    def post(self, request, context, pk, key):
        query(request)
        self.data(c.EmptyCommand)
        actor = self.actor(context)
        throttle(actor, "aftercare_settle", pk, limit=20)
        from . import cancellations

        return Response(c.Settled(cancellations.settle(actor, pk, key)).data)


# --- Disputes ---------------------------------------------------------------


class DisputeList(OrderView):
    @extend_schema(operation_id="disputes_list", parameters=[c.Query], responses=c.DisputePage)
    def get(self, request, context):
        actor = self.actor(context)
        data = query(request, c.Query)
        if data.get("seller") and actor.context != "seller":
            raise PermissionDenied()
        from . import aftercare_queries

        page_data = aftercare_queries.dispute_list(actor, page=data["page"], seller=data.get("seller"))
        return Response(c.DisputePage(page_data).data)


class DisputeDetail(OrderView):
    @extend_schema(operation_id="disputes_detail", parameters=[c.DocumentQuery], responses=c.DisputeDetail)
    def get(self, request, context, pk):
        actor = self.actor(context)
        query(request, c.DocumentQuery)
        from . import aftercare_queries

        return Response(c.DisputeDetail(aftercare_queries.dispute_detail(actor, pk)).data)


class SubmitDispute(OrderView):
    @extend_schema(
        operation_id="disputes_submit", request=c.DisputeOpenCommand, responses=c.AftercareOutcome
    )
    def post(self, request, context, pk):
        actor = self.actor(context)
        query(request)
        throttle(actor, "dispute_open", pk, limit=20)
        from . import aftercare_queries, disputes

        result = disputes.mutate(actor, pk, "dispute_open", self.data(c.DisputeOpenCommand))
        return Response(
            c.AftercareOutcome(
                {"outcome": result, "current": aftercare_queries.aftercare_detail(actor, pk)}
            ).data,
            status=201,
        )


class WithdrawDispute(OrderView):
    @extend_schema(
        operation_id="disputes_withdraw", request=c.DisputeWithdrawCommand, responses=c.AftercareOutcome
    )
    def post(self, request, pk):
        actor = self.actor("buyer")
        query(request)
        throttle(actor, "dispute_withdraw", pk, limit=20)
        from . import aftercare_queries, disputes
        from .models import DisputeRequest

        row = get_object_or_404(DisputeRequest.objects.filter(order__buyer=actor.account), pk=pk)
        data = self.data(c.DisputeWithdrawCommand)
        if data["dispute"] != row.pk:
            raise ValidationError({"dispute": ["The packet must match the requested resource."]})
        result = disputes.mutate(actor, row.order_id, "dispute_withdraw", data)
        return Response(
            c.AftercareOutcome(
                {"outcome": result, "current": aftercare_queries.aftercare_detail(actor, row.order_id)}
            ).data
        )


class RespondDispute(OrderView):
    @extend_schema(
        operation_id="disputes_respond", request=c.DisputeResponseCommand, responses=c.AftercareOutcome
    )
    def post(self, request, pk):
        actor = self.actor("seller")
        query(request)
        throttle(actor, "dispute_respond", pk, limit=20)
        from . import aftercare_queries, disputes
        from .models import DisputeRequest

        row = get_object_or_404(DisputeRequest.objects.filter(order__in=disputes.order_scope(actor)), pk=pk)
        data = self.data(c.DisputeResponseCommand)
        if data["dispute"] != row.pk:
            raise ValidationError({"dispute": ["The packet must match the requested resource."]})
        result = disputes.mutate(actor, row.order_id, "dispute_respond", data)
        return Response(
            c.AftercareOutcome(
                {"outcome": result, "current": aftercare_queries.aftercare_detail(actor, row.order_id)}
            ).data
        )


# --- Reviews ----------------------------------------------------------------


class SubmitReview(OrderView):
    @extend_schema(
        operation_id="reviews_submit", request=c.ReviewSubmitCommand, responses=c.AftercareOutcome
    )
    def post(self, request, context, pk):
        actor = self.actor(context)
        query(request)
        throttle(actor, "review_submit", pk, limit=20)
        from . import aftercare_queries, reviews

        result = reviews.mutate(actor, pk, "review_submit", self.data(c.ReviewSubmitCommand))
        return Response(
            c.AftercareOutcome(
                {"outcome": result, "current": aftercare_queries.aftercare_detail(actor, pk)}
            ).data,
            status=201,
        )


class WithdrawReview(OrderView):
    @extend_schema(
        operation_id="reviews_withdraw", request=c.ReviewWithdrawCommand, responses=c.AftercareOutcome
    )
    def post(self, request, pk):
        actor = self.actor("buyer")
        query(request)
        throttle(actor, "review_withdraw", pk, limit=20)
        from . import aftercare_queries, reviews
        from .models import Review

        review = get_object_or_404(Review.objects.filter(order__buyer=actor.account), pk=pk)
        result = reviews.mutate(actor, review.order_id, "review_withdraw", self.data(c.ReviewWithdrawCommand))
        return Response(
            c.AftercareOutcome(
                {"outcome": result, "current": aftercare_queries.aftercare_detail(actor, review.order_id)}
            ).data
        )


class ReviewStatusView(OrderView):
    @extend_schema(operation_id="reviews_status", parameters=[c.DocumentQuery], responses=c.ReviewStatus)
    def get(self, request, pk):
        actor = self.actor("buyer")
        query(request, c.DocumentQuery)
        from . import aftercare_queries

        return Response(
            c.ReviewStatus(aftercare_queries.review_status(actor, pk), allow_null=True).data
        )


class OrderImage(ProtectedDocumentView):
    @extend_schema(operation_id="orders_line_image", responses={(200, "image/jpeg"): bytes})
    def get(self, request, pk, line_id):
        from apps.catalogue.views import image_response
        return image_response(queries.order_line_image(self.actor("seller"), pk, line_id), request)


class SellerIssues(OrderView):
    @extend_schema(operation_id="seller_issues", parameters=[c.SellerIssueQuery], responses=c.SellerIssuePage)
    def get(self, request):
        from . import issue_queries
        data = query(request, c.SellerIssueQuery)
        return Response(c.SellerIssuePage(issue_queries.page(self.actor("seller"), **data)).data)
