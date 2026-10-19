import json
import time
from datetime import timedelta
from unittest.mock import MagicMock, patch
from urllib.parse import parse_qs, urlsplit

import environ
from joserfc import jwt
from joserfc.jwk import RSAKey
from django.conf import settings
from django.contrib.sessions.backends.db import SessionStore
from django.core import mail
from django.core.exceptions import ImproperlyConfigured
from django.db import transaction
from django.test import TestCase, TransactionTestCase, SimpleTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient, APIRequestFactory

from apps.accounts import google
from apps.accounts.delivery import dispatch_one, queue_account_mail, reveal, sweep_mail
from apps.accounts.models import Account, AccountMail, ActionToken, BrowserAuthority, GoogleAttempt, GoogleIdentity, User
from apps.accounts.provider_settings import provider_settings
from apps.accounts.services import request_mail
from apps.accounts.views import LogoutView
from tests.test_identity import PASSWORD, post, signin, token_from_mail

GOOGLE = dict(
    GOOGLE_OAUTH_ENABLED=True,
    GOOGLE_CLIENT_ID="synthetic-client",
    GOOGLE_CLIENT_SECRET="synthetic-secret",
    GOOGLE_REDIRECT_URI="http://127.0.0.1:8103/api/v1/auth/google/callback/",
)


