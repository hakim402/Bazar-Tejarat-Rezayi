from django.core.management.base import BaseCommand
from django.contrib.auth.models import Group, Permission


class Command(BaseCommand):
    help = "Define native order/invoice read groups idempotently; assign no real users."

    def handle(self, *args, **options):
        for name, code in [
            ("Rezayi: Order operations", "read_orders"),
            ("Rezayi: Invoice inspection", "read_invoices"),
        ]:
            group, _ = Group.objects.get_or_create(name=name)
            group.permissions.set(Permission.objects.filter(content_type__app_label="orders", codename=code))
        self.stdout.write("Order/invoice groups prepared; no users assigned.")
