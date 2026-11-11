import uuid
from decimal import Decimal
from functools import wraps
from django.db import DatabaseError, transaction
from django.db.models import Q
from django import forms
from django.contrib import admin as django_admin, messages
from django.contrib.admin import RelatedOnlyFieldListFilter
from django.http import HttpResponse, HttpResponseRedirect, Http404
from django.shortcuts import get_object_or_404, render
from django.urls import path, reverse
from django.utils.html import format_html
from rest_framework.exceptions import APIException
from django.core.exceptions import PermissionDenied
from django.core import signing
from django.utils.translation import gettext_lazy as _
from apps.accounts.admin import owner_site
from apps.accounts.admin_access import admin_actor, permits, is_owner
from apps.accounts.admin_copy import COPY as ADMIN_COPY
from apps.accounts.models import User
from apps.organizations.admin import ReadOnlyAdmin
from apps.payments.access import audit
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
    Aftercare,
    AftercareCommand,
    AftercareEvent,
    Amendment,
    AmendmentDecision,
    AmendmentLine,
    CancellationDecision,
    CancellationRequest,
    InvoiceAdjustment,
    DisputeRequest,
    DisputeResponse,
    DisputeDecision,
    Review,
    ReviewDecision,
)
from . import access, queries, services


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

    def get_fields(self, request, obj=None):
        fields = list(self.fields)
        if obj is not None and self.model is SellerOrder:
            from apps.fulfilment.access import scope

            if scope(admin_actor(request), assignment=True).filter(pk=obj.pk).exists():
                fields.append("delivery_workflow")
        return fields

    def get_readonly_fields(self, request, obj=None):
        return self.get_fields(request, obj)

    def delivery_workflow(self, obj):
        return format_html(
            '<a href="{}">Delivery / fulfilment workflow</a>', reverse("admin:fulfilment_state_workflow", args=[obj.pk])
        )

    list_display = ["id", "seller_display", "currency", "goods_total", "payment_method", "accepted_at"]
    list_filter = [("seller", RelatedOnlyFieldListFilter), "currency", "payment_method", "accepted_at"]
    search_fields = ["id", "invoice__number"]
    ordering = ["-accepted_at"]
    money_fields = {"goods_total": "currency"}
    fieldset_groups = [
        ("Agreement", "The accepted buyer–seller order. Original lines, prices and currency are frozen history; approved amendments project effective values without rewriting acceptance.",
         ["id", "invoice", "buyer", "seller", "currency", "payment_method", "goods_total"]),
        ("Timing", "Acceptance and the original advance due time stay immutable; extensions and aftercare decisions are separate retained records.",
         ["accepted_at", "due_at"]),
    ]

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
    badge_fields = ("state",)
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


def aftercare_orders(actor, *, include_disputes_reviews=False):
    """Shared head/history scope; other aftercare families retain their own scope."""
    if actor.context == "owner":
        return SellerOrder.objects.all()
    scoped = Q(cancellation_requests__in=access.cancellation_scope(actor)) | Q(
        amendments__in=access.amendment_scope(actor)
    )
    if include_disputes_reviews:
        scoped |= Q(disputes__in=access.dispute_scope(actor).filter(assigned_to=actor.user))
        scoped |= Q(review__in=access.review_scope(actor))
    return SellerOrder.objects.filter(scoped).distinct()


class AftercareAdmin(ReadOnlyAdmin):
    list_per_page = 20
    order_path = "order_id"

    def staff_view(self, request, obj=None):
        return allowed(request, "read_aftercare") and (
            obj is None or self.staff_queryset(request, self.model.objects.filter(pk=obj.pk)).exists()
        )

    def staff_queryset(self, request, qs):
        return qs.filter(**{self.order_path + "__in": aftercare_orders(admin_actor(request)).values("pk")})

    def get_queryset(self, request):
        qs = super().get_queryset(request)
        if self.has_view_permission(request) and not getattr(request, "_aftercare_list_audited", False):
            audit(admin_actor(request), self.model(), "aftercare_native_list", "Bounded scoped aftercare metadata")
            request._aftercare_list_audited = True
        return qs

    def get_object(self, request, object_id, from_field=None):
        obj = super().get_object(request, object_id, from_field)
        if obj is not None:
            audit(admin_actor(request), obj, "aftercare_native_metadata")
        return obj

    def lookup_allowed(self, lookup, value, request=None):
        return lookup in {
            self.model._meta.pk.name,
            self.model._meta.pk.name + "__exact",
            *getattr(self, "list_filter", []),
        }


