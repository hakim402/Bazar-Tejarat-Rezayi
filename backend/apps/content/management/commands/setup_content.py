from django.core.management.base import BaseCommand
from django.db import transaction
from django.conf import settings
from django.core.management import CommandError
from apps.content.models import ContentItem, ContentRevision
from apps.content.drafts import IDENTITIES, draft
from apps.content.validation import payload
from apps.accounts.models import User


class Command(BaseCommand):
    help = "Create missing editorial identities only; optional explicit owner-authored starting drafts, never publish or overwrite."

    def add_arguments(self, parser):
        parser.add_argument("--drafts-for-owner", type=str)

    @transaction.atomic
    def handle(self, **options):
        if options["drafts_for_owner"] and settings.PRODUCTION:
            raise CommandError("Starting drafts are development-only; use the guarded editor in production.")
        user = (
            User.objects.filter(pk=options["drafts_for_owner"], owner_authority=True, is_active=True).first()
            if options["drafts_for_owner"]
            else None
        )
        if options["drafts_for_owner"] and not user:
            raise ValueError("Choose an existing active owner; no identity is created.")
        for key, kind in IDENTITIES.items():
            item, _ = ContentItem.objects.get_or_create(key=key, defaults={"kind": kind})
            if user and not item.revisions.exists():
                ContentRevision.objects.create(
                    item=item, number=1, locale="fa-AF", payload=payload(draft(key), kind), author=user
                )
        self.stdout.write(
            "Missing identities prepared; existing drafts/publications/identities unchanged. No content published."
        )
