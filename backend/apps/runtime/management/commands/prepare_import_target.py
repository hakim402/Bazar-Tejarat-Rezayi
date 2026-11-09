from django.core.management.base import BaseCommand, CommandError
from apps.runtime.transfer import prepare_target, TransferError


class Command(BaseCommand):
    help = "Initialize only a fresh MariaDB staging schema; no accounts, providers or web activation."

    def add_arguments(self, parser):
        parser.add_argument("--schema-version", type=int, choices=[1, 2, 3, 4, 5], default=1)

    def handle(self, *args, **options):
        try:
            if options["schema_version"] in {2, 3, 4, 5}:
                from django.db import connection
                from apps.runtime.transfer import target_only

                target_only()
                if set(connection.introspection.table_names()) - {"bazar_owned_run"}:
                    raise TransferError("Native restore requires an empty private target.")
                self.stdout.write(
                    f"Empty native v{options['schema_version']} restore target verified; no schema or serving state published."
                )
            else:
                self.stdout.write(prepare_target())
        except TransferError as error:
            raise CommandError(str(error)) from None
