from django.shortcuts import get_object_or_404
from django.http import HttpResponse
from rest_framework.response import Response
from rest_framework.exceptions import PermissionDenied
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
            c.OrderPage(queries.order_page(actor, seller=data.get("seller"), page=data["page"], invoices=invoices)).data
        )


class OrderDetail(OrderView):
    @extend_schema(operation_id="orders_detail", parameters=[c.DocumentQuery], responses=c.OrderRow)
    def get(self, request, context, pk):
        actor = self.actor(context)
        query(request, c.DocumentQuery)
        return Response(c.OrderRow(queries.order_data(get_object_or_404(queries.order_queryset(actor), pk=pk))).data)


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
