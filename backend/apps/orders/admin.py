import uuid
from functools import wraps
from django.db import DatabaseError
from django.db.models import Q
from django.contrib.admin import RelatedOnlyFieldListFilter
from django import forms
from django.contrib import messages
from django.http import HttpResponse, HttpResponseRedirect, Http404
from django.shortcuts import get_object_or_404, render
from django.urls import path, reverse
from django.utils.html import format_html
from rest_framework.exceptions import APIException
from django.core.exceptions import PermissionDenied
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


def aftercare_orders(actor):
    """Every aftercare list view is bounded by orders with in-scope aftercare work."""
    if actor.context == "owner":
        return SellerOrder.objects.all()
    return SellerOrder.objects.filter(
        Q(cancellation_requests__in=access.cancellation_scope(actor))
        | Q(amendments__in=access.amendment_scope(actor))
    ).distinct()


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


class AftercareEventAdmin(AftercareAdmin):
    list_display = ["id", "order", "version", "action", "context", "created_at"]
    list_filter = ["action", "context"]


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
        return format_html(
            '<a class="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm '
            'font-semibold text-white hover:bg-primary-700" href="{}">Open guarded cancellation review</a>',
            self.review_url(obj.pk),
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
        return format_html(
            '<a class="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm '
            'font-semibold text-white hover:bg-primary-700" href="{}">Open guarded amendment review</a>',
            self.review_url(obj.pk),
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
