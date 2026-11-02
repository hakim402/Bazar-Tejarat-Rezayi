"""Read-only runtime metadata, behind the existing root/admin grant boundary."""
from apps.accounts.admin import owner_site
from apps.accounts.admin_records import MetadataAdmin
from .models import Job, Scheduler, Schema, Transfer, Mutex, SearchText


class JobAdmin(MetadataAdmin):
    fields = ["key", "kind", "state", "available_at", "lease_until", "attempts", "failures", "error_code", "updated_at"]
    list_display = ["kind", "state", "available_at", "attempts", "failures", "error_code"]
    list_filter = ["kind", "state", "error_code"]


class SchedulerAdmin(MetadataAdmin):
    fields = ["name", "started_at", "completed_at", "failed_at", "lease_until", "error_code"]
    list_display = ["name", "completed_at", "failed_at", "error_code"]


class SchemaAdmin(MetadataAdmin):
    fields = ["id", "contract", "verified_at"]
    list_display = ["id", "verified_at"]


class TransferAdmin(MetadataAdmin):
    fields = ["digest", "state", "created_at", "completed_at"]
    list_display = ["state", "created_at", "completed_at"]


owner_site.register(Job, JobAdmin)
owner_site.register(Scheduler, SchedulerAdmin)
owner_site.register(Schema, SchemaAdmin)
owner_site.register(Transfer, TransferAdmin)


class MutexAdmin(MetadataAdmin):
    fields = ["name"]
    list_display = ["name"]


class SearchTextAdmin(MetadataAdmin):
    fields = ["digest"]
    list_display = ["digest"]


owner_site.register(Mutex, MutexAdmin)
owner_site.register(SearchText, SearchTextAdmin)
