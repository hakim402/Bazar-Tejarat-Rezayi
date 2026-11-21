"""Permission-scoped stock inspection; all writes remain trusted service operations."""

from django.urls import reverse
from django.core.exceptions import SuspiciousOperation
from django.contrib import admin
from django.contrib.admin import SimpleListFilter
from django.utils.html import format_html
from django.utils.translation import gettext_lazy as _
from unfold.admin import ModelAdmin
from apps.accounts.admin import owner_site
from apps.accounts.admin.access import is_owner, permits
from apps.accounts.admin.display import AdminDisplayMixin
from apps.accounts.admin.display import quantity, state_badge, short_id
from apps.catalogue.admin.presentation import ProductIdentityMixin, seller_cell, compact_text
from apps.catalogue.admin.summaries import localized
from apps.catalogue.admin.helpers import panel_table, link_button
from . import services
from .queries import unresolved_shortage_roots
from .models import (
    Position,
    Batch,
    Bucket,
    Operation,
    Movement,
    Allocation,
    AllocationLine,
    Shortage,
    Recovery,
    StockTransition,
    AllocationReduction,
)


INVENTORY_ACTIONS = {
    "receive": _("Stock received"), "adjust": _("Stock adjustment"),
    "reserve": _("Stock reservation"), "cod": _("Cash on delivery reservation"),
    "release": _("Reservation released"), "consume": _("Stock consumed"),
    "reduce": _("Reservation reduced"),
}


class InventoryActionFilter(SimpleListFilter):
    title = _("Action")
    parameter_name = "stock_action"

    def lookups(self, request, model_admin):
        return [(value, INVENTORY_ACTIONS.get(value, value)) for value in
                model_admin.get_queryset(request).order_by().values_list("operation__action", flat=True).distinct()]

    def queryset(self, request, queryset):
        return queryset.filter(operation__action=self.value()) if self.value() else queryset


class InventoryAuditAdmin(AdminDisplayMixin, ModelAdmin):
    list_per_page = 30
    actions = None

    def get_readonly_fields(self, request, obj=None):
        return self.readonly_fields or [field.name for field in self.model._meta.fields]

    def get_fieldsets(self, request, obj=None):
        description = _(
            "Authoritative stock inspection. Balances and retained ledger records change only through existing trusted inventory services and compensating operations; no generic edit/delete or invented reserve/recovery actions."
        )
        return [(None, {'fields': self.get_readonly_fields(request, obj), 'description': description})]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    def staff_view(self, request, obj=None):
        return permits(request, 'inventory', 'view_' + self.model._meta.model_name)


class ShortageStateFilter(SimpleListFilter):
    title = _('Shortage status')
    parameter_name = 'shortage_state'

    def lookups(self, request, model_admin):
        states = [('open', _('Shortage')), ('recovered', _('Recovered'))]
        if is_owner(request):
            states.append(('unresolved_roots', _('Open queue')))
        return states

    def queryset(self, request, queryset):
        if self.value() == 'unresolved_roots' and is_owner(request):
            return unresolved_shortage_roots(queryset)
        if self.value() not in {'open', 'recovered'}:
            return queryset
        ids = list(Recovery.objects.values_list('shortage_id', flat=True))
        frontier = ids
        while frontier:
            frontier = list(Shortage.objects.filter(recovery_of_id__in=frontier).values_list('pk', flat=True))
            ids.extend(frontier)
        return queryset.filter(pk__in=ids) if self.value() == 'recovered' else queryset.exclude(pk__in=ids)


