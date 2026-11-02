from django.core.management.base import BaseCommand, CommandError
from apps.runtime.transfer import prepare_target, TransferError


class Command(BaseCommand):
    help = "Initialize only a fresh MariaDB staging schema; no accounts, providers or web activation."

    def handle(self, *args, **options):
        try:
            self.stdout.write(prepare_target())
        except TransferError as error:
            raise CommandError(str(error)) from None
