from functools import wraps
from django.db import DatabaseError
from django.contrib.admin import RelatedOnlyFieldListFilter
from django import forms
from django.contrib import messages
from django.http import HttpResponse, HttpResponseRedirect, Http404
from django.urls import path, reverse
from django.utils.html import format_html
from rest_framework.exceptions import APIException
from django.core.exceptions import PermissionDenied
from apps.accounts.admin import owner_site
from apps.accounts.admin_access import admin_actor, permits, is_owner
from apps.organizations.admin import ReadOnlyAdmin
from .models import (
    Negotiation,
    NegotiationRevision,
    NegotiationEvent,
    NegotiationSubmission,
    NegotiationOutcome,
    NegotiationCommand,
    NegotiationSubmissionFence,
    SellerCheckoutTerms,
    OrderPolicy,
    CheckoutSubmission,
    CheckoutOutcome,
    SellerOrder,
    OrderLine,
    Invoice,
    OrderEvent,
)
from . import queries, services


def private_document(view):
    @wraps(view)
    def guarded(*args, **kwargs):
        try:
            return view(*args, **kwargs)
        except (APIException, DatabaseError, OSError) as exc:
            status = exc.status_code if isinstance(exc, APIException) else 503
            response = HttpResponse(
                "Protected document temporarily unavailable." if status >= 500 else "Access denied.", status=status
            )
            response["Cache-Control"] = "private, no-store"
            response["X-Content-Type-Options"] = "nosniff"
            return response

    return guarded


def allowed(request, permission):
    return permits(request, "orders", permission)


class OrderAdmin(ReadOnlyAdmin):
    fields = [
        "id",
        "buyer_display",
        "seller_display",
        "currency",
        "goods_total",
        "payment_method",
        "accepted_at",
        "due_at",
        "snapshot",
    ]

    def buyer_display(self, obj):
        return obj.snapshot["buyer"]

    def seller_display(self, obj):
        return obj.snapshot["seller"]

    def get_readonly_fields(self, request, obj=None):
        return self.fields

    list_display = ["id", "seller_display", "currency", "goods_total", "payment_method", "accepted_at"]
    list_filter = [("seller", RelatedOnlyFieldListFilter), "currency", "payment_method", "accepted_at"]
    search_fields = ["id", "invoice__number"]
    ordering = ["-accepted_at"]

    def staff_view(self, request, obj=None):
        return allowed(request, "read_orders")

    def lookup_allowed(self, lookup, value, request=None):
        return lookup in {
            "id",
            "id__exact",
            "seller__id__exact",
            "currency",
            "currency__exact",
            "payment_method",
            "payment_method__exact",
            "accepted_at__gte",
            "accepted_at__lt",
        }


class InvoiceAdmin(ReadOnlyAdmin):
    fields = ["id", "number", "issued_at", "protected_document"]
    list_display = ["number", "issued_at", "protected_document"]
    search_fields = ["number"]
    ordering = ["-issued_at"]
    list_filter = ["issued_at", "order__currency"]

    def staff_view(self, request, obj=None):
        return allowed(request, "read_invoices")

    def get_readonly_fields(self, request, obj=None):
        return self.fields

    def lookup_allowed(self, lookup, value, request=None):
        return lookup in {
            "id",
            "id__exact",
            "number",
            "number__exact",
            "order__currency__exact",
            "issued_at__gte",
            "issued_at__lt",
        }

    def protected_document(self, obj):
        return format_html(
            '<a href="{}">Read invoice / print</a> · <a href="{}">Protected PDF</a>',
            reverse("admin:orders_invoice_document", args=[obj.pk]),
            reverse("admin:orders_invoice_pdf", args=[obj.pk]),
        )

    def get_object(self, request, object_id, from_field=None):
        result = super().get_object(request, object_id, from_field)
        if result is not None:
            queries.document(admin_actor(request), result.pk, action="native_invoice_metadata", native=True)
        return result

    def get_urls(self):
        return [
            path("<uuid:pk>/document/", self.admin_site.admin_view(self.document), name="orders_invoice_document"),
            path("<uuid:pk>/pdf/", self.admin_site.admin_view(self.download), name="orders_invoice_pdf"),
            *super().get_urls(),
        ]

    @private_document
    def document(self, request, pk):
        if request.method not in ["GET", "HEAD"]:
            raise PermissionDenied()
        item = queries.document(admin_actor(request), pk, action="native_invoice_print", native=True)
        from .documents import html_document

        response = HttpResponse(html_document(item, "en"), content_type="text/html; charset=utf-8")
        response["Cache-Control"] = "private, no-store"
        response["Content-Security-Policy"] = (
            "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'"
        )
        response["Referrer-Policy"] = "no-referrer"
        response["X-Content-Type-Options"] = "nosniff"
        return response

    @private_document
    def download(self, request, pk):
        if request.method not in ["GET", "HEAD"]:
            raise PermissionDenied()
        item = queries.document(admin_actor(request), pk, action="native_invoice_pdf", native=True)
        from .documents import pdf_bytes

        response = HttpResponse(pdf_bytes(item, "en"), content_type="application/pdf")
        response["Cache-Control"] = "private, no-store"
        response["Content-Security-Policy"] = (
            "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'"
        )
        response["Referrer-Policy"] = "no-referrer"
        response["X-Content-Type-Options"] = "nosniff"
        response["Content-Disposition"] = f'attachment; filename="invoice-{item.number}.pdf"'
        return response