class ShortageAdmin(InventoryAuditAdmin):
    list_per_page = 20
    list_display = ['reference_preview', 'seller_identity', 'action', 'line_count', 'recorded_at', 'shortage_state']
    list_filter = [ShortageStateFilter, InventoryActionFilter, 'operation__created_at']
    search_fields = ['operation__seller__display_name', 'operation__seller__account__user__email', 'operation__reference', 'lines']
    search_help_text = _("Find by reference, SKU, seller or email")
    ordering = ['-operation__created_at', '-pk']
    fields = ['id', 'seller_identity', 'reference', 'action', 'recorded_at', 'shortage_state', 'line_count', 'requested_lines', 'recovery_history']
    readonly_fields = fields
    list_select_related = ['operation__seller__account__user', 'recovery_of']

    def get_queryset(self, request):
        try:
            if not 0 <= int(request.GET.get("p", "0")) < 10000 or len(request.GET.get("q", "")) > 100:
                raise ValueError
        except ValueError:
            raise SuspiciousOperation("Invalid stock inspection filters.") from None
        return super().get_queryset(request).select_related('operation__seller__account__user', 'recovery_of')

    def get_fieldsets(self, request, obj=None):
        return [
            (_("Identity"), {"fields": ['reference', 'seller_identity', 'id', 'action', 'recorded_at']}),
            (_("Stock shortage"), {"fields": ['shortage_state', 'line_count', 'requested_lines']}),
            (_("Recovery history"), {"fields": ['recovery_history'], "description": _("Recovery is recorded by the order and inventory workflows. This history cannot be edited here.")}),
        ]

    def staff_view(self, request, obj=None):
        return permits(request, 'inventory', 'read_shortages')

    @admin.display(description=_("Seller"), ordering="operation__seller__display_name")
    def seller_identity(self, obj):
        return seller_cell(obj.operation.seller)

    @admin.display(description=_("Reference"), ordering="operation__reference")
    def reference(self, obj):
        return obj.operation.reference or short_id(obj.pk)

    @admin.display(description=_("Reference"), ordering="operation__reference")
    def reference_preview(self, obj):
        return compact_text(obj.operation.reference) if obj.operation.reference else short_id(obj.pk)

    @admin.display(description=_("Action"), ordering="operation__action")
    def action(self, obj):
        return state_badge(INVENTORY_ACTIONS.get(obj.operation.action, obj.operation.action))

    @admin.display(description=_("Recorded at"), ordering="operation__created_at")
    def recorded_at(self, obj):
        return obj.operation.created_at

    def root_shortage(self, obj):
        while obj.recovery_of_id:
            obj = obj.recovery_of
        return obj

    @admin.display(description=_("Shortage status"))
    def shortage_state(self, obj):
        root = self.root_shortage(obj).pk
        return state_badge("recovered" if Recovery.objects.filter(shortage_id=root).exists() else "shortage")

    @admin.display(description=_("Affected items"))
    def line_count(self, obj):
        return len(obj.lines)

    @admin.display(description=_("Requested stock"))
    def requested_lines(self, obj):
        # JSON was validated by stock services. Escape every value; expose no actor/storage/contact fields.
        return panel_table([_("SKU"), _("Sale unit"), _("Requested"), _("Available")],
            [[line.get('sku', '—'), localized(line.get('unit_labels'), line.get('unit', '—')),
              quantity(line.get('requested')), quantity(line.get('available'))] for line in obj.lines], _("No shortage items."))

    @admin.display(description=_("Recovery history"))
    def recovery_history(self, obj):
        original = self.root_shortage(obj)
        root = original.pk
        ids = [root]
        frontier = [root]
        while frontier:
            frontier = list(Shortage.objects.filter(recovery_of_id__in=frontier).values_list('pk', flat=True))
            ids.extend(frontier)
        attempts = Shortage.objects.filter(pk__in=ids).exclude(pk=root).select_related('operation').order_by('operation__created_at')
        rows = [[link_button(reverse('admin:inventory_shortage_change', args=[root]), _("Original shortage")),
                 state_badge("shortage"), original.operation.reference or "—", original.operation.created_at]]
        rows += [[link_button(reverse('admin:inventory_shortage_change', args=[s.pk]), _("Recovery attempt")),
                  state_badge("failed"), s.operation.reference or "—", s.operation.created_at] for s in attempts]
        successful = Recovery.objects.filter(shortage_id=root).select_related('operation').first()
        # Successful operation details do not become general ledger authority. Show only narrow history.
        if successful:
            rows.append([_("Successful recovery"), state_badge("recovered"), successful.operation.reference or "—", successful.operation.created_at])
        return panel_table([_("Record"), _("Status"), _("Reference"), _("Recorded at")], rows, "")


