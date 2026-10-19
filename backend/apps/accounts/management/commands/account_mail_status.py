import json
from django.core.management.base import BaseCommand
from django.db.models import Count
from apps.accounts.models import AccountMail


class Command(BaseCommand):
    help = "Report safe account-mail outbox counts; never print recipients, tokens or provider responses."

    def handle(self, *args, **options):
        self.stdout.write(
            json.dumps(
                dict(AccountMail.objects.values("status").annotate(total=Count("pk")).values_list("status", "total"))
            )
        )
