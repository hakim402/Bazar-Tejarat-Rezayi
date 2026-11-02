from django.core.management.base import BaseCommand, CommandError
from apps.runtime.transfer import Importer, TransferError


class Command(BaseCommand):
    help = "Resume an exact private transfer into its fresh unservable target; never overwrites an initialized app."

    def add_arguments(self, parser):
        parser.add_argument("--input", required=True)
        parser.add_argument("--expected-manifest", required=True)

    def handle(self, *args, **options):
        try:
            result = Importer(options["input"], expected_digest=options["expected_manifest"]).run()
        except (TransferError, ValueError, OSError):
            raise CommandError("Transfer refused; keep the target inactive and inspect its private journal/report.") from None
        self.stdout.write(f"Transfer {result['manifest_sha256']} complete; {len(result['tables'])} tables verified. Web/jobs remain operator-controlled.")