class PositionAdmin(ProductIdentityMixin, InventoryAuditAdmin):
    product_path = "variant__product"
    list_display = ["product_identity", "sku", "seller_identity", "sale_unit", "tracking_method", "stock_on_hand", "reserved", "available", "stock_threshold"]
    list_filter = ["tracking", "expiry_required"]
    search_fields = ["variant__sku", "variant__product__seller__display_name", "variant__product__seller__account__user__email", "variant__product__revisions__body__title"]
    search_help_text = _("Find by product name, SKU, seller or email")
    quantity_fields = ["threshold"]
    def get_queryset(self, request):
        return super().get_queryset(request).select_related(
            "variant__product__seller", "variant__product__published", "variant__unit",
        ).prefetch_related("buckets__batch")

    def sku(self, obj):
        return obj.variant.sku

    sku.short_description = _("SKU")
    sku.admin_order_field = "variant__sku"

    def sale_unit(self, obj):
        return localized(obj.variant.unit.labels, obj.variant.unit_id)

    sale_unit.short_description = _("Sale unit")

    def stock_threshold(self, obj):
        return quantity(obj.threshold)

    stock_threshold.short_description = _("Low stock threshold")
    stock_threshold.admin_order_field = "threshold"

    def tracking_method(self, obj):
        return _("Batch stock") if obj.tracking == "batch" else _("Standard stock")

    tracking_method.short_description = _("Stock tracking")
    tracking_method.admin_order_field = "tracking"

    def get_fieldsets(self, request, obj=None):
        return [
            (_("Identity"), {"fields": ["product_identity", "sku", "seller_identity", "sale_unit", "version"]}),
            (_("Stock balances"), {"fields": ["stock_on_hand", "reserved", "available", "stock_threshold"]}),
            (_("Stock tracking"), {"fields": ["tracking_method", "expiry_required"]}),
        ]

    def seller(self, obj):
        return obj.variant.product.seller.display_name

    seller.short_description = _("Seller")
    seller.admin_order_field = "variant__product__seller__display_name"

    def stock_on_hand(self, obj):
        return quantity(sum(bucket.physical for bucket in obj.buckets.all()))

    stock_on_hand.short_description = _("On hand")

    def reserved(self, obj):
        return quantity(sum(bucket.held for bucket in obj.buckets.all()))

    reserved.short_description = _("Reserved")

    def available(self, obj):
        if not services.active(obj.variant):
            return quantity(0)
        return quantity(sum(bucket.physical - bucket.held for bucket in obj.buckets.all() if not services.expired(bucket)))

    available.short_description = _("Available")

    def get_readonly_fields(self, request, obj=None):
        return [*super().get_readonly_fields(request, obj), "product_identity", "sku", "seller_identity", "sale_unit", "tracking_method", "stock_threshold", "stock_on_hand", "reserved", "available"]


