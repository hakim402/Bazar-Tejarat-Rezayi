import signal
from django.core.management.base import BaseCommand, CommandError
from django.conf import settings
from django.utils import timezone
from apps.runtime.models import Job
from apps.runtime.jobs import execute


class Command(BaseCommand):
    help = "Internal bounded worker; requires a current database claim."

    def add_arguments(self, parser):
        parser.add_argument("key")
        parser.add_argument("lease")

    def handle(self, *args, **options):
        if settings.BACKGROUND_ENGINE != "database":
            raise CommandError("Wrong dispatcher architecture.")
        row = Job.objects.filter(pk=options["key"], lease=options["lease"], state="running", lease_until__gt=timezone.now()).first()
        if row is None:
            raise CommandError("Stale or missing claim.")
        signal.signal(signal.SIGALRM, signal.SIG_DFL)
        signal.alarm(30)
        try:
            execute(row)
        finally:
            signal.alarm(0)