class AftercareTechnicalAdmin(AftercareAdmin):
    def staff_view(self, request, obj=None):
        return False


class AftercareStateAdmin(AftercareAdmin):
    list_display = ["order", "version", "created_at"]

    def staff_view(self, request, obj=None):
        return permits(request, "orders", "read_aftercare", "read_dispute", "read_review") and (
            obj is None or self.staff_queryset(request, self.model.objects.filter(pk=obj.pk)).exists()
        )

    def staff_queryset(self, request, qs):
        orders = aftercare_orders(admin_actor(request), include_disputes_reviews=True)
        return qs.filter(order_id__in=orders.values("pk"))


class AftercareEventAdmin(AftercareStateAdmin):
    list_display = ["id", "order", "version", "action", "context", "created_at"]
    list_filter = ["action", "context"]

    def staff_queryset(self, request, qs):
        actor = admin_actor(request)
        legacy = aftercare_orders(actor)
        disputes = access.dispute_scope(actor).filter(assigned_to=actor.user).values("order_id")
        reviews = access.review_scope(actor).values("order_id")
        return qs.filter(
            Q(order_id__in=legacy.values("pk"))
            | Q(order_id__in=disputes, action__startswith="dispute_")
            | Q(order_id__in=reviews, action__startswith="review_")
        ).distinct()


class AftercareCommandAdmin(AftercareTechnicalAdmin):
    list_display = ["id", "order", "action", "context", "created_at"]


def reviewer_name(obj):
    return obj.assigned_to.display_name if obj.assigned_to_id else ADMIN_COPY["payment_unassigned"]


class CancellationAdmin(AftercareAdmin):
    list_display = ["id", "order", "state", "requester", "reviewer", "workspace"]
    list_filter = ["state", "requester_context"]
    search_fields = ["id", "order__id"]
    badge_fields = ("state",)
    fieldset_groups = [
        ("Request", "Who asked and why. Buyer/seller requests bind to the exact requesting account; a staff-opened request cross-references its paid-shortage case and records the initiating staff identity honestly.",
         ["id", "order", "requester_context", "requester_account", "requester_user", "payment_case", "reason"]),
        ("Review state", "Pending raises the operational cancellation hold and blocks dispatch/completion. Approval is terminal: it releases the unshipped advance allocation exactly once and creates the bounded refund due. Withdrawal keeps history and leaves the hold for independent closure.",
         ["state", "assigned_to", "blocker", "version", "created_at"]),
    ]
    fields = [
        "id",
        "order",
        "state",
        "requester_context",
        "requester_account",
        "requester_user",
        "payment_case",
        "blocker",
        "reason",
        "assigned_to",
        "version",
        "created_at",
    ]

    def get_readonly_fields(self, request, obj=None):
        return self.fields

    def staff_queryset(self, request, qs):
        return qs.filter(pk__in=access.cancellation_scope(admin_actor(request)).values("pk"))

    def requester(self, obj):
        return obj.requester_context.title()

    def reviewer(self, obj):
        return reviewer_name(obj)

    def workspace(self, obj):
        return format_html('<a href="{}">{}</a>',
            self.review_url(obj.pk), _("Open guarded cancellation review"),
        )

    def review_url(self, pk):
        return reverse("admin:orders_cancellationrequest_review", args=[pk])

    def get_urls(self):
        return [
            path("<uuid:pk>/review/", self.admin_site.admin_view(self.workflow), name="orders_cancellationrequest_review"),
            *super().get_urls(),
        ]

    @private_document
    def workflow(self, request, pk):
        from apps.payments import queries as money

        from . import aftercare as aftercare_projection, cancellations

        actor = admin_actor(request)
        record = get_object_or_404(
            access.cancellation_scope(actor).select_related(
                "order__invoice", "order__buyer__user", "order__seller__account__user", "decision"
            ),
            pk=pk,
        )
        if request.method not in {"GET", "HEAD", "POST"} or set(request.GET):
            raise PermissionDenied()
        audit(actor, record, "aftercare_cancellation_workspace")
        order = record.order
        codes = access.aftercare_rights(actor)
        can_inspect = actor.context == "owner" or record.assigned_to_id == actor.user.pk
        choices = [("", ADMIN_COPY["payment_choose_action"])]
        if "assign_aftercare" in codes:
            choices.append(("assign", ADMIN_COPY["payment_assign"]))
        independent = True
        try:
            cancellations.independent(order, actor.user, request=record)
        except APIException:
            independent = False
        if (
            record.state == "pending"
            and record.assigned_to_id == actor.user.pk
            and "decide_cancellation" in codes
            and independent
        ):
            choices += [("approve", ADMIN_COPY["payment_approve"]), ("reject", ADMIN_COPY["payment_reject"])]
        form = self.decision_form(request, record, order, choices)
        status = 200
        if request.method == "POST" and form.is_valid():
            data = {
                "command_id": form.cleaned_data["command_id"],
                "action": form.cleaned_data["action"],
                "version": form.cleaned_data["version"],
                "request_version": form.cleaned_data["case_version"],
                "reason": form.cleaned_data["reason"],
            }
            if form.cleaned_data.get("assigned_to"):
                data["assigned_to"] = form.cleaned_data["assigned_to"].pk
            try:
                cancellations.decide(actor, pk, data)
            except APIException as error:
                form.add_error(None, ADMIN_COPY["payment_changed"])
                status = error.status_code
            else:
                return HttpResponseRedirect(request.path)
        response = render(
            request,
            "orders/cancellation.html",
            {
                **self.admin_site.each_context(request),
                "title": "Order cancellation review",
                "opts": CancellationRequest._meta,
                "record": record,
                "form": form,
                "projection": money.projection(order) if can_inspect else None,
                "adjustments": aftercare_projection.adjustment_rows(order)[:20] if can_inspect else [],
                "independent": independent,
                "can_inspect": can_inspect,
            },
            status=status,
        )
        response["Cache-Control"] = "private, no-store"
        response["Referrer-Policy"] = "same-origin"
        return response

    def decision_form(self, request, record, order, choices):
        from apps.payments.admin import CaseForm

        from . import cancellations

        form = CaseForm(
            request.POST if request.method == "POST" else None,
            initial={
                "command_id": uuid.uuid4(),
                "version": Aftercare.objects.filter(order=order).values_list("version", flat=True).first() or 0,
                "case_version": record.version,
                "assigned_to": record.assigned_to_id,
            },
        )
        form.fields["action"].choices = choices
        form.fields["assigned_to"].queryset = User.objects.filter(pk__in=[x.pk for x in cancellations.reviewers(record)])
        if "assign_aftercare" not in access.aftercare_rights(admin_actor(request)):
            form.fields.pop("assigned_to")
        return form


