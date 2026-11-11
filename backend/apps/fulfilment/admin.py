"""Safe complete native coverage with explicit recipient/financial/technical scopes."""

from django.core.exceptions import PermissionDenied
from django.urls import path, reverse
from django.utils.html import format_html
from django.utils.translation import gettext_lazy as _
from apps.accounts.admin import owner_site
from apps.accounts.admin_access import admin_actor, is_owner
from apps.organizations.admin import ReadOnlyAdmin
from apps.orders.admin import private_document
from . import models as m, access, media, native


class MetadataAdmin(ReadOnlyAdmin):
    list_per_page = 20
    actions = []
    role = "metadata"
    order_path = "order_id"

    def staff_view(self, request, obj=None):
        actor = admin_actor(request)
        codes = access.rights(actor)
        if "read_fulfilment" not in codes or self.role == "technical":
            return False
        if self.role == "recipient" and "read_recipients" not in codes:
            return False
        if self.role == "evidence" and "read_delivery_evidence" not in codes:
            return False
        if self.role == "financial" and not codes & {"confirm_delivery_payment", "correct_delivery_payment"}:
            return False
        if self.role == "logistics" and not codes & {"manage_logistics", "read_recipients"}:
            return False
        return obj is None or self.staff_queryset(request, self.model.objects.filter(pk=obj.pk)).exists()

    def staff_queryset(self, request, qs):
        actor = admin_actor(request)
        cases = access.case_scope(actor).filter(assigned_to=actor.user)
        if self.role in {"recipient", "logistics"}:
            cases = cases.filter(kind="logistics")
        if self.role in {"financial", "evidence"}:
            cases = cases.filter(kind__in=["payment", "correction"])
        return (
            qs.none() if self.role == "technical" else qs.filter(**{self.order_path + "__in": cases.values("order_id")})
        )

    def get_queryset(self, request):
        qs = super().get_queryset(request)
        if is_owner(request) and hasattr(self.model, "construction"):
            qs = self.model.construction.all()
        if self.has_view_permission(request):
            access.audit(
                admin_actor(request), self.model(), "fulfilment_native_list", "Scoped bounded native model inspection"
            )
        return qs

    def get_object(self, request, object_id, from_field=None):
        obj = super().get_object(request, object_id, from_field)
        if obj is not None:
            access.audit(admin_actor(request), obj, "fulfilment_native_metadata", "Scoped native record inspection")
        return obj

    def get_fields(self, request, obj=None):
        names = [field.name for field in self.model._meta.fields]
        if not is_owner(request):
            names = [name for name in names if name not in {"actor", "account", "creator", "key", "digest"}]
        return names

    def get_readonly_fields(self, request, obj=None):
        return self.get_fields(request, obj)

    def lookup_allowed(self, lookup, value, request=None):
        return lookup in {
            self.model._meta.pk.name,
            self.model._meta.pk.name + "__exact",
            *getattr(self, "list_filter", []),
        }


class TechnicalAdmin(MetadataAdmin):
    role = "technical"


class LogisticsAdmin(MetadataAdmin):
    role = "logistics"


class RecipientAdmin(MetadataAdmin):
    role = "recipient"
    list_display = ["id", "order", "revision", "created_at"]


class FinancialAdmin(MetadataAdmin):
    role = "financial"


class RefundAdmin(MetadataAdmin):
    refund_path = "pk"
    list_display = ["id", "order", "amount", "currency", "created_at", "workflow_link"]
    money_fields = {"amount": "currency"}

    def staff_view(self, request, obj=None):
        codes = access.rights(admin_actor(request))
        return {"read_fulfilment", "confirm_delivery_refund"} <= codes and (
            obj is None or self.staff_queryset(request, self.model.objects.filter(pk=obj.pk)).exists()
        )

    def staff_queryset(self, request, qs):
        actor = admin_actor(request)
        cases = access.case_scope(actor).filter(assigned_to=actor.user, kind="refund")
        return qs.filter(**{self.refund_path + "__in": cases.values("refund_id")})

    def get_fields(self, request, obj=None):
        return [*super().get_fields(request, obj), "workflow_link"]

    def workflow_link(self, obj):
        refund_id = obj.pk if self.refund_path == "pk" else obj.refund_id
        case = m.ReviewCase.objects.filter(refund_id=refund_id).first()
        if case is None:
            return _("Unpublished")
        return format_html(
            '<a href="{}">{}</a>', reverse("admin:fulfilment_reviewcase_review", args=[case.pk]), _("Open guarded refund review")
        )


class RefundDecisionAdmin(RefundAdmin):
    refund_path = "refund_id"
    list_display = ["id", "refund", "action", "created_at", "workflow_link"]
    money_fields = {}
    badge_fields = ("action",)


class LineAdmin(LogisticsAdmin):
    order_path = "preparation__order_id"


class PublicationAdmin(TechnicalAdmin):
    order_path = "event__order_id"


