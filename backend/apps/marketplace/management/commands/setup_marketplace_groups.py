from django.contrib.auth.models import Group, Permission
from django.contrib.contenttypes.models import ContentType
from django.core.management.base import BaseCommand
from django.db import transaction
from apps.marketplace.models import Store


class Command(BaseCommand):
    help = "Prepare explicit marketplace review groups idempotently; never assigns users."

    @transaction.atomic
    def handle(self, **options):
        content_type = ContentType.objects.get_for_model(Store)
        roles = {
            "Store queue": ["view_store_queue"],
            "Store assignment": ["view_store_queue", "assign_store_review"],
            "Store review": ["view_store_queue", "read_store_submission", "review_store"],
            "Store moderation": ["view_store_queue", "moderate_store"],
        }
        for name, codes in roles.items():
            group, _ = Group.objects.get_or_create(name="Rezayi: " + name)
            for code in codes:
                permission, _ = Permission.objects.get_or_create(content_type=content_type, codename=code, defaults={"name": code.replace("_", " ")})
                group.permissions.add(permission)
        self.stdout.write("Marketplace review groups prepared; no user assigned or activated.")
