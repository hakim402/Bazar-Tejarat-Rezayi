"""Permission-scoped stock inspection; all writes remain trusted service operations."""

from django.urls import reverse
from django.core.exceptions import SuspiciousOperation
from django.contrib.admin import SimpleListFilter
from django.utils.html import format_html, format_html_join
from unfold.admin import ModelAdmin
from apps.accounts.admin import owner_site
from apps.accounts.admin_access import permits
from apps.accounts.admin_display import AdminDisplayMixin
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


class InventoryAuditAdmin(AdminDisplayMixin, ModelAdmin):
    list_per_page = 30
    actions = None

    def get_readonly_fields(self, request, obj=None):
        return self.readonly_fields or [field.name for field in self.model._meta.fields]

    def get_fieldsets(self, request, obj=None):
        return [(None, {'fields': self.get_readonly_fields(request, obj), 'description': 'Authoritative stock inspection. Balances and retained ledger records change only through existing trusted inventory services and compensating operations; no generic edit/delete or invented reserve/recovery actions.'})]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    def staff_view(self, request, obj=None):
        return permits(request, 'inventory', 'view_' + self.model._meta.model_name)


class ShortageStateFilter(SimpleListFilter):
    title = 'shortage state'
    parameter_name = 'shortage_state'

    def lookups(self, request, model_admin):
        return [('open', 'Shortage'), ('recovered', 'Recovered')]

    def queryset(self, request, queryset):
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
    list_display = ['seller_identity', 'reference', 'action', 'recorded_at', 'shortage_state']
    list_filter = [ShortageStateFilter, 'operation__action', 'operation__created_at']
    search_fields = ['operation__seller__display_name', 'operation__reference', 'lines']
    ordering = ['-operation__created_at', '-pk']
    fields = ['seller_identity', 'reference', 'action', 'recorded_at', 'shortage_state', 'requested_lines', 'recovery_history']
    readonly_fields = fields
    list_select_related = ['operation__seller']

    def get_queryset(self, request):
        try:
            if not 0 <= int(request.GET.get("p", "0")) < 10000 or len(request.GET.get("q", "")) > 100:
                raise ValueError
        except ValueError:
            raise SuspiciousOperation("Invalid stock inspection filters.") from None
        return super().get_queryset(request)

    def staff_view(self, request, obj=None):
        return permits(request, 'inventory', 'read_shortages')

    def seller_identity(self, obj):
        return obj.operation.seller.display_name

    def reference(self, obj):
        return obj.operation.reference

    def action(self, obj):
        return obj.operation.action

    def recorded_at(self, obj):
        return obj.operation.created_at

    def root_shortage(self, obj):
        while obj.recovery_of_id:
            obj = obj.recovery_of
        return obj

    def shortage_state(self, obj):
        root = self.root_shortage(obj).pk
        return 'Recovered' if Recovery.objects.filter(shortage_id=root).exists() else 'Shortage'

    def requested_lines(self, obj):
        # JSON was validated by stock services. Escape every value; expose no actor/storage/contact fields.
        return format_html('<table><thead><tr><th>SKU</th><th>Unit</th><th>Requested</th><th>Available</th></tr></thead><tbody>{}</tbody></table>',
            format_html_join('', '<tr><td>{}</td><td>{}</td><td>{}</td><td>{}</td></tr>',
                ((line.get('sku', ''), line.get('unit', ''), line.get('requested', ''), line.get('available', ''))
                 for line in obj.lines)))

    def recovery_history(self, obj):
        root = self.root_shortage(obj).pk
        ids = [root]
        frontier = [root]
        while frontier:
            frontier = list(Shortage.objects.filter(recovery_of_id__in=frontier).values_list('pk', flat=True))
            ids.extend(frontier)
        attempts = Shortage.objects.filter(pk__in=ids).exclude(pk=root).select_related('operation').order_by('operation__created_at')
        links = [(reverse('admin:inventory_shortage_change', args=[root]), 'Original shortage')]
        links += [(reverse('admin:inventory_shortage_change', args=[s.pk]),
                   'Failed recovery: ' + s.operation.reference) for s in attempts]
        successful = Recovery.objects.filter(shortage_id=root).select_related('operation').first()
        # Successful operation details do not become general ledger authority. Show only narrow history.
        content = format_html_join(' · ', '<a href="{}">{}</a>', links)
        if successful:
            content = format_html('{} · Successful recovery: {} · {}', content,
                                  successful.operation.reference, successful.operation.created_at)
        return content


owner_site.register(Position, InventoryAuditAdmin, list_display=['variant', 'tracking', 'expiry_required', 'threshold', 'version'], list_filter=['tracking', 'expiry_required'], search_fields=['variant__sku'])
owner_site.register(Batch, InventoryAuditAdmin, list_display=['code', 'position', 'expires_on', 'created_at'], search_fields=['code', 'position__variant__sku'])
owner_site.register(Bucket, InventoryAuditAdmin, list_display=['position', 'batch', 'physical', 'held'], quantity_fields=['physical', 'held'], search_fields=['position__variant__sku'])
owner_site.register(Operation, InventoryAuditAdmin, list_display=['seller', 'action', 'reference', 'created_at'], list_filter=['action'], search_fields=['seller__display_name', 'reference'])
owner_site.register(Movement, InventoryAuditAdmin, list_display=['operation', 'bucket', 'physical_delta', 'held_delta', 'created_at'], quantity_fields=['physical_delta', 'held_delta'])
owner_site.register(Allocation, InventoryAuditAdmin, list_display=['operation', 'state'], list_filter=['state'], badge_fields=['state'])
owner_site.register(AllocationLine, InventoryAuditAdmin, list_display=['allocation', 'bucket', 'quantity'], quantity_fields=['quantity'])
owner_site.register(Recovery, InventoryAuditAdmin, list_display=['shortage', 'operation'])
owner_site.register(Shortage, ShortageAdmin)


class StockTransitionAdmin(InventoryAuditAdmin):
    def has_view_permission(self, request, obj=None):
        from apps.accounts.admin_access import is_owner

        return is_owner(request)

    def has_module_permission(self, request):
        return self.has_view_permission(request)


owner_site.register(StockTransition, StockTransitionAdmin)
owner_site.register(AllocationReduction, StockTransitionAdmin)
