"""Explicit admin MFA policy preserves role, CSRF and session boundaries in both environments."""

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
            self.assertFalse(owner_mfa_setting(environ.Env(), production=True))
        with patch.dict("os.environ", {"OWNER_MFA_REQUIRED": "true"}):
            self.assertTrue(owner_mfa_setting(environ.Env(), production=True))

    def test_invalid_or_empty_values_cannot_silently_disable_mfa(self):
        for value in ("", "tru", "0", "disabled"):
            with self.subTest(value=value), patch.dict("os.environ", {"OWNER_MFA_REQUIRED": value}):
                with self.assertRaisesMessage(ImproperlyConfigured, "must be true or false"):
                    owner_mfa_setting(environ.Env(), production=False)
                with self.assertRaisesMessage(ImproperlyConfigured, "must be true or false"):
                    owner_mfa_setting(environ.Env(), production=True)


@override_settings(PRODUCTION=False, OWNER_MFA_REQUIRED=False)
class OwnerDevelopmentMFATests(TestCase):
    settings_production = False

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
        self.assertTrue(AuditEvent.objects.filter(action="owner_password_signin" if self.settings_production else "owner_development_password_signin").exists())

    @override_settings(OWNER_MFA_REQUIRED=True)
    def test_staff_enrollment_describes_mfa_when_requirement_is_enabled(self):
        from apps.accounts.owner_copy import COPY

        staff = User.objects.create_user(
            "staff-policy@example.test", PASSWORD, email_verified=True, is_staff=True
        )
        Account.objects.create(user=staff, context="staff")
        response = self.login(email=staff.email)
        self.assertEqual(response.context["stage"], "enroll_start")
        self.assertEqual(self.client.session["pending_mfa"]["context"], "staff")
        self.assertContains(response, COPY["en"]["subtitle"])
        self.assertNotContains(response, PASSWORD_ONLY_SUBTITLES["en"])
        self.assertEqual(self.client.get("/admin/").status_code, 302)

        response = self.client.post("/admin/login/", {
            "stage": "enroll", "csrfmiddlewaretoken": self.client.cookies["csrftoken"].value,
        })
        self.assertEqual(response.context["stage"], "challenge")
        self.assertContains(response, COPY["en"]["subtitle"])
        self.assertNotContains(response, PASSWORD_ONLY_SUBTITLES["en"])
        self.assertFalse(Authenticator.objects.get(user=staff).confirmed)
        self.assertEqual(self.client.get("/admin/").status_code, 302)

    def test_reenabling_mfa_immediately_denies_existing_password_only_grant(self):
        self.login()
        with override_settings(OWNER_MFA_REQUIRED=True):
            self.assertEqual(self.client.get("/admin/").status_code, 302)
            response = self.login()
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.context["stage"], "enroll_start")

    def test_production_false_honors_password_only_policy(self):
        with override_settings(PRODUCTION=True, OWNER_MFA_REQUIRED=False):
            self.assertEqual(self.login().status_code, 302)
            self.assertEqual(self.client.get("/admin/").status_code, 200)
            self.assertNotIn("pending_mfa", self.client.session)

    def test_wrong_password_missing_csrf_and_unprivileged_identities_are_rejected(self):
        self.assertEqual(self.login(csrf=False).status_code, 403)
        self.assertEqual(self.login(password="wrong").status_code, 200)
        self.assertEqual(self.client.get("/admin/").status_code, 302)
        for field in ("is_staff", "is_superuser", "email_verified", "is_active"):
            setattr(self.owner, field, False)
            self.owner.save()
            client = APIClient(enforce_csrf_checks=True)
            self.assertEqual(self.login(client=client).status_code, 200)
            self.assertEqual(client.get("/admin/").status_code, 302)
            self.assertNotIn("owner", client.session.get("grants", {}))
            setattr(self.owner, field, True)
            self.owner.save()

    def test_owner_context_does_not_implicitly_grant_staff_context(self):
        Account.objects.create(user=self.owner, context="buyer")
        Account.objects.create(user=self.owner, context="staff")
        self.assertEqual(signin(self.client, "buyer", self.owner.email).status_code, 200)
        self.assertEqual(self.client.get("/admin/").status_code, 302)
        self.assertEqual(signin(self.client, "owner", self.owner.email).status_code, 302)
        self.assertEqual(self.client.get("/api/v1/auth/staff/session/").status_code, 404)
        self.assertNotIn("staff", self.client.session.get("grants", {}))
        self.assertEqual(self.client.get("/admin/").status_code, 200)

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

    def test_password_only_policy_stays_english_in_the_compact_login(self):
        for locale in PASSWORD_ONLY_SUBTITLES:
            with self.subTest(locale=locale):
                response = self.client.get(f"/admin/login/?locale={locale}")
                self.assertEqual(response.context["stage"], "password")
                self.assertEqual(response.context["subtitle"], PASSWORD_ONLY_SUBTITLES["en"])
                self.assertEqual(response["Content-Language"], "en")
                self.assertContains(response, '<html lang="en" dir="ltr">')
                self.assertNotContains(response, PASSWORD_ONLY_SUBTITLES["en"])


