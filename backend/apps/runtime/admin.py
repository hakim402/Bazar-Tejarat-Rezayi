"""Read-only runtime metadata, behind the existing root/admin grant boundary.

Every listing leads with the state an operator needs (state, next execution,
attempts, failures) and keeps locks, digests and schema metadata secondary.
These pages never run, retry, clear or reschedule anything.
"""
from django.contrib.admin import SimpleListFilter
from django.utils import timezone
from django.utils.html import format_html_join
from django.utils.translation import gettext_lazy as _
from unfold.decorators import display

from apps.accounts.admin import owner_site
from apps.accounts.admin.display import record_identity, short_id
from apps.accounts.admin.presentation import label
from apps.accounts.admin.records import MetadataAdmin
from .jobs import overdue_jobs
from .models import Job, Scheduler, Schema, Transfer, Mutex, SearchText


JOB_TONES = {"queued": "warning", "running": "info", "done": "success", "failed": "danger"}
JOB_LABELS = {
    "queued": label("Queued"), "running": label("Running"),
    "done": label("Done"), "failed": label("Failed"),
}
SCHEDULER_TONES = {"idle": "default", "running": "info", "completed": "success", "failed": "danger"}
TRANSFER_TONES = {"loading": "info", "validated": "info", "complete": "success"}


def error_label(value):
    """Safe, readable description of a recorded error code."""
    code = str(value or "").strip()
    if not code:
        return "—"
    return label(code.replace("_", " ").capitalize())


class JobAttentionFilter(SimpleListFilter):
    title = _("Attention")
    parameter_name = "attention"

    def lookups(self, request, model_admin):
        from apps.accounts.admin.review_queues import review_labels

        return (("overdue", review_labels()["overdue_jobs"]),)

    def queryset(self, request, queryset):
        return queryset.filter(overdue_jobs(timezone.now())) if self.value() == "overdue" else queryset


class RuntimeAdmin(MetadataAdmin):
    """Runtime diagnostics: readable state first, technical identifiers second."""

    restriction_reason = (
        "Read-only runtime diagnostics. Jobs, schedulers, transfers and locks change only through "
        "the existing worker and service commands; this page never runs, retries, clears or reschedules anything."
    )
    primary_fields = ()
    technical_fields = ()

    def get_fieldsets(self, request, obj=None):
        return [
            (label("Runtime state"), {"fields": list(self.primary_fields)}),
            (label("Technical record"), {"fields": list(self.technical_fields), "description": self.restriction_reason}),
        ]


class JobAdmin(RuntimeAdmin):
    fields = ["job_identity", "job_state", "next_execution", "attempts", "failures",
              "key", "kind", "resource", "period", "state", "available_at", "lease",
              "lease_until", "error_code", "updated_at"]
    primary_fields = ["job_identity", "job_state", "next_execution", "attempts", "failures"]
    technical_fields = ["key", "kind", "resource", "period", "state", "available_at",
                        "lease", "lease_until", "error_code", "updated_at"]
    list_display = ["job_identity", "job_state", "next_execution", "attempts", "failures", "error_summary"]
    list_filter = [JobAttentionFilter, "kind", "state", "error_code"]
    ordering = ["available_at"]

    @display(description=label("Job"), ordering="kind")
    def job_identity(self, obj):
        return record_identity(label(obj.kind.replace("_", " ")), obj.key, glyph="schedule")

    @display(description=label("State"), ordering="state", label=JOB_TONES)
    def job_state(self, obj):
        return obj.state, JOB_LABELS.get(obj.state, obj.state)

    @display(description=label("Next execution"), ordering="available_at")
    def next_execution(self, obj):
        return obj.available_at

    @display(description=label("Error"), ordering="error_code")
    def error_summary(self, obj):
        return error_label(obj.error_code)


class SchedulerAdmin(RuntimeAdmin):
    fields = ["scheduler_name", "scheduler_state", "started_at", "completed_at", "failed_at",
              "name", "lease", "lease_until", "error_code"]
    primary_fields = ["scheduler_name", "scheduler_state", "started_at", "completed_at", "failed_at"]
    technical_fields = ["name", "lease", "lease_until", "error_code"]
    list_display = ["scheduler_name", "scheduler_state", "started_at", "completed_at", "failed_at", "error_summary"]

    @display(description=label("Scheduler"), ordering="name")
    def scheduler_name(self, obj):
        return record_identity(label("Background scheduler"), obj.name, glyph="schedule")

    @display(description=label("State"), ordering="completed_at", label=SCHEDULER_TONES)
    def scheduler_state(self, obj):
        if obj.failed_at and (not obj.completed_at or obj.failed_at >= obj.completed_at):
            return "failed", label("Failed")
        if obj.completed_at:
            return "completed", label("Completed")
        if obj.started_at:
            return "running", label("Running")
        return "idle", label("Idle")

    @display(description=label("Error"), ordering="error_code")
    def error_summary(self, obj):
        return error_label(obj.error_code)


class SchemaAdmin(RuntimeAdmin):
    fields = ["contract", "guard_count", "verified_at", "id", "guards"]
    primary_fields = ["contract", "guard_count", "verified_at"]
    technical_fields = ["id", "guards"]
    list_display = ["contract", "guard_count", "verified_at"]

    @display(description=label("Contract"), ordering="contract")
    def contract(self, obj):
        return record_identity(obj.contract, label("Schema contract"), glyph="schema")

    @display(description=label("Guards"))
    def guard_count(self, obj):
        guards = obj.guards if isinstance(obj.guards, dict) else {}
        return len(guards)


class TransferAdmin(RuntimeAdmin):
    fields = ["digest", "transfer_state", "transfer_progress", "created_at", "completed_at",
              "state", "manifest"]
    primary_fields = ["digest", "transfer_state", "transfer_progress", "created_at", "completed_at"]
    technical_fields = ["state", "manifest"]
    list_display = ["digest", "transfer_state", "transfer_progress", "created_at", "completed_at"]

    @display(description=label("Transfer"), ordering="digest")
    def digest(self, obj):
        return record_identity(label("Runtime transfer"), obj.digest, glyph="sync")

    @display(description=label("State"), ordering="state", label=TRANSFER_TONES)
    def transfer_state(self, obj):
        return obj.state, label(obj.state.replace("_", " ").capitalize())

    @display(description=label("Progress"))
    def transfer_progress(self, obj):
        progress = obj.progress if isinstance(obj.progress, dict) else {}
        if not progress:
            return "—"
        rows = [(str(key), str(value)) for key, value in list(progress.items())[:6]]
        return format_html_join("", '<p class="text-xs"><span class="font-medium">{}</span> {}</p>', rows)


class MutexAdmin(RuntimeAdmin):
    fields = ["lock_reference"]
    primary_fields = ["lock_reference"]
    technical_fields = []
    list_display = ["lock_reference"]

    @display(description=label("Lock"), ordering="name")
    def lock_reference(self, obj):
        return short_id(obj.name)


class SearchTextAdmin(RuntimeAdmin):
    fields = ["search_identity", "digest"]
    primary_fields = ["search_identity"]
    technical_fields = ["digest"]
    list_display = ["search_identity"]

    @display(description=label("Search text"), ordering="normalized")
    def search_identity(self, obj):
        return record_identity(obj.normalized, obj.digest, glyph="search")


owner_site.register(Job, JobAdmin)
owner_site.register(Scheduler, SchedulerAdmin)
owner_site.register(Schema, SchemaAdmin)
owner_site.register(Transfer, TransferAdmin)
owner_site.register(Mutex, MutexAdmin)
owner_site.register(SearchText, SearchTextAdmin)
