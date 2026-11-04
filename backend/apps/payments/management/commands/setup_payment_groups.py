from django.core.management.base import BaseCommand
from django.contrib.auth.models import Group, Permission


class Command(BaseCommand):
    help = "Prepare explicit payment role definitions; assigns no users."

    def handle(self, **options):
        roles = {
            "Payment metadata": ["read_payments"],
            "Payment evidence": ["read_payments", "read_payment_evidence"],
            "Payment assignment": ["read_payments", "assign_payment_case"],
            "Payment review": ["read_payments", "read_payment_evidence", "review_payment"],
            "Payment corrections": ["read_payments", "read_payment_evidence", "decide_payment_correction"],
            "Payment shortages": ["read_payments", "read_payment_evidence", "decide_payment_shortage"],
            "Overdue review": ["read_payments", "review_overdue"],
            "Payment delivery diagnostics": ["read_payments", "read_payment_delivery"],
        }
        for name, codes in roles.items():
            group, _ = Group.objects.get_or_create(name="Rezayi: " + name)
            group.permissions.set(Permission.objects.filter(content_type__app_label="payments", codename__in=codes))
        self.stdout.write("Explicit payment groups prepared; no user assignments changed.")
