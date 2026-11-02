"""Production entry regressions use owned test DB, capture mail and synthetic Google claims."""
from unittest.mock import patch
from django.conf import settings

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.accounts.models import Account, ActionToken, GoogleAttempt, GoogleIdentity, User
from tests.test_identity import PASSWORD, post, signin, token_from_mail
from tests.test_identity_addendum import GoogleTests


@override_settings(PRODUCTION=True, DEBUG=False, PUBLIC_SIGNUP_ENABLED=True, DEVELOPMENT_SIGNUP_ENABLED=False)
class ProductionRegistrationTests(TestCase):
    def setUp(self):
        self.client = APIClient(enforce_csrf_checks=True)

    def register(self, context, **extra):
        return post(self.client, context + "/register/", {
            "email": context + "@example.test", "password": PASSWORD,
            "display_name": "Synthetic " + context, "consent": True, **extra,
        })

    def test_both_roles_register_verify_and_sign_in_without_admin_privileges(self):
        for context in ("buyer", "seller"):
            with self.subTest(context=context):
                self.assertEqual(self.register(context).status_code, 202)
                user = User.objects.get(email=context + "@example.test")
                account = user.accounts.get()
                self.assertFalse(user.email_verified or user.is_staff or user.is_superuser)
                self.assertEqual(account.intent, "individual")
                self.assertEqual(account.review_status, "pending" if context == "seller" else "not_requested")
                self.assertEqual(signin(self.client, context, user.email).status_code, 403)
                raw = token_from_mail()
                self.assertNotIn(raw, ActionToken.objects.get(user=user).digest)
                self.assertEqual(post(self.client, "verify/", {"token": raw}).status_code, 200)
                self.assertEqual(signin(self.client, context, user.email).status_code, 200)
                self.assertEqual(self.client.get("/api/v1/auth/" + context + "/session/").status_code, 200)
                self.assertEqual(self.client.get("/admin/").status_code, 302)

    @override_settings(PUBLIC_SIGNUP_ENABLED=False, DEVELOPMENT_SIGNUP_ENABLED=True)
    def test_production_closed_is_explicit_and_development_flag_cannot_bypass(self):
        for context in ("buyer", "seller"):
            response = self.register(context)
            self.assertEqual(response.status_code, 403)
            self.assertEqual(response.json()["error"]["code"], "registration_closed")
        self.assertFalse(User.objects.exists())

    def test_consent_csrf_password_and_basic_role_guards_remain(self):
        for data in ({"consent": False}, {"password": "short"}, {"intent": "company"}):
            self.assertEqual(self.register("seller", **data).status_code, 400)
        self.assertEqual(self.client.post("/api/v1/auth/buyer/register/", {}, format="json").status_code, 403)
        self.assertFalse(User.objects.exists())

    def test_duplicate_registration_does_not_merge_roles_or_replace_password(self):
        self.assertEqual(self.register("buyer").status_code, 202)
        self.assertEqual(self.register("seller", email="BUYER@example.test", password=PASSWORD + "different").status_code, 202)
        user = User.objects.get()
        self.assertTrue(user.check_password(PASSWORD))
        self.assertEqual(list(user.accounts.values_list("context", flat=True)), ["buyer"])


@override_settings(PRODUCTION=True, DEBUG=False, PUBLIC_SIGNUP_ENABLED=True, DEVELOPMENT_SIGNUP_ENABLED=False)
class ProductionGoogleTests(GoogleTests):
    """Repeat full state/nonce/PKCE/consent/replay/link/second-role regressions with production signup policy."""

    @override_settings(PUBLIC_SIGNUP_ENABLED=False)
    def test_closed_registration_keeps_linked_google_signin_and_refuses_new_onboarding(self):
        with patch("apps.accounts.google.exchange", return_value=self.claims):
            response = post(self.client, "google/start/", {"context": "buyer", "action": "register", "locale": "en"})
            self.assertEqual(response.json()["error"]["code"], "registration_closed")
            self.assertFalse(GoogleAttempt.objects.exists())
            _, query = self.start()
            callback = self.callback(query)
            self.assertIn("google=registration_closed", callback["Location"])
            self.assertFalse(User.objects.exists())
            self.assertEqual(GoogleAttempt.objects.get().encrypted_payload, "")
            user = User.objects.create_user(self.claims["email"], None, email_verified=True)
            GoogleIdentity.objects.create(user=user, subject=self.claims["sub"])
            for context in ("buyer", "seller"):
                Account.objects.create(user=user, context=context)
                _, query = self.start(context=context)
                self.assertEqual(self.callback(query)["Location"], settings.FRONTEND_ORIGIN + "/en/account/" + context)

    def test_buyer_and_seller_production_google_onboarding(self):
        for context in ("buyer", "seller"):
            with self.subTest(context=context), patch("apps.accounts.google.exchange", return_value={**self.claims, "email": context + "-google@example.test", "sub": context + "-google-sub"}):
                self.client = APIClient(enforce_csrf_checks=True)
                _, query = self.start(action="register", context=context)
                response = self.callback(query)
                self.assertEqual(self.onboard(response).status_code, 200)
                self.assertEqual(self.client.get("/api/v1/auth/" + context + "/session/").status_code, 200)
                self.assertEqual(self.client.get("/admin/").status_code, 302)
