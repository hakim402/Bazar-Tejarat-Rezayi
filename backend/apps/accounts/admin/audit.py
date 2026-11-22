"""Read-only audit history; immutable by design."""
from django.utils.translation import gettext_lazy as _
from unfold.admin import ModelAdmin
from unfold.decorators import display

from ..models import AuditEvent
from .display import record_identity, short_id
from .presentation import CONTEXT_LABELS, action_label, context_status, label
from .site import owner_site


class AuditAdmin(ModelAdmin):
    list_display = ["event", "actor_identity", "subject_identity", "audit_context", "created_at", "reference"]
    list_select_related = ["actor", "subject"]
    list_filter = ["context", "action"]
    search_fields = ["action", "request_id", "actor__email", "actor__display_name", "subject__email", "subject__display_name"]
    search_help_text = _("Search by action, request ID, name or email")
    ordering = ["-created_at", "-pk"]
    list_per_page = 30
    readonly_fields = [field.name for field in AuditEvent._meta.fields]
    fieldsets = [
        (label("Audit event"), {
            "fields": ["action", ("actor", "subject"), ("context", "account"), "created_at"],
            "description": label("Read-only record"),
        }),
        (label("Resource"), {"fields": [("resource_type", "resource_id"), ("request_id", "id")]}),
        (label("Recorded changes"), {"fields": ["reason", "changed_fields", "state"]}),
    ]
    actions = []

    @display(description=label("Audit event"), ordering="action")
    def event(self, obj):
        return record_identity(action_label(obj.action), obj.resource_type or label("Resource"), glyph="history")

    @display(description=label("Actor"), ordering="actor__display_name")
    def actor_identity(self, obj):
        return self.person(obj.actor)

    @display(description=label("Subject"), ordering="subject__display_name")
    def subject_identity(self, obj):
        return self.person(obj.subject)

    @display(description=label("Event context"), ordering="context", label=CONTEXT_LABELS)
    def audit_context(self, obj):
        return context_status(obj.context)

    @display(description=_("Request ID"), ordering="request_id")
    def reference(self, obj):
        return short_id(obj.request_id)

    def person(self, user):
        if not user:
            return "—"
        return record_identity(user.display_name or user.email, user.email, glyph="person")

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


owner_site.register(AuditEvent, AuditAdmin)
