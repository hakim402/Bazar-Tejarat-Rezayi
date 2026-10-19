"""Owner bootstrap expected failures stay private and never create partial identities."""

from io import StringIO
from unittest.mock import patch
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TransactionTestCase

from apps.accounts.management.commands.bootstrap_owner import Command
from apps.accounts.models import AuditEvent, User

MODULE = "apps.accounts.management.commands.bootstrap_owner"
EMAIL = "bootstrap-owner@example.test"
PASSWORD = "Bootstrap-private-passphrase-7462!"


class OwnerBootstrapTests(TransactionTestCase):
    def test_rejected_passwords_produce_clean_cli_error_without_private_input(self):
        for password in ("short", "123456789012", EMAIL):
            with self.subTest(kind=len(password)), patch("builtins.input", side_effect=[EMAIL, "Bootstrap Owner"]), \
                 patch(MODULE + ".getpass.getpass", side_effect=[password, password]):
                output, errors = StringIO(), StringIO()
                command = Command(stdout=output, stderr=errors)
                with self.assertRaises(SystemExit) as stopped:
                    command.run_from_argv(["manage.py", "bootstrap_owner"])
                self.assertEqual(stopped.exception.code, 1)
                self.assertIn("Use a stronger password of at least 12 characters", errors.getvalue())
                for private in (password, EMAIL, "Traceback"):
                    self.assertNotIn(private, output.getvalue() + errors.getvalue())
                self.assertFalse(User.objects.exists())
                self.assertFalse(AuditEvent.objects.filter(action="owner_bootstrapped_local").exists())

    def test_invalid_email_is_a_clean_command_error(self):
        with patch("builtins.input", return_value="invalid-address"), patch(MODULE + ".getpass.getpass") as password:
            with self.assertRaisesMessage(CommandError, "Enter a valid email address"):
                call_command("bootstrap_owner")
            password.assert_not_called()
        self.assertFalse(User.objects.exists())

    def test_mismatched_confirmation_does_not_create_owner(self):
        with patch("builtins.input", side_effect=[EMAIL, "Bootstrap Owner"]), \
             patch(MODULE + ".getpass.getpass", side_effect=[PASSWORD, "different"]):
            with self.assertRaisesMessage(CommandError, "Passwords do not match"):
                call_command("bootstrap_owner")
        self.assertFalse(User.objects.exists())

    def test_valid_password_creates_verified_owner_and_requires_mfa_next(self):
        output = StringIO()
        with patch("builtins.input", side_effect=[EMAIL, "Bootstrap Owner"]), \
             patch(MODULE + ".getpass.getpass", side_effect=[PASSWORD, PASSWORD]):
            call_command("bootstrap_owner", stdout=output)
        owner = User.objects.get(email=EMAIL)
        self.assertTrue(owner.owner_authority and owner.is_staff and owner.is_superuser and owner.email_verified)
        self.assertTrue(owner.check_password(PASSWORD))
        self.assertNotEqual(owner.password, PASSWORD)
        self.assertIn("Complete authenticator enrollment", output.getvalue())
        self.assertNotIn(PASSWORD, output.getvalue())
        self.assertTrue(AuditEvent.objects.filter(subject=owner, action="owner_bootstrapped_local").exists())

    def test_existing_identity_or_owner_is_never_overwritten(self):
        person = User.objects.create_user(EMAIL, PASSWORD, display_name="Existing")
        with patch("builtins.input", return_value=EMAIL), patch(MODULE + ".getpass.getpass") as password:
            with self.assertRaisesMessage(CommandError, "Identity already exists"):
                call_command("bootstrap_owner")
            password.assert_not_called()
        person.refresh_from_db()
        self.assertFalse(person.owner_authority)
        self.assertTrue(person.check_password(PASSWORD))
        person.owner_authority = True
        person.save()
        with patch("builtins.input") as prompt:
            with self.assertRaisesMessage(CommandError, "An owner already exists"):
                call_command("bootstrap_owner")
            prompt.assert_not_called()
        self.assertEqual(User.objects.count(), 1)
