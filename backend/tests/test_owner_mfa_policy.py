"""Owner-only development opt-out preserves production, role, CSRF and session boundaries."""

import time
from unittest.mock import patch
import environ
from django.core.exceptions import ImproperlyConfigured
from django.test import SimpleTestCase, TestCase, override_settings
from rest_framework.test import APIClient

from config.security import owner_mfa_setting
from apps.accounts.models import Account, AuditEvent, Authenticator, User
from apps.accounts.owner_copy import PASSWORD_ONLY_SUBTITLES
from tests.test_identity import PASSWORD, NEW_PASSWORD, signin


class OwnerMFAPolicySettingsTests(SimpleTestCase):
    def test_default_required_and_explicit_development_opt_out(self):
        with patch.dict("os.environ", {}, clear=True):
            self.assertTrue(owner_mfa_setting(environ.Env(), production=False))
            self.assertTrue(owner_mfa_setting(environ.Env(), production=True))
        with patch.dict("os.environ", {"OWNER_MFA_REQUIRED": "false"}):
            self.assertFalse(owner_mfa_setting(environ.Env(), production=False))
            with self.assertRaisesMessage(ImproperlyConfigured, "must be true in production"):
                owner_mfa_setting(environ.Env(), production=True)
        with patch.dict("os.environ", {"OWNER_MFA_REQUIRED": "true"}):
            self.assertTrue(owner_mfa_setting(environ.Env(), production=True))

    def test_invalid_or_empty_values_cannot_silently_disable_mfa(self):
        for value in ("", "tru", "0", "disabled"):
            with self.subTest(value=value), patch.dict("os.environ", {"OWNER_MFA_REQUIRED": value}):
                with self.assertRaisesMessage(ImproperlyConfigured, "must be true or false"):
                    owner_mfa_setting(environ.Env(), production=False)


@override_settings(PRODUCTION=False, OWNER_MFA_REQUIRED=False)
class OwnerDevelopmentMFATests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_superuser(
            "owner-policy@example.test", PASSWORD, display_name="Synthetic owner", email_verified=True
        )
        self.client = APIClient(enforce_csrf_checks=True)

    def login(self, *, client=None, password=PASSWORD, email=None, locale="en", csrf=True):
        client = client or self.client
        client.get(f"/admin/login/?locale={locale}")
        values = {"stage": "password", "email": email or self.owner.email, "password": password}
        if csrf:
            values["csrfmiddlewaretoken"] = client.cookies["csrftoken"].value
        return client.post(f"/admin/login/?locale={locale}", values)

    def test_password_only_owner_enters_admin_without_enrollment(self):
        self.assertEqual(self.login().status_code, 302)
        self.assertEqual(self.client.get("/admin/").status_code, 200)
        self.assertFalse(self.client.session["grants"]["owner"]["mfa"])
        self.assertNotIn("pending_mfa", self.client.session)
        self.assertFalse(Authenticator.objects.filter(user=self.owner).exists())
        self.assertTrue(AuditEvent.objects.filter(action="owner_development_password_signin").exists())

    def test_reenabling_mfa_immediately_denies_existing_password_only_grant(self):
        self.login()
        with override_settings(OWNER_MFA_REQUIRED=True):
            self.assertEqual(self.client.get("/admin/").status_code, 302)
            response = self.login()
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.context["stage"], "enroll_start")

    def test_production_requires_mfa_even_if_boolean_setting_is_overridden(self):
        self.login()
        with override_settings(PRODUCTION=True, OWNER_MFA_REQUIRED=False):
            self.assertEqual(self.client.get("/admin/").status_code, 302)
            self.assertEqual(self.login().status_code, 200)
            self.assertIn("pending_mfa", self.client.session)

    def test_wrong_password_missing_csrf_and_unprivileged_identities_are_rejected(self):
        self.assertEqual(self.login(csrf=False).status_code, 403)
        self.assertEqual(self.login(password="wrong").status_code, 200)
        self.assertEqual(self.client.get("/admin/").status_code, 302)
        for field in ("owner_authority", "is_staff", "is_superuser", "email_verified", "is_active"):
            setattr(self.owner, field, False)
            self.owner.save()
            client = APIClient(enforce_csrf_checks=True)
            self.assertEqual(self.login(client=client).status_code, 200)
            self.assertEqual(client.get("/admin/").status_code, 302)
            self.assertNotIn("owner", client.session.get("grants", {}))
            setattr(self.owner, field, True)
            self.owner.save()

    def test_staff_mfa_and_owner_context_separation_are_unchanged(self):
        Account.objects.create(user=self.owner, context="buyer")
        Account.objects.create(user=self.owner, context="staff")
        self.assertEqual(signin(self.client, "buyer", self.owner.email).status_code, 200)
        self.assertEqual(self.client.get("/admin/").status_code, 302)
        self.assertEqual(signin(self.client, "staff", self.owner.email).json()["status"], "enroll")
        self.assertEqual(self.client.get("/api/v1/auth/staff/session/").status_code, 403)
        self.assertEqual(self.client.get("/admin/").status_code, 302)

    def test_existing_authenticator_material_is_preserved_and_still_required_when_enabled(self):
        device = Authenticator(user=self.owner, confirmed=True)
        device.set_secret()
        device.save()
        encrypted = device.encrypted_secret
        self.login()
        device.refresh_from_db()
        self.assertEqual(device.encrypted_secret, encrypted)
        self.assertTrue(device.confirmed)
        with override_settings(OWNER_MFA_REQUIRED=True):
            self.assertEqual(self.client.get("/admin/").status_code, 302)
            self.login()
            self.assertEqual(self.client.session["pending_mfa"]["context"], "owner")

    def test_password_only_grants_keep_expiry_and_credential_invalidation(self):
        self.login()
        session = self.client.session
        session["grants"]["owner"]["at"] = time.time() - 3601
        session.save()
        self.assertEqual(self.client.get("/admin/").status_code, 302)
        self.login()
        self.owner.set_password(NEW_PASSWORD)
        self.owner.save()
        self.assertEqual(self.client.get("/admin/").status_code, 302)

    def test_password_only_subtitle_is_correct_in_all_four_languages(self):
        for locale, subtitle in PASSWORD_ONLY_SUBTITLES.items():
            response = self.client.get(f"/admin/login/?locale={locale}")
            self.assertContains(response, subtitle)