class CancellationDecisionAdmin(AftercareAdmin):
    order_path = "request__order_id"
    list_display = ["request", "action", "created_at"]


class AmendmentAdmin(AftercareAdmin):
    list_display = ["id", "order", "state", "after_total", "reviewer", "workspace"]
    list_filter = ["state"]
    search_fields = ["id", "order__id"]
    badge_fields = ("state",)
    fieldset_groups = [
        ("Proposal", "Seller-proposed decreases only, before dispatch. Zero quantities, increases and substitutions are refused; wholesale lines cannot drop below the variant's current minimum.",
         ["id", "order", "actor", "after_total", "reason"]),
        ("Review state", "An independent assigned staff member decides. Approval applies the effective lines, partially releases held stock for the exact reduction and writes one invoice adjustment; original accepted lines stay frozen.",
         ["state", "assigned_to", "version", "created_at"]),
    ]
    fields = ["id", "order", "state", "actor", "after_total", "reason", "assigned_to", "version", "created_at"]

    def get_readonly_fields(self, request, obj=None):
        return self.fields

    def staff_queryset(self, request, qs):
        return qs.filter(pk__in=access.amendment_scope(admin_actor(request)).values("pk"))

    def reviewer(self, obj):
        return reviewer_name(obj)

    def workspace(self, obj):
        return format_html('<a href="{}">{}</a>',
            self.review_url(obj.pk), _("Open guarded amendment review"),
        )

    def review_url(self, pk):
        return reverse("admin:orders_amendment_review", args=[pk])

    def get_urls(self):
        return [
            path("<uuid:pk>/review/", self.admin_site.admin_view(self.workflow), name="orders_amendment_review"),
            *super().get_urls(),
        ]

    @private_document
    def workflow(self, request, pk):
        from apps.payments import queries as money
        from apps.payments.admin import CaseForm

        from . import aftercare as aftercare_projection, amendments

        actor = admin_actor(request)
        record = get_object_or_404(
            access.amendment_scope(actor)
            .select_related("order__invoice", "order__buyer__user", "order__seller__account__user", "decision")
            .prefetch_related("lines__line"),
            pk=pk,
        )
        if request.method not in {"GET", "HEAD", "POST"} or set(request.GET):
            raise PermissionDenied()
        audit(actor, record, "aftercare_amendment_workspace")
        order = record.order
        codes = access.aftercare_rights(actor)
        can_inspect = actor.context == "owner" or record.assigned_to_id == actor.user.pk
        choices = [("", ADMIN_COPY["payment_choose_action"])]
        if "assign_aftercare" in codes:
            choices.append(("assign", ADMIN_COPY["payment_assign"]))
        independent = True
        try:
            amendments.independent(order, actor.user, amendment=record)
        except APIException:
            independent = False
        if (
            record.state == "pending"
            and record.assigned_to_id == actor.user.pk
            and "decide_amendment" in codes
            and independent
        ):
            choices += [("approve", ADMIN_COPY["payment_approve"]), ("reject", ADMIN_COPY["payment_reject"])]
        form = CaseForm(
            request.POST if request.method == "POST" else None,
            initial={
                "command_id": uuid.uuid4(),
                "version": Aftercare.objects.filter(order=order).values_list("version", flat=True).first() or 0,
                "case_version": record.version,
                "assigned_to": record.assigned_to_id,
            },
        )
        form.fields["action"].choices = choices
        form.fields["assigned_to"].queryset = User.objects.filter(pk__in=[x.pk for x in amendments.reviewers(record)])
        if "assign_aftercare" not in codes:
            form.fields.pop("assigned_to")
        status = 200
        if request.method == "POST" and form.is_valid():
            data = {
                "command_id": form.cleaned_data["command_id"],
                "action": form.cleaned_data["action"],
                "version": form.cleaned_data["version"],
                "amendment_version": form.cleaned_data["case_version"],
                "reason": form.cleaned_data["reason"],
            }
            if form.cleaned_data.get("assigned_to"):
                data["assigned_to"] = form.cleaned_data["assigned_to"].pk
            try:
                amendments.decide(actor, pk, data)
            except APIException as error:
                form.add_error(None, ADMIN_COPY["payment_changed"])
                status = error.status_code
            else:
                return HttpResponseRedirect(request.path)
        response = render(
            request,
            "orders/amendment.html",
            {
                **self.admin_site.each_context(request),
                "title": "Order amendment review",
                "opts": Amendment._meta,
                "record": record,
                "form": form,
                "projection": money.projection(order) if can_inspect else None,
                "effective_lines": aftercare_projection.effective_lines(order) if can_inspect else [],
                "adjustments": aftercare_projection.adjustment_rows(order)[:20] if can_inspect else [],
                "independent": independent,
                "can_inspect": can_inspect,
            },
            status=status,
        )
        response["Cache-Control"] = "private, no-store"
        response["Referrer-Policy"] = "same-origin"
        return response


