"""Read-only audit history; immutable by design."""
from unfold.admin import ModelAdmin

from ..models import AuditEvent
from .site import owner_site


class AuditAdmin(ModelAdmin):
    list_display = ["created_at", "actor", "context", "action", "account", "request_id"]
    list_filter = ["context", "action"]
    search_fields = ["action", "request_id", "actor__email"]
    ordering = ["-created_at", "-pk"]
    list_per_page = 30
    readonly_fields = [field.name for field in AuditEvent._meta.fields]
    actions = []

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


owner_site.register(AuditEvent, AuditAdmin)