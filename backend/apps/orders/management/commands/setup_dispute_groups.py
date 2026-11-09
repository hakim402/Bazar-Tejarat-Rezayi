"""Explicit dispute and review role definitions only; never assigns or provisions real users."""

from django.core.management.base import BaseCommand
from django.contrib.auth.models import Group, Permission
from django.contrib.contenttypes.models import ContentType
from django.db import transaction

from apps.orders.models import Aftercare


class Command(BaseCommand):
    help = "Create or update staff groups with dispute and review permissions."

    @transaction.atomic
    def handle(self, *args, **options):
        ct_aftercare = ContentType.objects.get_for_model(Aftercare)

        # Dispute reviewers get read_dispute + read_dispute_evidence
        dispute_group, _ = Group.objects.get_or_create(name="dispute_reviewers")
        for codename in ("read_dispute", "read_dispute_evidence"):
            perm = Permission.objects.get(content_type=ct_aftercare, codename=codename)
            dispute_group.permissions.add(perm)
        self.stdout.write(
            f"Group '{dispute_group.name}' has {dispute_group.permissions.count()} permissions."
        )

        # Dispute deciders get read_dispute + assign_dispute + decide_dispute + read_dispute_evidence
        decide_group, _ = Group.objects.get_or_create(name="dispute_deciders")
        for codename in (
            "read_dispute",
            "assign_dispute",
            "decide_dispute",
            "read_dispute_evidence",
        ):
            perm = Permission.objects.get(content_type=ct_aftercare, codename=codename)
            decide_group.permissions.add(perm)
        self.stdout.write(
            f"Group '{decide_group.name}' has {decide_group.permissions.count()} permissions."
        )

        # Review moderators get read_review + moderate_review
        review_group, _ = Group.objects.get_or_create(name="review_moderators")
        for codename in ("read_review", "moderate_review"):
            perm = Permission.objects.get(content_type=ct_aftercare, codename=codename)
            review_group.permissions.add(perm)
        self.stdout.write(
            f"Group '{review_group.name}' has {review_group.permissions.count()} permissions."
        )