class AmendmentLineAdmin(AftercareAdmin):
    order_path = "amendment__order_id"
    list_display = ["id", "amendment", "line", "proposed_quantity", "proposed_unit_price"]


class AmendmentDecisionAdmin(AftercareAdmin):
    order_path = "amendment__order_id"
    list_display = ["amendment", "action", "created_at"]


class AdjustmentAdmin(AftercareAdmin):
    list_display = ["id", "invoice", "cause", "before_total", "after_total", "created_at"]
    list_filter = ["cause"]
    fields = [
        "id",
        "order",
        "invoice",
        "cause",
        "cancellation",
        "amendment",
        "before_lines",
        "after_lines",
        "before_total",
        "after_total",
        "reason",
        "actor",
        "created_at",
    ]

    def get_readonly_fields(self, request, obj=None):
        return self.fields


for model, model_admin in [
    (Aftercare, AftercareStateAdmin),
    (AftercareEvent, AftercareEventAdmin),
    (AftercareCommand, AftercareCommandAdmin),
    (CancellationRequest, CancellationAdmin),
    (CancellationDecision, CancellationDecisionAdmin),
    (Amendment, AmendmentAdmin),
    (AmendmentLine, AmendmentLineAdmin),
    (AmendmentDecision, AmendmentDecisionAdmin),
    (InvoiceAdjustment, AdjustmentAdmin),
]:
    owner_site.register(model, model_admin)


