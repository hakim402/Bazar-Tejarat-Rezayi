"""Standard readonly native coverage and one necessary independent-review workspace."""

import uuid
from django import forms
from django.core.exceptions import PermissionDenied
from django.http import HttpResponseRedirect
from django.shortcuts import get_object_or_404, render
from django.urls import path, reverse
from django.utils.html import format_html
from rest_framework.exceptions import APIException
from unfold.widgets import UnfoldAdminSelectWidget, UnfoldAdminTextareaWidget
from apps.accounts.admin import owner_site
from apps.accounts.admin_copy import COPY as ADMIN_COPY
from apps.accounts.admin_access import admin_actor, is_owner
from apps.accounts.models import User, AuditEvent
from apps.organizations.admin import ReadOnlyAdmin
from apps.orders.admin import private_document
from . import models as m, access, queries, services, media


def assigned_orders(actor):
    return access.case_scope(actor).filter(assigned_to=actor.user).values("order_id")


class PaymentAdmin(ReadOnlyAdmin):
    list_per_page = 20
    actions = []
    technical = False
    order_path = "order_id"

    def staff_view(self, request, obj=None):
        actor = admin_actor(request)
        if self.technical:
            return False
        if "read_payments" not in access.rights(actor):
            return False
        return obj is None or self.staff_queryset(request, self.model.objects.filter(pk=obj.pk)).exists()

    def staff_queryset(self, request, qs):
        if self.technical:
            return qs.none()
        return qs.filter(**{self.order_path + "__in": assigned_orders(admin_actor(request))})

    def get_queryset(self, request):
        qs = super().get_queryset(request)
        if is_owner(request) and hasattr(self.model, "construction"):
            qs = self.model.construction.all()
        if self.has_view_permission(request) and not getattr(request, "_payment_list_audited", False):
            actor = admin_actor(request)
            AuditEvent.objects.create(
                actor=actor.user,
                account=access.account_for(actor),
                context=actor.context,
                action="payment_native_list",
                resource_type=self.model._meta.label_lower,
                reason="Bounded scoped payment metadata",
                state={},
            )
            request._payment_list_audited = True
        return qs

    def get_object(self, request, object_id, from_field=None):
        obj = super().get_object(request, object_id, from_field)
        if obj is not None:
            access.audit(admin_actor(request), obj, "payment_native_metadata")
        return obj

    def lookup_allowed(self, lookup, value, request=None):
        return lookup in {
            self.model._meta.pk.name,
            self.model._meta.pk.name + "__exact",
            *getattr(self, "list_filter", []),
        }


class FinanceAdmin(PaymentAdmin):
    list_display = ["order", "version", "next_check_at"]


class ClaimAdmin(PaymentAdmin):
    list_display = ["id", "order", "amount", "currency", "paid_at"]


class ReceiptAdmin(PaymentAdmin):
    list_display = ["id", "order", "amount", "currency", "paid_at"]


class CorrectionAdmin(PaymentAdmin):
    order_path = "receipt__order_id"
    list_display = ["id", "receipt", "target_version", "amount", "created_at"]


class PlanLineAdmin(PaymentAdmin):
    order_path = "plan__order_id"


class ClaimDecisionAdmin(PaymentAdmin):
    order_path = "claim__order_id"


class ReceiptSealAdmin(PaymentAdmin):
    order_path = "receipt__order_id"


class PlanSealAdmin(PaymentAdmin):
    order_path = "plan__order_id"


class AttemptAdmin(PaymentAdmin):
    order_path = "intent__order_id"


class BindingAdmin(PaymentAdmin):
    order_path = "evidence__order_id"


class CaseEventAdmin(PaymentAdmin):
    order_path = "case__order_id"


class TechnicalAdmin(PaymentAdmin):
    technical = True


class ReviewerChoice(forms.ModelChoiceField):
    def label_from_instance(self, obj):
        return obj.display_name or str(obj.pk)


class CaseForm(forms.Form):
    command_id = forms.UUIDField(widget=forms.HiddenInput)
    version = forms.IntegerField(min_value=0, widget=forms.HiddenInput)
    case_version = forms.IntegerField(min_value=1, widget=forms.HiddenInput)
    action = forms.ChoiceField(label=ADMIN_COPY["payment_action"], choices=[], widget=UnfoldAdminSelectWidget)
    assigned_to = ReviewerChoice(
        label=ADMIN_COPY["payment_assignee"],
        queryset=User.objects.none(),
        required=False,
        widget=UnfoldAdminSelectWidget,
    )
    reason = forms.CharField(
        label=ADMIN_COPY["payment_reason"],
        min_length=3,
        max_length=1000,
        widget=UnfoldAdminTextareaWidget(attrs={"rows": 3}),
    )


