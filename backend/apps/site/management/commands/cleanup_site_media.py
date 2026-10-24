"""Retry only uploads previously marked for scoped permanent deletion."""
from django.core.management.base import BaseCommand
from apps.site.models import SiteMedia
from apps.site.media import cleanup_media


class Command(BaseCommand):
    help = 'Retry pending site-media deletions; shared files are always retained.'

    def handle(self, **options):
        cleanup_media(list(SiteMedia.objects.filter(pending_delete=True).values_list('pk', flat=True)))
        self.stdout.write(f'Pending site-media deletions: {SiteMedia.objects.filter(pending_delete=True).count()}')
