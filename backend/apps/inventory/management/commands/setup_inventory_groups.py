"""Explicit stock queue group; never expands existing staff assignments."""

from django.contrib.auth.models import Group, Permission
from django.core.management import BaseCommand
from django.db import transaction


class Command(BaseCommand):
    help = "Prepare the explicit inventory-shortage group without assigning staff or creating stock."

    @transaction.atomic
    def handle(self, **options):
        group, created = Group.objects.get_or_create(name="Rezayi: Inventory shortages")
        if created:
            group.permissions.add(
                Permission.objects.get(content_type__app_label="inventory", codename="read_shortages")
            )
        self.stdout.write("Inventory shortage group available; existing assignments and stock unchanged.")