class MetadataAdmin(ReadOnlyAdmin):
    fields = ["identifier"]
    list_display = ["identifier"]
    search_fields = []

    def identifier(self, obj):
        return str(obj.pk)

    def get_readonly_fields(self, request, obj=None):
        return self.fields

    def lookup_allowed(self, lookup, value, request=None):
        return lookup in {self.model._meta.pk.name, self.model._meta.pk.name + "__exact"}


class LineAdmin(OrderAdmin):
    fields = ["id", "order", "variant", "tier", "quantity", "unit_price", "goods_amount", "snapshot"]
    list_display = ["id", "order", "tier", "quantity", "unit_price", "goods_amount"]
    list_filter = ["tier"]
    ordering = ["pk"]
    search_fields = ["order__id"]

    def lookup_allowed(self, lookup, value, request=None):
        return lookup in {"id", "id__exact", "tier", "tier__exact"}


class PolicyForm(forms.ModelForm):
    expected_version = forms.IntegerField(widget=forms.HiddenInput)
    reason = forms.CharField(min_length=3, max_length=1000)

    class Meta:
        model = OrderPolicy
        fields = ["advance_hours", "reminder_hours"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["expected_version"].initial = self.instance.version
        self.fields["reminder_hours"].required = False

    def clean_reminder_hours(self):
        value=self.cleaned_data.get("reminder_hours")
        return self.instance.reminder_hours if value is None else value


class PolicyAdmin(ReadOnlyAdmin):
    form = PolicyForm
    fields = ["advance_hours", "reminder_hours", "version", "expected_version", "reason"]
    readonly_fields = ["version"]
    list_display = ["advance_hours", "reminder_hours", "version"]

    def get_readonly_fields(self, request, obj=None):
        return self.readonly_fields

    def has_change_permission(self, request, obj=None):
        return is_owner(request)

    def change_view(self, request, object_id, form_url="", extra_context=None):
        if request.method != "POST":
            return super().change_view(request, object_id, form_url, extra_context)
        if not is_owner(request):
            raise PermissionDenied()
        obj = self.get_object(request, object_id)
        if obj is None:
            raise Http404
        form = self.get_form(request, obj)(request.POST, instance=obj)
        if not form.is_valid():
            return super().change_view(request, object_id, form_url, extra_context)
        try:
            services.set_policy(
                admin_actor(request),
                form.cleaned_data["expected_version"],
                form.cleaned_data["advance_hours"],
                form.cleaned_data["reason"],
                reminder_hours=form.cleaned_data["reminder_hours"],
            )
        except APIException:
            messages.error(request, "Policy changed or access ended. Review the current version.")
        else:
            messages.success(request, "Payment policy updated. Accepted original deadlines remain unchanged; zero reminder hours disables repeats.")
        return HttpResponseRedirect(request.path)

    def save_model(self, *args, **kwargs):
        raise PermissionDenied()

    def save_related(self, *args, **kwargs):
        raise PermissionDenied()


for model, admin in [
    (SellerOrder, OrderAdmin),
    (OrderLine, LineAdmin),
    (Invoice, InvoiceAdmin),
    (OrderPolicy, PolicyAdmin),
    (SellerCheckoutTerms, MetadataAdmin),
    (CheckoutSubmission, MetadataAdmin),
    (CheckoutOutcome, MetadataAdmin),
    (OrderEvent, MetadataAdmin),
]:
    owner_site.register(model, admin)


class NegotiationAdmin(ReadOnlyAdmin):
    list_display = ["id", "seller", "currency", "state", "revision", "version", "created_at"]
    list_filter = ["state", "currency", "created_at"]
    search_fields = ["id"]
    list_per_page = 20

    def staff_view(self, request, obj=None):
        return allowed(request, "read_negotiations")

    def get_object(self, request, object_id, from_field=None):
        obj = super().get_object(request, object_id, from_field)
        if obj:
            from apps.accounts.models import AuditEvent

            actor = admin_actor(request)
            AuditEvent.objects.create(
                actor=actor.user,
                account=actor.account,
                context=actor.context,
                action="negotiation_inspected",
                resource_type=self.model._meta.label_lower,
                resource_id=obj.pk,
                reason="Native readonly request inspection",
            )
        return obj


class ProposalHistoryAdmin(NegotiationAdmin):
    list_display = ["id", "request", "created_at"]
    list_filter = ["created_at"]
    search_fields = ["request__id"]


for model, model_admin in [
    (Negotiation, NegotiationAdmin),
    (NegotiationRevision, ProposalHistoryAdmin),
    (NegotiationEvent, ProposalHistoryAdmin),
    (NegotiationSubmission, MetadataAdmin),
    (NegotiationOutcome, MetadataAdmin),
    (NegotiationCommand, MetadataAdmin),
]:
    owner_site.register(model, model_admin)
owner_site.register(NegotiationSubmissionFence, MetadataAdmin)
