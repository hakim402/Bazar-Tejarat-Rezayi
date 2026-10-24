from django.core.management.base import BaseCommand
from apps.site.defaults import initialize


class Command(BaseCommand):
    help = "Initialize safe Site Settings once; preserve every existing owner edit."

    def handle(self, **options):
        _, created = initialize()
        self.stdout.write("Safe site defaults initialized." if created else "Existing site settings preserved.")
