from django.contrib.auth.models import Group, Permission
from django.core.management.base import BaseCommand
from django.db import transaction


class Command(BaseCommand):
    help = "Create the small operational permission-group foundation; no staff accounts or future workflow data."

    @transaction.atomic
    def handle(self, **options):
        for title, code in [
            ("Verification", "review_identity"),
            ("Content", "manage_content"),
            ("Payments", "review_payments"),
            ("Logistics", "manage_logistics"),
            ("Support", "handle_support"),
        ]:
            group, created = Group.objects.get_or_create(name="Rezayi: " + title)
            if created:
                group.permissions.add(Permission.objects.get(content_type__app_label="accounts", codename=code))
        self.stdout.write("Operational groups available; existing assignments unchanged.")
