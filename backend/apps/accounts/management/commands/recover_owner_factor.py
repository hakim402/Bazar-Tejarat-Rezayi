import getpass

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.accounts.models import Authenticator, RecoveryCode, User, normalize_email
from apps.accounts.services import audit


class Command(BaseCommand):
    help = "Local emergency owner-factor recovery; requires OS/database authority and the current owner password."

    @transaction.atomic
    def handle(self, **options):
        email = normalize_email(input("Owner email (local input only): "))
        user = (
            User.objects.select_for_update()
            .filter(email=email, is_active=True, owner_authority=True, is_staff=True, is_superuser=True)
            .first()
        )
        password = getpass.getpass("Current owner password: ")
        if not user or not user.check_password(password):
            raise CommandError("Owner recovery could not be verified.")
        if input("Type RESET OWNER FACTOR to invalidate all grants and remove this factor: ") != "RESET OWNER FACTOR":
            raise CommandError("Cancelled.")
        Authenticator.objects.filter(user=user).delete()
        RecoveryCode.objects.filter(user=user).delete()
        user.credential_epoch += 1
        user.save()
        audit("owner_factor_emergency_recovery", user=user, context="owner")
        self.stdout.write("Factor removed and grants invalidated. Fresh password and enrollment are required.")
