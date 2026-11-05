"""Explicit role definitions only; never assigns or provisions real users."""

from django.core.management import BaseCommand, CommandError
from django.contrib.auth.models import Group, Permission
from django.db import transaction

ROLES = {
    "Delivery metadata": ["read_fulfilment"],
    "Delivery assignment": ["read_fulfilment", "assign_fulfilment"],
    "Delivery logistics": ["read_fulfilment", "manage_logistics", "confirm_delivery"],
    "Delivery recipients": ["read_fulfilment", "read_recipients", "print_handover"],
    "Delivery charge review": ["read_fulfilment", "finalize_delivery_charge"],
    "Delivery receipt review": ["read_fulfilment", "confirm_delivery_payment", "read_delivery_evidence"],
    "Delivery receipt corrections": ["read_fulfilment", "correct_delivery_payment", "read_delivery_evidence"],
    "Delivery operational holds": ["read_fulfilment", "manage_delivery_holds"],
}


class Command(BaseCommand):
    help = "Prepare scoped delivery groups; no user assignments are changed."

    @transaction.atomic
    def handle(self, **options):
        for name, codes in ROLES.items():
            permissions = Permission.objects.filter(content_type__app_label="fulfilment", codename__in=codes)
            if set(permissions.values_list("codename", flat=True)) != set(codes):
                raise CommandError("Migrate the reviewed fulfilment source before preparing its roles.")
            group, _ = Group.objects.get_or_create(name="Rezayi: " + name)
            group.permissions.set(permissions)
        self.stdout.write("Scoped delivery definitions prepared; no user membership, account or grant changed.")