class CaseAdmin(PaymentAdmin):
    list_display = ["id", "kind", "order", "state", "version", "reviewer", "workspace"]
    list_filter = ["kind", "state", "overdue_active"]
    fields = [
        "id",
        "kind",
        "order",
        "state",
        "version",
        "generation",
        "overdue_active",
        "reviewer",
        "workspace",
        "created_at",
    ]
    search_fields = ["id", "order__id"]

    def get_readonly_fields(self, request, obj=None):
        return self.fields

    def reviewer(self, obj):
        return obj.assigned_to.display_name if obj.assigned_to_id else ADMIN_COPY["payment_unassigned"]

    def workspace(self, obj):
        return format_html(
            '<a href="{}">{}</a>',
            reverse("admin:payments_reviewcase_workflow", args=[obj.pk]),
            ADMIN_COPY["payment_open_review"],
        )

    def staff_queryset(self, request, qs):
        return qs.filter(pk__in=access.case_scope(admin_actor(request)).values("pk"))

    def get_urls(self):
        return [
            path("<uuid:pk>/review/", self.admin_site.admin_view(self.workflow), name="payments_reviewcase_workflow"),
            *super().get_urls(),
        ]

    @private_document
    def workflow(self, request, pk):
        actor = admin_actor(request)
        case = get_object_or_404(
            access.case_scope(actor).select_related(
                "order__invoice", "order__buyer__user", "order__seller__account__user", "correction__receipt", "plan"
            ),
            pk=pk,
        )
        if request.method not in {"GET", "HEAD", "POST"}:
            raise PermissionDenied()
        if set(request.GET) - {"page"}:
            raise PermissionDenied()
        raw = request.GET.get("page", "1")
        if not raw.isdigit() or not 1 <= int(raw) <= 10000:
            raise PermissionDenied()
        page = int(raw)
        access.audit(actor, case, "payment_case_workspace")
        codes = access.rights(actor)
        can_inspect = actor.context == "owner" or case.assigned_to_id == actor.user.pk
        choices = [("", ADMIN_COPY["payment_choose_action"])]
        if "assign_payment_case" in codes:
            choices.append(("assign", ADMIN_COPY["payment_assign"]))
        required = {
            "receipt": "review_payment",
            "correction": "decide_payment_correction",
            "replacement": "decide_payment_shortage",
            "shortage": "decide_payment_shortage",
        }.get(case.kind, "review_overdue")
        independent = True
        try:
            access.independent(case.order, actor.user)
        except APIException:
            independent = False
        if case.state == "open" and case.assigned_to_id == actor.user.pk and required in codes and independent:
            actions = (
                [("approve", ADMIN_COPY["payment_approve"]), ("reject", ADMIN_COPY["payment_reject"])]
                if case.kind in {"receipt", "correction", "replacement"}
                else [("resolve", ADMIN_COPY["payment_resolve"]), ("refer", ADMIN_COPY["payment_refer"])]
            )
            if (
                case.kind == "shortage"
                and not m.AllocationIntent.objects.filter(order=case.order, allocation__isnull=False).exists()
            ):
                actions.insert(0, ("replenish", ADMIN_COPY["payment_replenish"]))
            choices += actions
        projection = queries.projection(case.order)
        form = CaseForm(
            request.POST if request.method == "POST" else None,
            initial={
                "command_id": uuid.uuid4(),
                "version": projection["version"],
                "case_version": case.version,
                "assigned_to": case.assigned_to_id,
            },
        )
        form.fields["action"].choices = choices
        form.fields["assigned_to"].queryset = User.objects.filter(pk__in=[x.pk for x in services.reviewers(case)])
        if "assign_payment_case" not in codes:
            form.fields.pop("assigned_to")
        status = 200
        if request.method == "POST" and form.is_valid():
            data = form.cleaned_data.copy()
            if data.get("assigned_to"):
                data["assigned_to"] = data["assigned_to"].pk
            try:
                services.decide(actor, pk, data)
            except APIException as error:
                form.add_error(None, ADMIN_COPY["payment_changed"])
                status = error.status_code
            else:
                return HttpResponseRedirect(request.path)
        detail = queries.detail(actor, case.order_id, page=page) if can_inspect else None
        images = []
        if can_inspect and "read_payment_evidence" in codes:
            for image in m.Evidence.objects.filter(order=case.order, binding__isnull=False).order_by(
                "created_at", "pk"
            )[(page - 1) * 60 : page * 60]:
                images.append(
                    {
                        "id": image.pk,
                        "url": reverse("admin:payments_evidence_bytes", args=[image.pk]) + f"?case={case.pk}",
                    }
                )
        before = None
        if can_inspect and case.correction_id:
            before = queries.before_correction(case.correction)
        plans = queries.plan_lines(case.plan) if can_inspect and case.plan_id else []
        target_receipt = (
            m.Receipt.objects.filter(pk=case.receipt_id).first() if can_inspect and case.kind == "receipt" else None
        )
        response = render(
            request,
            "payments/review.html",
            {
                **self.admin_site.each_context(request),
                "title": ADMIN_COPY["payment_title"],
                "opts": m.ReviewCase._meta,
                "case": case,
                "form": form,
                "detail": detail,
                "projection": projection if can_inspect else None,
                "images": images,
                "before": before,
                "plan_lines": plans,
                "target_receipt": target_receipt,
                "independent": independent,
                "page": page,
                "next_page": page + 1,
            },
            status=status,
        )
        response["Cache-Control"] = "private, no-store"
        # HTML form navigation needs a same-origin Origin/Referer for CSRF.
        # Evidence responses retain their separate no-referrer policy.
        response["Referrer-Policy"] = "same-origin"
        return response