class LogoutRegressions(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("race@example.test", PASSWORD, display_name="Race", email_verified=True)
        for context in ["buyer", "seller"]:
            Account.objects.create(user=self.user, context=context)
        self.client = APIClient()
        signin(self.client, "buyer", self.user.email)
        signin(self.client, "seller", self.user.email)
        self.key = self.client.cookies["sessionid"].value

    def stale_request(self, context):
        request = APIRequestFactory().post("/api/v1/auth/" + context + "/logout/", {}, format="json")
        request.session = SessionStore(session_key=self.key)
        self.assertEqual(set(request.session.get("grants", {})), {"buyer", "seller"})
        request.user = self.user
        return request

    def test_overlapping_context_logouts_cannot_restore_grants(self):
        requests = [self.stale_request(c) for c in ["buyer", "seller"]]
        for context, request in zip(["buyer", "seller"], requests):
            self.assertEqual(LogoutView.as_view()(request, context=context).status_code, 200)
            request.session.save()
        for context in ["buyer", "seller"]:
            self.assertEqual(self.client.get("/api/v1/auth/" + context + "/session/").status_code, 403)

    def test_logout_racing_stale_unrelated_session_write_stays_revoked(self):
        stale = self.stale_request("seller")
        self.assertEqual(post(self.client, "buyer/logout/").status_code, 200)
        stale.session["unrelated"] = "changed"
        stale.session.save()
        self.assertEqual(self.client.get("/api/v1/auth/buyer/session/").status_code, 403)
        self.assertEqual(self.client.get("/api/v1/auth/seller/session/").status_code, 200)

    def test_global_logout_racing_stale_save_cannot_revive_browser(self):
        stale = self.stale_request("buyer")
        post(self.client, "logout-all/")
        # Force-insert models the worst possible stale persistence; authority remains revoked.
        stale.session.create()
        self.client.cookies["sessionid"] = stale.session.session_key
        self.assertEqual(self.client.get("/api/v1/auth/buyer/session/").status_code, 403)
        self.assertFalse(BrowserAuthority.objects.filter(revoked=False).exists())


class MailTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("mail@example.test", PASSWORD, display_name="<script>unsafe</script>")

    def test_all_purposes_locales_plain_html_cid_expiry_and_escaping(self):
        for locale in ["fa-AF", "en", "ps", "ar"]:
            for purpose in ["verify", "reset"]:
                with self.subTest(locale=locale, purpose=purpose):
                    ActionToken.objects.all().delete()
                    with self.captureOnCommitCallbacks(execute=True):
                        self.assertEqual(request_mail(self.user, purpose, locale), "queued")
                    message = mail.outbox[-1]
                    self.assertEqual(message.to, [self.user.email])
                    self.assertIn("#token=", message.body)
                    self.assertIn("30" if purpose == "reset" else "1440", message.body)
                    html = message.alternatives[0].content
                    self.assertIn(f'lang="{locale}"', html)
                    self.assertIn('dir="ltr"' if locale == "en" else 'dir="rtl"', html)
                    self.assertIn("&lt;script&gt;", html)
                    self.assertNotIn("<script>", html)
                    self.assertIn("cid:rezayi-brand", html)
                    self.assertEqual(len(message.attachments), 1)
                    if locale != "en":
                        self.assertTrue(any("\u0600" <= c <= "\u06ff" for c in message.subject + message.body))
                    self.assertEqual(AccountMail.objects.get().status, "captured")
                    self.assertEqual(AccountMail.objects.get().encrypted_payload, "")

    def test_rollback_never_dispatches_or_leaves_token(self):
        with self.captureOnCommitCallbacks(execute=True):
            try:
                with transaction.atomic():
                    queue_account_mail(self.user, "verify", "fa-AF")
                    raise ValueError
            except ValueError:
                pass
        self.assertFalse(ActionToken.objects.exists())
        self.assertEqual(len(mail.outbox), 0)

    @patch("apps.accounts.delivery.EmailMultiAlternatives.send", side_effect=TimeoutError("sensitive-provider-text"))
    def test_bounded_retry_uses_same_protected_token_and_cleans_expiry(self, send):
        with self.captureOnCommitCallbacks(execute=True):
            queue_account_mail(self.user, "verify", "en")
        item = AccountMail.objects.get()
        token = item.token
        raw = reveal(item.encrypted_payload)["raw"]
        self.assertNotIn(raw, item.encrypted_payload)
        for attempt in [2, 3, 4]:
            AccountMail.objects.filter(pk=item.pk).update(next_attempt_at=timezone.now() - timedelta(seconds=1))
            dispatch_one(item.pk)
            item.refresh_from_db()
            self.assertEqual(item.token_id, token.pk)
        self.assertEqual(send.call_count, 3)
        self.assertEqual(item.status, "exhausted")
        self.assertEqual(item.encrypted_payload, "")
        self.assertIsNone(token.used_at)

    @override_settings(ACCOUNT_EMAIL_TRANSPORT="smtp")
    def test_smtp_acceptance_is_not_inbox_delivery(self):
        with self.captureOnCommitCallbacks(execute=True):
            queue_account_mail(self.user, "verify", "en")
        self.assertEqual(AccountMail.objects.get().status, "smtp_accepted")

    def test_expiry_scrubs_queued_payload(self):
        queue_account_mail(self.user, "reset", "en")
        AccountMail.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
        sweep_mail()
        self.assertEqual(AccountMail.objects.get().encrypted_payload, "")


class ConfigTests(SimpleTestCase):
    def config(self, **values):
        # Env is explicitly synthetic; no reads from the private runtime file.
        with patch.dict("os.environ", values, clear=True):
            return provider_settings(environ.Env())

    def test_disabled_provider_capture_allows_blank_credentials(self):
        self.assertFalse(self.config()["GOOGLE_OAUTH_ENABLED"])

    def test_enabled_partial_google_fails_closed(self):
        with self.assertRaises(ImproperlyConfigured):
            self.config(GOOGLE_OAUTH_ENABLED="true")

    def test_smtp_requires_credentials_secure_modes_and_bounded_timeout(self):
        base = dict(
            ACCOUNT_EMAIL_TRANSPORT="smtp",
            EMAIL_HOST_USER="sender@example.test",
            EMAIL_HOST_PASSWORD=" do not trim ",
            DEFAULT_FROM_EMAIL="Brand <sender@example.test>",
        )
        self.assertEqual(self.config(**base)["EMAIL_HOST_PASSWORD"], " do not trim ")
        for extra in [
            dict(EMAIL_USE_SSL="true"),
            dict(EMAIL_USE_TLS="false"),
            dict(EMAIL_TIMEOUT="99"),
            dict(EMAIL_PORT="25"),
            dict(EMAIL_HOST_PASSWORD=""),
        ]:
            with self.subTest(extra=list(extra)), self.assertRaises(ImproperlyConfigured):
                self.config(**{**base, **extra})
        self.assertTrue(
            self.config(**base, EMAIL_USE_TLS="false", EMAIL_USE_SSL="true", EMAIL_PORT="465")["EMAIL_USE_SSL"]
        )

    def test_owner_custom_flow_has_four_locales_default_dari(self):
        for locale in ["fa-AF", "en", "ps", "ar"]:
            response = self.client.get("/admin/login/?locale=" + locale)
            self.assertContains(response, f'lang="{locale}"')
        self.assertContains(self.client.get("/admin/login/"), "ورود مدیر سیستم")


@override_settings(**GOOGLE)
class GoogleTests(TestCase):
    def setUp(self):
        self.client = APIClient(enforce_csrf_checks=True)
        self.claims = {"sub": "google-subject-001", "email": "social@example.test", "name": "Social Person"}

    def start(self, **data):
        response = post(self.client, "google/start/", {"context": "buyer", "action": "signin", "locale": "en", **data})
        self.assertEqual(response.status_code, 200)
        query = parse_qs(urlsplit(response.json()["authorization_url"]).query)
        return response.json(), query

    def callback(self, query, **params):
        return self.client.get(
            "/api/v1/auth/google/callback/", {"state": query["state"][0], "code": "synthetic-code", **params}
        )

    def onboard(self, response, intent="individual"):
        attempt = parse_qs(urlsplit(response["Location"]).query)["attempt"][0]
        return post(
            self.client,
            "google/complete/",
            {"attempt_id": attempt, "display_name": "Social", "intent": intent, "consent": True},
        )

    def test_authorization_pkce_nonce_scopes_safe_return_and_encrypted_attempt(self):
        data, q = self.start(return_path="//attacker.example/steal")
        self.assertEqual(q["code_challenge_method"], ["S256"])
        self.assertEqual(set(q["scope"][0].split()), {"openid", "email", "profile"})
        attempt = GoogleAttempt.objects.get()
        self.assertNotIn(q["nonce"][0], attempt.encrypted_payload)
        self.assertNotIn(q["state"][0], json.dumps(list(GoogleAttempt.objects.values()), default=str))
        self.assertEqual(attempt.return_path, "/en/account/buyer")
        self.assertNotIn("access_type", q)

    @patch("apps.accounts.google.exchange")
    def test_new_verified_identity_explicit_onboarding_then_one_role(self, exchange):
        exchange.return_value = self.claims
        _, q = self.start(action="register", context="seller")
        response = self.callback(q)
        self.assertFalse(User.objects.exists())
        response = self.onboard(response, "company")
        self.assertEqual(response.status_code, 200)
        user = User.objects.get()
        self.assertFalse(user.has_usable_password())
        self.assertTrue(user.email_verified)
        self.assertEqual(user.accounts.get().review_status, "pending")
        self.assertEqual(self.client.get("/api/v1/auth/buyer/session/").status_code, 403)
        self.assertEqual(self.client.get("/api/v1/auth/seller/session/").status_code, 200)
        self.assertEqual(self.callback(q).status_code, 403)

    @patch("apps.accounts.google.exchange")
    def test_onboarding_consent_policy_and_replay(self, exchange):
        exchange.return_value = self.claims
        _, q = self.start()
        response = self.callback(q)
        attempt = parse_qs(urlsplit(response["Location"]).query)["attempt"][0]
        data = {"attempt_id": attempt, "display_name": "Social", "intent": "individual", "consent": False}
        self.assertEqual(post(self.client, "google/complete/", data).status_code, 403)
        with override_settings(DEVELOPMENT_SIGNUP_ENABLED=False):
            self.assertEqual(post(self.client, "google/complete/", {**data, "consent": True}).status_code, 403)
        self.assertEqual(self.onboard(response).status_code, 200)
        self.assertEqual(post(self.client, "google/complete/", {**data, "consent": True}).status_code, 403)

    @patch("apps.accounts.google.exchange")
    def test_email_collision_never_merges_or_claims_unverified_local(self, exchange):
        user = User.objects.create_user(self.claims["email"], PASSWORD, display_name="Original")
        exchange.return_value = self.claims
        _, q = self.start()
        response = self.callback(q)
        self.assertIn("google=link_required", response["Location"])
        self.assertFalse(GoogleIdentity.objects.exists())
        user.refresh_from_db()
        self.assertFalse(user.email_verified)
        self.assertTrue(user.check_password(PASSWORD))
        post(self.client, "mail/reset/", {"email": user.email, "locale": "en"})
        raw = token_from_mail()
        self.assertEqual(
            post(self.client, "reset/", {"token": raw, "password": "Recovered-synthetic-pass-4608"}).status_code, 200
        )
        user.refresh_from_db()
        self.assertTrue(user.email_verified)

    @patch("apps.accounts.google.exchange")
    def test_explicit_local_link_requires_fresh_password_and_same_google_email(self, exchange):
        user = User.objects.create_user(self.claims["email"], PASSWORD, display_name="Original", email_verified=True)
        Account.objects.create(user=user, context="buyer")
        signin(self.client, "buyer", user.email)
        data = {
            "context": "buyer",
            "source_context": "buyer",
            "action": "link",
            "locale": "en",
            "password": "incorrect",
        }
        self.assertEqual(post(self.client, "google/start/", data).status_code, 403)
        _, q = self.start(**{**data, "password": PASSWORD})
        exchange.return_value = self.claims
        self.assertIn("google=linked", self.callback(q)["Location"])
        user.refresh_from_db()
        self.assertTrue(user.check_password(PASSWORD))
        self.assertEqual(GoogleIdentity.objects.get().user, user)

    @patch("apps.accounts.google.exchange")
    def test_google_only_second_role_reauth_creates_pending_without_grant(self, exchange):
        user = User.objects.create_user(self.claims["email"], None, display_name="Social", email_verified=True)
        Account.objects.create(user=user, context="buyer")
        GoogleIdentity.objects.create(user=user, subject=self.claims["sub"])
        exchange.return_value = self.claims
        _, q = self.start()
        self.callback(q)
        _, q = self.start(context="seller", source_context="buyer", action="add-role")
        self.assertEqual(q["prompt"], ["consent select_account"])
        self.assertEqual(self.onboard(self.callback(q), "company").status_code, 200)
        self.assertEqual(Account.objects.get(context="seller").review_status, "pending")
        self.assertEqual(self.client.get("/api/v1/auth/seller/session/").status_code, 403)
        self.assertEqual(self.client.get("/api/v1/auth/buyer/session/").status_code, 200)

    @patch("apps.accounts.google.exchange")
    def test_linked_subject_not_changed_email_and_no_missing_or_suspended_role(self, exchange):
        user = User.objects.create_user("original@example.test", None, display_name="Social", email_verified=True)
        account = Account.objects.create(user=user, context="buyer")
        GoogleIdentity.objects.create(user=user, subject=self.claims["sub"])
        exchange.return_value = self.claims
        _, q = self.start(context="seller")
        self.assertIn("account_unavailable", self.callback(q)["Location"])
        account.status = "suspended"
        account.save()
        _, q = self.start()
        self.assertIn("account_unavailable", self.callback(q)["Location"])
        account.status = "active"
        account.save()
        _, q = self.start()
        self.assertEqual(self.callback(q)["Location"], settings.FRONTEND_ORIGIN + "/en/account/buyer")
        user.refresh_from_db()
        self.assertEqual(user.email, "original@example.test")
        self.assertEqual(self.client.get("/api/v1/auth/staff/session/").status_code, 403)
        self.assertEqual(self.client.get("/admin/").status_code, 302)

    @patch("apps.accounts.google.exchange")
    def test_browser_expiry_unsolicited_cancel_failure_and_replay(self, exchange):
        _, q = self.start()
        stranger = APIClient()
        self.assertEqual(
            stranger.get("/api/v1/auth/google/callback/", {"state": q["state"][0], "code": "code"}).status_code, 403
        )
        self.assertFalse(exchange.called)
        self.assertEqual(
            self.client.get("/api/v1/auth/google/callback/", {"state": "unsolicited", "code": "code"}).status_code, 403
        )
        self.assertIn("cancelled", self.callback(q, error="access_denied")["Location"])
        self.assertFalse(exchange.called)
        self.assertEqual(self.callback(q).status_code, 403)
        _, q = self.start()
        GoogleAttempt.objects.filter(state_digest=google.digest(q["state"][0])).update(
            expires_at=timezone.now() - timedelta(seconds=1)
        )
        self.assertEqual(self.callback(q).status_code, 403)
        _, q = self.start()
        exchange.side_effect = TimeoutError("private")
        self.assertIn("provider_error", self.callback(q)["Location"])
        self.assertEqual(self.callback(q).status_code, 403)
        self.assertFalse(User.objects.exists())

    def test_privileged_contexts_and_callback_mutation_fail_closed(self):
        for context in ["staff", "owner"]:
            self.assertEqual(
                post(
                    self.client, "google/start/", {"context": context, "action": "signin", "locale": "en"}
                ).status_code,
                400,
            )
        self.assertEqual(self.client.post("/api/v1/auth/google/start/", {"context": "buyer"}).status_code, 403)
        with override_settings(GOOGLE_OAUTH_ENABLED=False):
            self.assertEqual(
                post(self.client, "google/start/", {"context": "buyer", "action": "signin", "locale": "en"}).json()[
                    "status"
                ],
                "google_unavailable",
            )

    @patch("apps.accounts.google.exchange")
    def test_parallel_tabs_have_independent_attempts_and_credential_binding(self, exchange):
        _, first = self.start(locale="fa-AF")
        _, second = self.start(context="seller", locale="ar")
        exchange.return_value = self.claims
        self.assertIn("/fa-AF/auth/google-result", self.callback(first)["Location"])
        self.assertIn("/ar/auth/google-result", self.callback(second)["Location"])
        user = User.objects.create_user("other@example.test", PASSWORD, display_name="Other", email_verified=True)
        Account.objects.create(user=user, context="buyer")
        signin(self.client, "buyer", user.email)
        attempt = GoogleAttempt.objects.first()
        self.assertEqual(
            post(
                self.client,
                "google/complete/",
                {"attempt_id": str(attempt.pk), "display_name": "Other", "intent": "individual", "consent": True},
            ).status_code,
            403,
        )

    @patch("apps.accounts.google.exchange")
    def test_google_only_password_recovery_preserves_link_and_suspended_roles(self, exchange):
        user = User.objects.create_user(self.claims["email"], None, display_name="Social", email_verified=True)
        Account.objects.create(user=user, context="buyer", status="suspended")
        GoogleIdentity.objects.create(user=user, subject=self.claims["sub"])
        post(self.client, "mail/reset/", {"email": user.email, "locale": "en"})
        self.assertEqual(
            post(self.client, "reset/", {"token": token_from_mail(), "password": PASSWORD}).status_code, 200
        )
        user.refresh_from_db()
        self.assertTrue(user.check_password(PASSWORD))
        self.assertEqual(GoogleIdentity.objects.get().user, user)
        exchange.return_value = self.claims
        _, query = self.start()
        self.assertIn("account_unavailable", self.callback(query)["Location"])
        self.assertEqual(self.client.get("/api/v1/auth/buyer/session/").status_code, 403)


@override_settings(**GOOGLE)
class OIDCCryptoTests(SimpleTestCase):
    def test_documented_google_issuer_without_scheme_is_accepted(self):
        self.assertEqual(self.verify(iss="accounts.google.com")["sub"], "subject")

    def test_package_name_must_not_be_an_accepted_google_issuer(self):
        with self.assertRaises(Exception):
            self.verify(iss="apps.accounts.google.com")

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.key = RSAKey.generate_key(2048, parameters={"kid": "synthetic-key"})
        cls.jwks = {"keys": [cls.key.as_dict(private=False)]}

    def verify(self, **changes):
        claims = {
            "iss": google.ISSUER,
            "sub": "subject",
            "aud": "synthetic-client",
            "iat": int(time.time()),
            "exp": int(time.time()) + 300,
            "nonce": "synthetic-nonce",
            "email": "person@example.test",
            "email_verified": True,
            **changes,
        }
        token = jwt.encode({"alg": "RS256", "kid": "synthetic-key"}, claims, self.key, algorithms=["RS256"])
        provider = MagicMock()
        provider.__enter__.return_value = provider
        provider.fetch_token.return_value = {"id_token": token}
        response = MagicMock()
        response.json.return_value = self.jwks
        with (
            patch("apps.accounts.google.client", return_value=provider),
            patch("apps.accounts.google.requests.get", return_value=response),
        ):
            result = google.exchange("synthetic-code", {"nonce": "synthetic-nonce", "verifier": "synthetic-verifier"})
            self.assertEqual(provider.fetch_token.call_args.kwargs["code_verifier"], "synthetic-verifier")
            return result

    def test_valid_signed_oidc(self):
        self.assertEqual(self.verify()["sub"], "subject")

    def test_bad_audience_issuer_expiry_nonce_verified_email_and_missing_subject(self):
        for changes in [
            {"aud": "attacker"},
            {"iss": "https://attacker.example"},
            {"exp": int(time.time()) - 90},
            {"nonce": "wrong"},
            {"email_verified": False},
            {"email_verified": "true"},
            {"sub": ""},
            {"nonce": None},
        ]:
            with self.subTest(fields=list(changes)), self.assertRaises(Exception):
                self.verify(**changes)

    def test_wrong_signature(self):
        old = self.jwks
        self.jwks = {"keys": [RSAKey.generate_key(2048, private=False, parameters={"kid": "synthetic-key"}).as_dict()]}
        try:
            with self.assertRaises(Exception):
                self.verify()
        finally:
            self.jwks = old


@override_settings(**GOOGLE)
class ConcurrentGoogleTests(TransactionTestCase):
    def test_two_social_onboardings_same_subject_email_create_one_identity(self):
        import hashlib
        from concurrent.futures import ThreadPoolExecutor
        from django.contrib.auth.models import AnonymousUser
        from django.db import connections
        from apps.accounts.delivery import protect
        from apps.accounts.services import AuthFailure

        attempts = []
        for _ in range(2):
            request = APIRequestFactory().post("/api/v1/auth/google/complete/", {})
            request.user = AnonymousUser()
            request.session = SessionStore()
            request.session.create()
            binding = google.browser(request)
            request.session.save()
            attempt = GoogleAttempt.objects.create(
                state_digest=hashlib.sha256(str(request.session.session_key).encode()).hexdigest(),
                browser_digest=binding,
                context="buyer",
                locale="en",
                action="register",
                return_path="/en/account/buyer",
                encrypted_payload=protect(
                    {
                        "verified": True,
                        "claims": {"sub": "same-subject", "email": "duplicate@example.test", "name": "Synthetic"},
                    }
                ),
                expires_at=timezone.now() + timedelta(minutes=5),
                consumed_at=timezone.now(),
            )
            attempts.append((request.session.session_key, attempt.pk))

        def finish(item):
            connections.close_all()
            key, pk = item
            request = APIRequestFactory().post("/api/v1/auth/google/complete/", {})
            request.user = AnonymousUser()
            request.session = SessionStore(session_key=key)
            try:
                return google.complete(
                    request, {"attempt_id": pk, "consent": True, "intent": "individual", "display_name": "Synthetic"}
                )["status"]
            except AuthFailure:
                return "denied"
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(finish, attempts))
        self.assertEqual(sorted(results), ["denied", "signed_in"])
        self.assertEqual(User.objects.filter(email="duplicate@example.test").count(), 1)
        self.assertEqual(GoogleIdentity.objects.count(), 1)
        self.assertEqual(Account.objects.count(), 1)

    def test_parallel_explicit_links_create_one_provider_record(self):
        from concurrent.futures import ThreadPoolExecutor
        from django.db import connections

        user = User.objects.create_user("linked@example.test", PASSWORD, display_name="Link", email_verified=True)
        Account.objects.create(user=user, context="buyer")
        client = APIClient()
        signin(client, "buyer", user.email)
        states = []
        for _ in range(2):
            response = post(
                client,
                "google/start/",
                {"context": "buyer", "source_context": "buyer", "action": "link", "locale": "en", "password": PASSWORD},
            )
            states.append(parse_qs(urlsplit(response.json()["authorization_url"]).query)["state"][0])
        key = client.cookies["sessionid"].value

        def finish(state):
            connections.close_all()
            request = APIRequestFactory().get(
                "/api/v1/auth/google/callback/", {"state": state, "code": "synthetic-code"}
            )
            request.user = User.objects.get(pk=user.pk)
            request.session = SessionStore(session_key=key)
            try:
                return google.callback(request)[1]
            finally:
                connections.close_all()

        with patch(
            "apps.accounts.google.exchange", return_value={"sub": "same-link-subject", "email": user.email, "name": "Link"}
        ):
            with ThreadPoolExecutor(max_workers=2) as pool:
                results = list(pool.map(finish, states))
        self.assertEqual(results, ["linked", "linked"])
        self.assertEqual(GoogleIdentity.objects.count(), 1)
        self.assertEqual(Account.objects.count(), 1)
        user.refresh_from_db()
        self.assertTrue(user.check_password(PASSWORD))


class MailCommitTests(TransactionTestCase):
    def test_real_commit_precedes_dispatch(self):
        user = User.objects.create_user("commit@example.test", PASSWORD, display_name="Commit")
        with transaction.atomic():
            queue_account_mail(user, "verify", "fa-AF")
            self.assertEqual(len(mail.outbox), 0)
            self.assertEqual(AccountMail.objects.get().status, "queued")
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(AccountMail.objects.get().status, "captured")
