from django.contrib.auth.models import Group, Permission
from django.core.management.base import BaseCommand
from django.db import transaction


class Command(BaseCommand):
    help = "Define communication roles idempotently; never assign real users."

    @transaction.atomic
    def handle(self, *args, **options):
        roles = {
            "Rezayi: Message case reviewer": ("messaging", ["read_message_case", "resolve_message_case"]),
            "Rezayi: Message case manager": (
                "messaging",
                ["read_message_case", "assign_message_case", "resolve_message_case", "reopen_message_case"],
            ),
            "Rezayi: Communication delivery": ("notifications", ["view_delivery", "retry_delivery"]),
        }
        for name, (app, codes) in roles.items():
            group, _ = Group.objects.get_or_create(name=name)
            group.permissions.set(Permission.objects.filter(content_type__app_label=app, codename__in=codes))
        self.stdout.write("Communication role definitions prepared; no users assigned.")
