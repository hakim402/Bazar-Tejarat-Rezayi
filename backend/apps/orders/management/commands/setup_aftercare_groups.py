"""Explicit aftercare role definitions only; never assigns or provisions real users.

Roles may bundle cross-app permissions because the retained closure paths
require them: deciding a cancellation clears the linked fulfilment hold through
the existing blocker case clear path (read_fulfilment + manage_delivery_holds),
and assigning aftercare also assigns that linked hold case (assign_fulfilment)
while reading the payment case that opened it (read_payments).
"""

from django.core.management import BaseCommand, CommandError
from django.contrib.auth.models import Group, Permission
from django.db import transaction
from django.db.models import Q

ROLES = {
    "Aftercare metadata": {"orders": ["read_aftercare"]},
    "Aftercare assignment": {
        "orders": ["read_aftercare", "assign_aftercare"],
        "fulfilment": ["read_fulfilment", "assign_fulfilment"],
        "payments": ["read_payments"],
    },
    "Cancellation review": {
        "orders": ["read_aftercare", "decide_cancellation"],
        "fulfilment": ["read_fulfilment", "manage_delivery_holds"],
    },
    "Amendment review": {"orders": ["read_aftercare", "decide_amendment"]},
    "Goods refund review": {"payments": ["read_payments", "decide_goods_refund", "read_refund_evidence"]},
    "Delivery refund records": {"fulfilment": ["read_fulfilment", "record_delivery_refund"]},
    "Delivery refund review": {
        "fulfilment": ["read_fulfilment", "confirm_delivery_refund", "read_delivery_evidence"],
    },
}


class Command(BaseCommand):
    help = "Prepare scoped aftercare groups; no user assignments are changed."

    @transaction.atomic
    def handle(self, **options):
        for name, bundles in ROLES.items():
            query = Q()
            for app_label, codes in bundles.items():
                query |= Q(content_type__app_label=app_label, codename__in=codes)
            permissions = Permission.objects.filter(query)
            expected = {(app, code) for app, codes in bundles.items() for code in codes}
            if {(p.content_type.app_label, p.codename) for p in permissions} != expected:
                raise CommandError("Migrate the reviewed aftercare source before preparing its roles.")
            group, _ = Group.objects.get_or_create(name="Rezayi: " + name)
            group.permissions.set(permissions)
        self.stdout.write("Scoped aftercare definitions prepared; no user membership, account or grant changed.")