class EvidenceAdmin(PaymentAdmin):
    fields = [
        "id",
        "order",
        "creator",
        "size",
        "width",
        "height",
        "sha256",
        "expires_at",
        "created_at",
        "protected_image",
    ]
    list_display = ["id", "order", "size", "created_at"]

    def get_readonly_fields(self, request, obj=None):
        return self.fields

    def staff_view(self, request, obj=None):
        return "read_payment_evidence" in access.rights(admin_actor(request)) and super().staff_view(request, obj)

    def get_object(self, request, object_id, from_field=None):
        obj = super().get_object(request, object_id, from_field)
        if obj is not None and not is_owner(request):
            obj._payment_case_id = (
                access.case_scope(admin_actor(request))
                .filter(order_id=obj.order_id, assigned_to=request.user)
                .values_list("pk", flat=True)
                .first()
            )
        return obj

    def protected_image(self, obj):
        return format_html(
            '<a href="{}" rel="noreferrer">{}</a>',
            reverse("admin:payments_evidence_bytes", args=[obj.pk])
            + (f"?case={obj._payment_case_id}" if getattr(obj, "_payment_case_id", None) else ""),
            ADMIN_COPY["payment_image"],
        )

    def get_urls(self):
        return [
            path("<uuid:pk>/image/", self.admin_site.admin_view(self.download), name="payments_evidence_bytes"),
            *super().get_urls(),
        ]

    @private_document
    def download(self, request, pk):
        if request.method not in {"GET", "HEAD"}:
            raise PermissionDenied()
        if set(request.GET) - {"case"}:
            raise PermissionDenied()
        return media.response(admin_actor(request), pk, head=request.method == "HEAD", case=request.GET.get("case"))


class DeliveryAdmin(PaymentAdmin):
    """Assigned delivery diagnostics are separate from financial/evidence authority."""

    safe_fields = [
        "id",
        "order",
        "generation",
        "slot",
        "status",
        "attempts",
        "due_at",
        "lease_until",
        "version",
        "created_at",
    ]

    def staff_view(self, request, obj=None):
        return "read_payment_delivery" in access.rights(admin_actor(request)) and super().staff_view(request, obj)

    def get_fields(self, request, obj=None):
        return super().get_fields(request, obj) if is_owner(request) else self.safe_fields


class DeliveryAttemptAdmin(DeliveryAdmin):
    order_path = "email__order_id"
    safe_fields = ["id", "email", "status", "code", "created_at"]


for model, admin in [
    (m.Finance, FinanceAdmin),
    (m.Claim, ClaimAdmin),
    (m.ClaimDecision, ClaimDecisionAdmin),
    (m.Receipt, ReceiptAdmin),
    (m.ReceiptSeal, ReceiptSealAdmin),
    (m.Correction, CorrectionAdmin),
    (m.Extension, PaymentAdmin),
    (m.StockPlan, PaymentAdmin),
    (m.StockPlanLine, PlanLineAdmin),
    (m.StockPlanSeal, PlanSealAdmin),
    (m.AllocationIntent, PaymentAdmin),
    (m.AllocationAttempt, AttemptAdmin),
    (m.ReviewCase, CaseAdmin),
    (m.CaseEvent, CaseEventAdmin),
    (m.Evidence, EvidenceAdmin),
    (m.EvidenceBinding, BindingAdmin),
    (m.Event, PaymentAdmin),
    (m.Command, TechnicalAdmin),
    (m.NoticeCursor, TechnicalAdmin),
    (m.Email, DeliveryAdmin),
    (m.EmailAttempt, DeliveryAttemptAdmin),
    (m.SweepCursor, TechnicalAdmin),
    (m.Reminder, TechnicalAdmin),
]:
    owner_site.register(model, admin)