WORKSPACE_PACKET_SALT = "orders.native-aftercare-review"


def workspace_form(request, actor, record, choices, *, family, reviewers=None, refund=False):
    from apps.payments.admin import CaseForm

    packet = {
        "actor": str(actor.user.pk),
        "context": actor.context,
        "record": str(record.pk),
        "family": family,
        "command_id": str(uuid.uuid4()),
        "version": Aftercare.objects.filter(order_id=record.order_id).values_list("version", flat=True).first() or 0,
        "case_version": record.version,
    }
    form = CaseForm(
        request.POST if request.method == "POST" else None,
        initial={
            **packet,
            "packet": signing.dumps(packet, salt=WORKSPACE_PACKET_SALT),
            "assigned_to": getattr(record, "assigned_to_id", None),
        },
    )
    form.fields["packet"] = forms.CharField(widget=forms.HiddenInput)
    form.fields["action"].choices = choices
    if reviewers is None:
        form.fields.pop("assigned_to")
    else:
        form.fields["assigned_to"].queryset = User.objects.filter(pk__in=[user.pk for user in reviewers])
    if refund:
        form.fields["amount"] = forms.DecimalField(
            label=_("Ordered refund amount"), required=False, max_digits=24, decimal_places=2,
            min_value=Decimal("0.01"), help_text=_("Exact positive amount in the order currency; never money execution."),
        )
    if request.method == "POST":
        if set(request.POST) - set(form.fields) - {"csrfmiddlewaretoken"}:
            raise PermissionDenied()
        if form.is_valid():
            try:
                sealed = signing.loads(form.cleaned_data["packet"], salt=WORKSPACE_PACKET_SALT, max_age=3600)
            except signing.BadSignature:
                sealed = None
            submitted = {
                **{key: packet[key] for key in ("actor", "context", "record", "family")},
                "command_id": str(form.cleaned_data["command_id"]),
                "version": form.cleaned_data["version"],
                "case_version": form.cleaned_data["case_version"],
            }
            if sealed != submitted:
                form.add_error("packet", _("The reviewed packet expired or changed. Reload before deciding."))
            if refund:
                amount = form.cleaned_data.get("amount")
                if form.cleaned_data["action"] == "refund" and amount is None:
                    form.add_error("amount", _("Enter the exact ordered refund amount."))
                elif form.cleaned_data["action"] != "refund" and amount is not None:
                    form.add_error("amount", _("An amount is only allowed for an ordered refund."))
    return form


def workspace_response(model_admin, request, template, record, form, *, status=200, **context):
    response = render(
        request, template,
        {**model_admin.admin_site.each_context(request), "opts": model_admin.model._meta,
         "record": record, "form": form, **context},
        status=status,
    )
    response["Cache-Control"] = "private, no-store"
    response["Referrer-Policy"] = "same-origin"
    response["X-Content-Type-Options"] = "nosniff"
    return response


class DisputeScopedAdmin(AftercareAdmin):
    dispute_path = "pk"
    inspection_only = False

    def staff_view(self, request, obj=None):
        return allowed(request, "read_dispute") and (
            obj is None or self.staff_queryset(request, self.model.objects.filter(pk=obj.pk)).exists()
        )

    def staff_queryset(self, request, qs):
        actor = admin_actor(request)
        scope = access.dispute_scope(actor)
        if self.inspection_only:
            scope = scope.filter(assigned_to=actor.user)
        return qs.filter(**{self.dispute_path + "__in": scope.values("pk")})

    def can_inspect(self, actor, record):
        return actor.context == "owner" or (
            "read_dispute" in access.aftercare_rights(actor) and record.assigned_to_id == actor.user.pk
        )