@override_settings(PRODUCTION=False, OWNER_MFA_REQUIRED=False)
class StaffDevelopmentMFATests(TestCase):
    settings_production = False

    login = OwnerDevelopmentMFATests.login

    def setUp(self):
        self.owner = User.objects.create_user(
            "staff-policy@example.test", PASSWORD, email_verified=True, is_staff=True
        )
        self.account = Account.objects.create(user=self.owner, context="staff")
        self.client = APIClient(enforce_csrf_checks=True)

    def test_password_only_staff_enters_admin_without_enrollment(self):
        self.assertEqual(self.login().status_code, 302)
        response = self.client.get("/admin/")
        self.assertEqual(response.status_code, 200)
        self.assertNotContains(response, "Registered users")
        self.assertEqual(self.client.get("/admin/accounts/user/").status_code, 403)
        grant = self.client.session["grants"]["staff"]
        self.assertFalse(grant["mfa"])
        self.assertEqual(grant["entry"], "admin")
        self.assertNotIn("pending_mfa", self.client.session)
        self.assertFalse(Authenticator.objects.filter(user=self.owner).exists())
        self.assertTrue(AuditEvent.objects.filter(action="staff_password_signin" if self.settings_production else "staff_development_password_signin", context="staff").exists())

    def test_staff_groups_still_control_models_and_revocation_is_immediate(self):
        from django.contrib.auth.models import Group, Permission

        group = Group.objects.create(name="Synthetic queue access")
        group.permissions.set(Permission.objects.filter(
            content_type__app_label="verification", codename="view_queue"
        ))
        self.assertEqual(group.permissions.count(), 1)
        self.owner.groups.add(group)
        self.login()
        self.assertEqual(self.client.get("/admin/verification/reviewcase/").status_code, 200)
        self.assertEqual(self.client.get("/admin/catalogue/product/").status_code, 403)
        self.owner.groups.clear()
        self.assertEqual(self.client.get("/admin/verification/reviewcase/").status_code, 403)

    def test_staff_account_suspension_and_access_epoch_revoke_password_only_grants(self):
        self.login()
        self.account.status = "suspended"
        self.account.save()
        self.assertEqual(self.client.get("/admin/").status_code, 302)
        self.account.status = "active"
        self.account.save()
        self.login()
        self.account.access_epoch += 1
        self.account.save()
        self.assertEqual(self.client.get("/admin/").status_code, 302)

    def test_reenabling_mfa_immediately_denies_existing_password_only_grant(self):
        self.login()
        with override_settings(OWNER_MFA_REQUIRED=True):
            self.assertEqual(self.client.get("/admin/").status_code, 302)
            self.assertEqual(self.login().context["stage"], "enroll_start")
            self.assertEqual(self.client.session["pending_mfa"]["context"], "staff")

    def test_production_false_honors_password_only_policy(self):
        with override_settings(PRODUCTION=True, OWNER_MFA_REQUIRED=False):
            self.assertEqual(self.login().status_code, 302)
            self.assertEqual(self.client.get("/admin/").status_code, 200)
            self.assertNotIn("pending_mfa", self.client.session)

    def test_wrong_password_missing_csrf_and_unprivileged_identities_are_rejected(self):
        self.assertEqual(self.login(csrf=False).status_code, 403)
        self.assertEqual(self.login(password="wrong").status_code, 200)
        for field in ("is_staff", "email_verified", "is_active"):
            setattr(self.owner, field, False)
            self.owner.save()
            client = APIClient(enforce_csrf_checks=True)
            self.assertEqual(self.login(client=client).status_code, 200)
            self.assertEqual(client.get("/admin/").status_code, 302)
            setattr(self.owner, field, True)
            self.owner.save()
        for status in ("suspended", "archived"):
            self.account.status = status
            self.account.save()
            client = APIClient(enforce_csrf_checks=True)
            self.assertEqual(self.login(client=client).status_code, 200)
            self.assertEqual(client.get("/admin/").status_code, 302)

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
            self.assertEqual(self.login().context["stage"], "challenge")
            self.assertEqual(self.client.session["pending_mfa"]["context"], "staff")

    def test_password_only_grants_keep_expiry_and_credential_invalidation(self):
        self.login()
        session = self.client.session
        session["grants"]["staff"]["at"] = time.time() - 3601
        session.save()
        self.assertEqual(self.client.get("/admin/").status_code, 302)
        self.login()
        self.owner.set_password(NEW_PASSWORD)
        self.owner.save()
        self.assertEqual(self.client.get("/admin/").status_code, 302)

    def test_native_entry_binding_is_required_and_retired_api_remains_closed(self):
        from apps.accounts.services import AuthFailure, begin_signin

        request = self.client.get("/api/v1/auth/csrf/").wsgi_request
        with self.assertRaises(AuthFailure):
            begin_signin(request, self.owner.email, PASSWORD, "staff")
        self.assertNotIn("staff", request.session.get("grants", {}))
        self.login()
        session = self.client.session
        session["grants"]["staff"]["entry"] = None
        session.save()
        self.assertEqual(self.client.get("/admin/").status_code, 302)
        self.assertEqual(self.client.get("/api/v1/auth/staff/session/").status_code, 404)


@override_settings(PRODUCTION=True, DEBUG=False, OWNER_MFA_REQUIRED=False)
class OwnerProductionMFATests(OwnerDevelopmentMFATests):
    settings_production = True


@override_settings(PRODUCTION=True, DEBUG=False, OWNER_MFA_REQUIRED=False)
class StaffProductionMFATests(StaffDevelopmentMFATests):
    settings_production = True
