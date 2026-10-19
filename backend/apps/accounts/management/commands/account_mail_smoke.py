from django.conf import settings
from django.core.mail import EmailMessage
from django.core.management.base import BaseCommand, CommandError
from django.core.validators import validate_email


class Command(BaseCommand):
    help = "Send one non-sensitive smoke email to an explicitly authorized recipient. No account tokens."

    def add_arguments(self, parser):
        parser.add_argument("--recipient", required=True)
        parser.add_argument("--confirm-authorized-recipient", action="store_true")

    def handle(self, *args, **options):
        if not options["confirm_authorized_recipient"]:
            raise CommandError("Explicit recipient authorization confirmation is required.")
        try:
            validate_email(options["recipient"])
            sent = EmailMessage(
                "Bazar Rezayi — mail connection check",
                "This is an authorized connection check. It contains no password or account action link.",
                settings.DEFAULT_FROM_EMAIL,
                [options["recipient"]],
            ).send()
            if sent != 1:
                raise ValueError
        except Exception:
            raise CommandError("delivery_failed; provider details redacted.") from None
        self.stdout.write(
            "smtp_accepted; inbox delivery unverified"
            if settings.ACCOUNT_EMAIL_TRANSPORT == "smtp"
            else "captured; no provider send"
        )