@django_admin.register(DisputeRequest, site=owner_site)
class DisputeRequestAdmin(DisputeScopedAdmin):
    list_display = ["id", "order", "state", "reviewer", "workspace", "created_at"]
    list_filter = ["state"]
    search_fields = ["id", "order__invoice__number"]
    badge_fields = ("state",)
    fields = [
        "id", "order", "state", "requester_account", "reason", "blocker", "assigned_to",
        "version", "event", "created_at", "workspace",
    ]
    fieldset_groups = [
        (_("Dispute"), _("Delivered-order dispute; original delivery and completion history remain unchanged."),
         ["id", "order", "state", "requester_account", "reason", "blocker"]),
        (_("Guarded review"), _("Only an independent exact assignee may decide. A refund order creates a due, not execution."),
         ["assigned_to", "version", "event", "created_at", "workspace"]),
    ]

    def get_fields(self, request, obj=None):
        if obj is not None and self.can_inspect(admin_actor(request), obj):
            return self.fields
        return ["id", "state", "assigned_to", "version", "created_at", "workspace"]

    def get_readonly_fields(self, request, obj=None):
        return self.get_fields(request, obj)

    def reviewer(self, obj):
        return reviewer_name(obj)

    def workspace(self, obj):
        return format_html('<a href="{}">{}</a>', reverse("admin:orders_disputerequest_review", args=[obj.pk]),
                           _("Open guarded dispute review"))

    def get_urls(self):
        return [
            path("<uuid:pk>/review/", self.admin_site.admin_view(self.workflow), name="orders_disputerequest_review"),
            path("<uuid:pk>/evidence/<uuid:image>/", self.admin_site.admin_view(self.evidence),
                 name="orders_disputerequest_evidence"),
            *super().get_urls(),
        ]

    @private_document
    def workflow(self, request, pk):
        from . import disputes

        if request.method not in {"GET", "HEAD", "POST"} or set(request.GET):
            raise PermissionDenied()
        actor = admin_actor(request)
        record = get_object_or_404(
            access.dispute_scope(actor).select_related("order__invoice", "order__buyer__user",
                                                     "order__seller__account__user", "response", "decision"), pk=pk,
        )
        audit(actor, record, "dispute_native_workspace")
        codes = access.aftercare_rights(actor)
        can_inspect = self.can_inspect(actor, record)
        independent = True
        try:
            disputes.independent(record.order, actor.user, dispute=record)
        except APIException:
            independent = False
        choices = [("", ADMIN_COPY["payment_choose_action"])]
        if record.state == "pending" and "assign_dispute" in codes:
            choices.append(("assign", ADMIN_COPY["payment_assign"]))
        if (record.state == "pending" and record.assigned_to_id == actor.user.pk
                and "decide_dispute" in codes and independent):
            choices += [("dismiss", _("Dismiss")), ("resolve", _("Resolve without money")),
                        ("refund", _("Order bounded seller refund"))]
        form = workspace_form(
            request, actor, record, choices, family="dispute", refund=True,
            reviewers=disputes.reviewers(record) if "assign_dispute" in codes else None,
        )
        status = 200
        if request.method == "POST" and form.is_valid():
            data = {key: form.cleaned_data[key] for key in ("command_id", "action", "version", "reason")}
            data["dispute_version"] = form.cleaned_data["case_version"]
            if form.cleaned_data["action"] == "assign":
                assigned = form.cleaned_data.get("assigned_to")
                data["assigned_to"] = assigned.pk if assigned else None
            if form.cleaned_data["action"] == "refund":
                data["amount"] = format(form.cleaned_data["amount"], ".2f")
            try:
                disputes.decide(actor, pk, data)
            except APIException as error:
                form.add_error(None, ADMIN_COPY["payment_changed"])
                status = error.status_code
            else:
                return HttpResponseRedirect(request.path)
        images = []
        if can_inspect and "read_dispute_evidence" in codes:
            images = [
                {"url": reverse("admin:orders_disputerequest_evidence", args=[record.pk, binding.evidence_id])}
                for binding in record.evidence_bindings.order_by("created_at", "pk")[:3]
            ]
        return workspace_response(
            self, request, "orders/dispute.html", record, form, status=status,
            title=_("Order dispute review"), independent=independent, can_inspect=can_inspect,
            refund_bound=format(disputes.refund_bound(record.order), ".2f") if can_inspect else None,
            images=images,
        )

    @private_document
    def evidence(self, request, pk, image):
        from apps.messaging.media import response as image_response
        from apps.payments.models import Evidence

        if request.method not in {"GET", "HEAD"} or set(request.GET):
            raise PermissionDenied()
        actor = admin_actor(request)
        if "read_dispute_evidence" not in access.aftercare_rights(actor):
            raise PermissionDenied()
        from . import aftercare_commands, disputes

        preliminary = get_object_or_404(access.dispute_scope(actor), pk=pk)
        with transaction.atomic():
            aftercare_commands.lock_order(actor, preliminary.order_id, disputes.order_scope(actor))
            record = get_object_or_404(access.dispute_scope(actor).select_for_update(), pk=pk)
            if ("read_dispute_evidence" not in access.aftercare_rights(actor)
                    or not self.can_inspect(actor, record)):
                raise PermissionDenied()
            item = get_object_or_404(Evidence.objects.filter(binding__dispute=record), pk=image)
            audit(actor, item, "dispute_evidence_head" if request.method == "HEAD" else "dispute_evidence_read")
            result = image_response(item, head=request.method == "HEAD")
            result["Content-Disposition"] = 'inline; filename="dispute-evidence.jpg"'
            result["Accept-Ranges"] = "none"
            return result