class BatchAdmin(ProductIdentityMixin, InventoryAuditAdmin):
    product_path = "position__variant__product"
    list_display = ["product_identity", "batch_label", "seller_identity", "sale_unit", "expires_on", "expiry_status", "on_hand", "reserved_stock", "available_stock"]
    list_filter = ["expires_on", "created_at"]
    search_fields = ["code", "position__variant__sku", "position__variant__product__revisions__body__title", "position__variant__product__seller__display_name", "position__variant__product__seller__account__user__email"]
    search_help_text = _("Find by batch number, product, SKU, seller or email")
    ordering = ["-created_at", "-pk"]
    readonly_fields = ["id", "code", "product_identity", "seller_identity", "sale_unit", "expires_on", "created_at", "expiry_status", "on_hand", "reserved_stock", "available_stock", "related_records"]

    def get_queryset(self, request):
        return super().get_queryset(request).select_related("bucket", "position__variant__unit", "position__variant__product__published")

    def get_fieldsets(self, request, obj=None):
        return [
            (_("Identity"), {"fields": ["product_identity", "seller_identity", "code", "id", "sale_unit", "created_at"]}),
            (_("Expiry"), {"fields": ["expires_on", "expiry_status"]}),
            (_("Current stock"), {"fields": ["on_hand", "reserved_stock", "available_stock"], "description": _("Current balances for this batch. Stock changes are recorded through inventory operations.")}),
            (_("Related records"), {"fields": ["related_records"]}),
        ]

    @admin.display(description=_("Sale unit"))
    def sale_unit(self, obj):
        return localized(obj.position.variant.unit.labels, obj.position.variant.unit_id)

    @admin.display(description=_("Batch number"), ordering="code")
    def batch_label(self, obj):
        return compact_text(obj.code)

    @admin.display(description=_("Expiry status"))
    def expiry_status(self, obj):
        if not obj.expires_on:
            return state_badge("no_expiry")
        if obj.expires_on < services.today():
            return state_badge("expired")
        bucket = getattr(obj, "bucket", None)
        return state_badge("expiring" if bucket and services.expiring(bucket) else "valid")

    @admin.display(description=_("On hand"))
    def on_hand(self, obj):
        bucket = getattr(obj, "bucket", None)
        return quantity(bucket.physical if bucket else None)

    @admin.display(description=_("Reserved"))
    def reserved_stock(self, obj):
        bucket = getattr(obj, "bucket", None)
        return quantity(bucket.held if bucket else None)

    @admin.display(description=_("Available"))
    def available_stock(self, obj):
        bucket = getattr(obj, "bucket", None)
        if bucket is None:
            return quantity(None)
        return quantity(bucket.physical - bucket.held if services.active(obj.position.variant) and not services.expired(bucket) else 0)

    @admin.display(description=_("Related records"))
    def related_records(self, obj):
        stock = link_button(reverse("admin:inventory_position_change", args=[obj.position_id]), _("View stock position"), "inventory")
        bucket = getattr(obj, "bucket", None)
        movements = link_button(reverse("admin:inventory_movement_changelist") + f"?bucket__id__exact={bucket.pk}", _("View stock movements"), "swap_horiz") if bucket else ""
        return format_html('<div class="flex flex-wrap gap-2">{}{}</div>', stock, movements)


