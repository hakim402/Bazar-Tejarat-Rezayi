from unittest.mock import patch

from django.core.exceptions import PermissionDenied
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.accounts.admin import owner_site
from apps.accounts.models import Account, AuditEvent, User
from apps.accounts.services import AuthFailure, verify_development_emails
from tests.test_identity import PASSWORD, signin


@override_settings(DEBUG=True, PRODUCTION=False, OWNER_MFA_REQUIRED=False)
class DevelopmentEmailVerificationTests(TestCase):
    url = "/admin/accounts/user/"

    def setUp(self):
        self.owner = User.objects.create_superuser("dev-owner@example.test", PASSWORD, email_verified=True)
        self.user = User.objects.create_user("dev-company@example.test", PASSWORD)
        self.account = Account.objects.create(user=self.user, context="seller", intent="company", review_status="pending")
        self.client = APIClient(enforce_csrf_checks=True)
        self.assertEqual(signin(self.client, "owner", self.owner.email).status_code, 200)

    def action(self, users=None, csrf=True):
        headers = {}
        if csrf:
            headers["HTTP_X_CSRFTOKEN"] = self.client.get("/api/v1/auth/csrf/").json()["csrf_token"]
        return self.client.post(self.url, {
            "action": "verify_email_for_development",
            "_selected_action": [str(user.pk) for user in (users or [self.user])],
        }, **headers)

    def test_owner_action_verifies_and_audits_without_approving_seller(self):
        page = self.client.get(self.url)
        self.assertContains(page, "Verify email for development")
        before_epoch = self.user.credential_epoch
        self.assertEqual(self.action().status_code, 302)
        self.user.refresh_from_db()
        self.account.refresh_from_db()
        self.assertTrue(self.user.email_verified)
        self.assertEqual(self.user.credential_epoch, before_epoch)
        self.assertEqual((self.account.status, self.account.review_status), ("active", "pending"))
        event = AuditEvent.objects.get(action="owner_development_email_verified")
        self.assertEqual((event.actor_id, event.subject_id, event.context), (self.owner.pk, self.user.pk, "owner"))
        self.assertEqual(event.changed_fields, ["email_verified"])
        self.assertEqual(self.action().status_code, 302)
        self.assertEqual(AuditEvent.objects.filter(action=event.action).count(), 1)
        other = APIClient(enforce_csrf_checks=True)
        self.assertEqual(signin(other, "seller", self.user.email).json()["status"], "signed_in")

    def test_buyer_can_also_be_verified(self):
        buyer = User.objects.create_user("dev-buyer@example.test", PASSWORD)
        Account.objects.create(user=buyer, context="buyer")
        self.assertEqual(self.action([buyer]).status_code, 302)
        buyer.refresh_from_db()
        self.assertTrue(buyer.email_verified)

    def test_csrf_required(self):
        self.assertEqual(self.action(csrf=False).status_code, 403)
        self.user.refresh_from_db()
        self.assertFalse(self.user.email_verified)

    def test_disabled_and_privileged_identities_are_skipped(self):
        disabled = User.objects.create_user("disabled@example.test", PASSWORD, is_active=False)
        staff = User.objects.create_user("staff@example.test", PASSWORD)
        Account.objects.create(user=staff, context="buyer")
        Account.objects.create(user=staff, context="staff")
        privileged = User.objects.create_user("privileged@example.test", PASSWORD, is_staff=True)
        for user in [disabled, privileged]:
            Account.objects.create(user=user, context="buyer")
        self.assertEqual(self.action([disabled, staff, privileged, self.owner]).status_code, 302)
        for user in [disabled, staff, privileged]:
            user.refresh_from_db()
            self.assertFalse(user.email_verified)
        self.assertFalse(AuditEvent.objects.filter(action="owner_development_email_verified").exists())

    def test_action_hidden_and_service_denied_outside_development(self):
        request = self.client.get(self.url).wsgi_request
        for configuration in [{"PRODUCTION": True}, {"DEBUG": False}]:
            with self.subTest(configuration=configuration), override_settings(**configuration):
                self.assertNotIn("verify_email_for_development", owner_site._registry[User].get_actions(request))
                with self.assertRaises(PermissionDenied):
                    verify_development_emails(request, [self.user.pk])
        self.user.refresh_from_db()
        self.assertFalse(self.user.email_verified)

    def test_anonymous_and_staff_have_no_owner_action(self):
        for context in [None, "staff"]:
            other = APIClient(enforce_csrf_checks=True)
            if context:
                staff = User.objects.create_user("authorized-staff@example.test", PASSWORD, email_verified=True)
                Account.objects.create(user=staff, context="staff")
                signin(other, "staff", staff.email)
            response = other.get(self.url)
            self.assertEqual(response.status_code, 302)
            request = response.wsgi_request
            self.assertNotIn("verify_email_for_development", owner_site._registry[User].get_actions(request))
            with self.assertRaises(AuthFailure):
                verify_development_emails(request, [self.user.pk])
        self.user.refresh_from_db()
        self.assertFalse(self.user.email_verified)

    def test_audit_failure_rolls_back_verification(self):
        request = self.client.get(self.url).wsgi_request
        with patch("apps.accounts.services.audit", side_effect=RuntimeError("synthetic failure")):
            with self.assertRaises(RuntimeError):
                verify_development_emails(request, [self.user.pk])
        self.user.refresh_from_db()
        self.assertFalse(self.user.email_verified)
