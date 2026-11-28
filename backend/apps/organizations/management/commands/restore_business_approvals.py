"""Restore retained approvals without changing accounts, products, or pending submissions."""
from django.core.files.storage import storages
from django.core.management.base import BaseCommand
from django.db import transaction

from apps.accounts.models import AuditEvent
from apps.organizations.models import BusinessProfile
from apps.organizations.profiles import PROFILE_FIELDS


def candidate(profile):
    case = profile.cases.filter(status="approved").order_by("-revision").first()
    if not case or not case.decided_at or not all(key in case.snapshot for key in PROFILE_FIELDS):
        return None
    try:
        if any(not storages[item.storage_alias].exists(item.key) for item in case.evidence.all()):
            return None
    except (OSError, ValueError):
        return None
    return case


class Command(BaseCommand):
    help = "Preview retained business approvals; --apply restores valid effective references."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true")

    def handle(self, *args, **options):
        counts = dict(eligible=0, restored=0, ambiguous=0, inactive=0)
        for pk in BusinessProfile.objects.filter(effective_case__isnull=True).values_list("pk", flat=True).iterator():
            with transaction.atomic():
                profile = BusinessProfile.objects.select_for_update().select_related("account__user").get(pk=pk)
                if profile.effective_case_id:
                    continue
                if profile.account.status != "active" or not profile.account.user.is_active or not profile.account.user.email_verified:
                    counts["inactive"] += 1
                    continue
                case = candidate(profile)
                if not case:
                    if profile.cases.filter(status="approved").exists():
                        counts["ambiguous"] += 1
                    continue
                counts["eligible"] += 1
                if options["apply"]:
                    profile.effective_case = case
                    profile.save(update_fields=["effective_case"])
                    AuditEvent.objects.create(
                        action="business_approval_restored", context="system",
                        resource_type="organizations.businessprofile", resource_id=profile.pk,
                        state={"approved_case": str(case.pk), "revision": case.revision},
                    )
                    counts["restored"] += 1
        self.stdout.write(("Applied" if options["apply"] else "Dry run") + ": " + ", ".join(f"{key}={value}" for key, value in counts.items()))