class CursorAdmin(TechnicalAdmin):
    order_path = "event__order_id"


class BindingAdmin(FinancialAdmin):
    order_path = "evidence__order_id"


class StateAdmin(MetadataAdmin):
    list_display = ["order", "version", "workflow_link", "next_check_at"]

    def get_fields(self, request, obj=None):
        return [*super().get_fields(request, obj), "workflow_link"]

    def workflow_link(self, obj):
        return format_html(
            '<a href="{}">{}</a>',
            reverse("admin:fulfilment_state_workflow", args=[obj.pk]),
            _("Delivery / fulfilment workflow"),
        )

    def get_urls(self):
        return [
            path("<uuid:pk>/workflow/", self.admin_site.admin_view(native.workflow), name="fulfilment_state_workflow"),
            path(
                "<uuid:pk>/stock-options/", self.admin_site.admin_view(native.options), name="fulfilment_state_options"
            ),
            path("<uuid:pk>/handover/", self.admin_site.admin_view(native.handover), name="fulfilment_state_handover"),
            *super().get_urls(),
        ]


class CaseAdmin(MetadataAdmin):
    list_display = ["id", "kind", "order", "state", "version", "reviewer", "workflow_link"]
    list_filter = ["kind", "state"]
    search_fields = ["id", "order__id"]
    badge_fields = ("kind", "state")

    def staff_queryset(self, request, qs):
        return qs.filter(pk__in=access.case_scope(admin_actor(request)).values("pk"))

    def get_fields(self, request, obj=None):
        return (
            [*super().get_fields(request, obj), "workflow_link"]
            if is_owner(request)
            else ["id", "kind", "order", "state", "version", "reviewer", "workflow_link", "created_at"]
        )

    def reviewer(self, obj):
        return obj.assigned_to.display_name if obj.assigned_to_id else _("Unassigned")

    def workflow_link(self, obj):
        return format_html(
            '<a href="{}">{}</a>', reverse("admin:fulfilment_reviewcase_review", args=[obj.pk]), _("Open guarded review")
        )

    def get_urls(self):
        return [
            path("<uuid:pk>/review/", self.admin_site.admin_view(self.workflow), name="fulfilment_reviewcase_review"),
            *super().get_urls(),
        ]

    def workflow(self, request, pk):
        from django.shortcuts import get_object_or_404

        case = get_object_or_404(access.case_scope(admin_actor(request)), pk=pk)
        return native.workflow(request, case.order_id, case_pk=pk)


class EvidenceAdmin(MetadataAdmin):
    role = "evidence"
    list_display = ["id", "order", "purpose", "size", "created_at"]

    def get_fields(self, request, obj=None):
        return [*super().get_fields(request, obj), "protected_image"]

    def protected_image(self, obj):
        return "Use the related claim/correction review case to open this protected image."

    def get_urls(self):
        return [
            path("<uuid:pk>/image/", self.admin_site.admin_view(self.download), name="fulfilment_evidence_bytes"),
            *super().get_urls(),
        ]

    @private_document
    def download(self, request, pk):
        if request.method not in {"GET", "HEAD"} or set(request.GET) - {"case"}:
            raise PermissionDenied()
        return media.response(admin_actor(request), pk, head=request.method == "HEAD", case=request.GET.get("case"))


for model, admin in [
    (m.State, StateAdmin),
    (m.Event, MetadataAdmin),
    (m.Publication, PublicationAdmin),
    (m.Command, TechnicalAdmin),
    (m.Provider, MetadataAdmin),
    (m.Arrangement, LogisticsAdmin),
    (m.Recipient, RecipientAdmin),
    (m.Preparation, LogisticsAdmin),
    (m.PreparationLine, LineAdmin),
    (m.PartialPermission, MetadataAdmin),
    (m.ChargeProposal, MetadataAdmin),
    (m.ChargeDecision, MetadataAdmin),
    (m.Shipment, MetadataAdmin),
    (m.Tracking, MetadataAdmin),
    (m.Delivery, MetadataAdmin),
    (m.Claim, FinancialAdmin),
    (m.ClaimDecision, FinancialAdmin),
    (m.Receipt, FinancialAdmin),
    (m.Correction, FinancialAdmin),
    (m.DeliveryRefund, RefundAdmin),
    (m.DeliveryRefundDecision, RefundDecisionAdmin),
    (m.Blocker, MetadataAdmin),
    (m.BlockerClosure, MetadataAdmin),
    (m.Completion, MetadataAdmin),
    (m.DispatchAttempt, MetadataAdmin),
    (m.ReviewCase, CaseAdmin),
    (m.CaseEvent, MetadataAdmin),
    (m.Evidence, EvidenceAdmin),
    (m.EvidenceBinding, BindingAdmin),
    (m.NoticeCursor, CursorAdmin),
]:
    owner_site.register(model, admin)
