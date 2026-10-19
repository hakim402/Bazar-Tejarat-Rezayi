import getpass

from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.management.base import BaseCommand, CommandError
from rest_framework.exceptions import ValidationError as APIValidationError
from django.core.validators import validate_email
from django.db import transaction

from apps.accounts.models import User, normalize_email
from apps.accounts.services import audit, owner_mfa_required, password_check


class Command(BaseCommand):
    help = "Interactively create the first owner without default or printed credentials. Sign in at /admin/login/; enroll MFA when required."

    @transaction.atomic
    def handle(self, **options):
        if User.objects.filter(owner_authority=True).exists():
            raise CommandError("An owner already exists; this command never overwrites identities.")
        email = normalize_email(input("Owner email (local input only): "))
        try:
            validate_email(email)
        except DjangoValidationError:
            raise CommandError("Enter a valid email address.") from None
        if User.objects.filter(email=email).exists():
            raise CommandError("Identity already exists; explicit audited recovery is required.")
        name = input("Owner display name: ").strip()
        if not name or len(name) > 150:
            raise CommandError("A display name is required.")
        password = getpass.getpass("Owner password: ")
        if password != getpass.getpass("Confirm password: "):
            raise CommandError("Passwords do not match.")
        user = User(email=email, display_name=name)
        try:
            password_check(password, user)
        except APIValidationError:
            raise CommandError(
                "Use a stronger password of at least 12 characters. "
                "Avoid common or numeric-only passwords and values similar to your email/name."
            ) from None
        user = User.objects.create_superuser(email, password, display_name=name, email_verified=True)
        audit("owner_bootstrapped_local", user=user, context="owner")
        self.stdout.write(
            "Owner created. Complete authenticator enrollment at /admin/login/ before accessing administration."
            if owner_mfa_required()
            else "Owner created. Sign in at /admin/login/."
        )