class MovementAdmin(ProductIdentityMixin, InventoryAuditAdmin):
    product_path = "bucket__position__variant__product"
    list_display = ["product_identity", "seller_identity", "sale_unit", "operation_type", "reference_preview", "batch_preview", "stock_change", "reservation_change", "created_at"]
    list_filter = [InventoryActionFilter, "created_at"]
    search_fields = ["operation__reference", "bucket__batch__code", "bucket__position__variant__sku", "bucket__position__variant__product__revisions__body__title", "operation__seller__display_name", "operation__seller__account__user__email"]
    search_help_text = _("Find by reference, batch number, SKU, seller or email")
    ordering = ["-created_at", "-pk"]
    readonly_fields = ["id", "product_identity", "seller_identity", "sale_unit", "operation_type", "reference", "batch_number", "created_at", "stock_change", "reservation_change", "stock_after", "reserved_after", "reason", "related_records"]

    def get_queryset(self, request):
        return super().get_queryset(request).select_related("operation", "bucket__batch", "bucket__position__variant__unit")

    def get_fieldsets(self, request, obj=None):
        return [
            (_("Identity"), {"fields": ["product_identity", "seller_identity", "sale_unit", "batch_number", "id"]}),
            (_("Stock movement"), {"fields": ["operation_type", "reference", "created_at", "reason"]}),
            (_("Recorded quantities"), {"fields": ["stock_change", "reservation_change", "stock_after", "reserved_after"], "description": _("Balances immediately after this movement. These are historical values, not current stock.")}),
            (_("Related records"), {"fields": ["related_records"]}),
        ]

    @admin.display(description=_("Action"), ordering="operation__action")
    def operation_type(self, obj):
        return state_badge(INVENTORY_ACTIONS.get(obj.operation.action, obj.operation.action))

    @admin.display(description=_("Reference"), ordering="operation__reference")
    def reference(self, obj):
        return obj.operation.reference or short_id(obj.operation_id)

    @admin.display(description=_("Reference"), ordering="operation__reference")
    def reference_preview(self, obj):
        return compact_text(obj.operation.reference) if obj.operation.reference else short_id(obj.operation_id)

    @admin.display(description=_("Batch number"), ordering="bucket__batch__code")
    def batch_number(self, obj):
        return obj.bucket.batch.code if obj.bucket.batch_id else _("Standard stock")

    @admin.display(description=_("Batch number"), ordering="bucket__batch__code")
    def batch_preview(self, obj):
        return compact_text(self.batch_number(obj))

    @admin.display(description=_("Sale unit"))
    def sale_unit(self, obj):
        unit = obj.bucket.position.variant.unit
        return localized(unit.labels, unit.code)

    @admin.display(description=_("Stock change"), ordering="physical_delta")
    def stock_change(self, obj):
        return quantity(obj.physical_delta)

    @admin.display(description=_("Reservation change"), ordering="held_delta")
    def reservation_change(self, obj):
        return quantity(obj.held_delta)

    @admin.display(description=_("Stock after movement"))
    def stock_after(self, obj):
        return quantity(obj.physical_after)

    @admin.display(description=_("Reserved after movement"))
    def reserved_after(self, obj):
        return quantity(obj.held_after)

    @admin.display(description=_("Reason"))
    def reason(self, obj):
        return obj.operation.reason or "—"

    @admin.display(description=_("Related records"))
    def related_records(self, obj):
        stock = link_button(reverse("admin:inventory_position_change", args=[obj.bucket.position_id]), _("View stock position"), "inventory")
        batch = link_button(reverse("admin:inventory_batch_change", args=[obj.bucket.batch_id]), _("View batch"), "layers") if obj.bucket.batch_id else ""
        return format_html('<div class="flex flex-wrap gap-2">{}{}</div>', stock, batch)


owner_site.register(Position, PositionAdmin)
owner_site.register(Batch, BatchAdmin)
owner_site.register(Bucket, InventoryAuditAdmin, list_display=['position', 'batch', 'physical', 'held'], quantity_fields=['physical', 'held'], search_fields=['position__variant__sku'])
owner_site.register(Operation, InventoryAuditAdmin, list_display=['seller', 'action', 'reference', 'created_at'], list_filter=['action'], search_fields=['seller__display_name', 'reference'])
owner_site.register(Movement, MovementAdmin)
owner_site.register(Allocation, InventoryAuditAdmin, list_display=['operation', 'state'], list_filter=['state'], badge_fields=['state'])
owner_site.register(AllocationLine, InventoryAuditAdmin, list_display=['allocation', 'bucket', 'quantity'], quantity_fields=['quantity'])
owner_site.register(Recovery, InventoryAuditAdmin, list_display=['shortage', 'operation'])
owner_site.register(Shortage, ShortageAdmin)


class StockTransitionAdmin(InventoryAuditAdmin):
    def has_view_permission(self, request, obj=None):
        return is_owner(request)

    def has_module_permission(self, request):
        return self.has_view_permission(request)


owner_site.register(StockTransition, StockTransitionAdmin)
owner_site.register(AllocationReduction, StockTransitionAdmin)