class DisputeResponseAdmin(DisputeScopedAdmin):
    inspection_only = True
    dispute_path = "dispute_id"
    list_display = ["dispute", "created_at"]


class DisputeDecisionAdmin(DisputeResponseAdmin):
    list_display = ["dispute", "action", "created_at"]
    badge_fields = ("action",)


class ReviewScopedAdmin(AftercareAdmin):
    review_path = "pk"

    def staff_view(self, request, obj=None):
        return allowed(request, "read_review") and (
            obj is None or self.staff_queryset(request, self.model.objects.filter(pk=obj.pk)).exists()
        )

    def staff_queryset(self, request, qs):
        return qs.filter(**{self.review_path + "__in": access.review_scope(admin_actor(request)).values("pk")})


@django_admin.register(Review, site=owner_site)
class ReviewAdmin(ReviewScopedAdmin):
    list_display = ["order", "rating", "state", "workspace", "created_at"]
    list_filter = ["state", "rating"]
    search_fields = ["order__invoice__number"]
    badge_fields = ("state",)
    fields = ["order", "buyer", "rating", "text", "language", "state", "version", "event", "created_at", "workspace"]

    def get_readonly_fields(self, request, obj=None):
        return self.fields

    def workspace(self, obj):
        return format_html('<a href="{}">{}</a>', reverse("admin:orders_review_moderate", args=[obj.pk]),
                           _("Open guarded review moderation"))

    def get_urls(self):
        return [path("<uuid:pk>/moderate/", self.admin_site.admin_view(self.workflow), name="orders_review_moderate"),
                *super().get_urls()]

    @private_document
    def workflow(self, request, pk):
        from . import reviews

        if request.method not in {"GET", "HEAD", "POST"} or set(request.GET):
            raise PermissionDenied()
        actor = admin_actor(request)
        record = get_object_or_404(
            access.review_scope(actor).select_related("order__invoice", "order__buyer__user",
                                                    "order__seller__account__user", "buyer__user"), pk=pk,
        )
        audit(actor, record, "review_native_workspace")
        independent = True
        try:
            reviews.independent(record.order, actor.user, review=record)
        except APIException:
            independent = False
        choices = [("", ADMIN_COPY["payment_choose_action"])]
        if independent and "moderate_review" in access.aftercare_rights(actor):
            if record.state == "pending":
                choices += [("approve", ADMIN_COPY["payment_approve"]), ("reject", ADMIN_COPY["payment_reject"])]
            if record.state in {"pending", "approved"}:
                choices.append(("withdraw", _("Withdraw")))
        form = workspace_form(request, actor, record, choices, family="review")
        status = 200
        if request.method == "POST" and form.is_valid():
            data = {key: form.cleaned_data[key] for key in ("command_id", "action", "version", "reason")}
            data["review_version"] = form.cleaned_data["case_version"]
            try:
                reviews.moderate(actor, pk, data)
            except APIException as error:
                form.add_error(None, ADMIN_COPY["payment_changed"])
                status = error.status_code
            else:
                return HttpResponseRedirect(request.path)
        return workspace_response(
            self, request, "orders/review.html", record, form, status=status,
            title=_("Buyer review moderation"), independent=independent,
            decisions=record.decisions.order_by("-created_at", "-pk")[:20],
        )


class ReviewDecisionAdmin(ReviewScopedAdmin):
    review_path = "review_id"
    list_display = ["id", "review", "action", "created_at"]
    badge_fields = ("action",)


owner_site.register(DisputeResponse, DisputeResponseAdmin)
owner_site.register(DisputeDecision, DisputeDecisionAdmin)
owner_site.register(ReviewDecision, ReviewDecisionAdmin)
