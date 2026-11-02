from django.core.management.base import BaseCommand, CommandError
from apps.runtime.transfer import export_source, TransferError


class Command(BaseCommand):
    help = "Export the intended PostgreSQL/MariaDB source in a private read-only snapshot; never migrates it."

    def add_arguments(self, parser):
        parser.add_argument("--output", required=True)
        parser.add_argument("--source-revision", required=True)

    def handle(self, *args, **options):
        try:
            result = export_source(options["output"], source_revision=options["source_revision"])
        except (TransferError, ValueError, OSError):
            raise CommandError("Private source export refused; no target/source rows were changed.") from None
        self.stdout.write(f"Exported {result['tables']} tables / {result['rows']} rows. Manifest {result['manifest_sha256']}.")
