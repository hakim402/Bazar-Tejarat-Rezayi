import base64
import json
import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from unittest.mock import patch

from django.conf import settings
from django.contrib.auth.models import Group, Permission
from django.core import mail
from django.db import IntegrityError, connections, transaction
from django.test import TestCase, TransactionTestCase, override_settings
from django.utils import timezone
from django_otp.oath import TOTP
from rest_framework.test import APIClient

from apps.accounts.models import AccountMail, Account, ActionToken, AuditEvent, Authenticator, MailAttempt, RateBucket, User

PASSWORD = "Synthetic-strong-pass-2048"
NEW_PASSWORD = "Another-synthetic-pass-4096"
ORIGIN = settings.FRONTEND_ORIGIN


def post(client, path, data=None, *, origin=ORIGIN):
    token = client.get("/api/v1/auth/csrf/").json()["csrf_token"]
    with TestCase.captureOnCommitCallbacks(execute=True):
        return client.post("/api/v1/auth/" + path, data or {}, format="json", HTTP_X_CSRFTOKEN=token, HTTP_ORIGIN=origin)


def signin(client, context="buyer", email="person@example.test", password=PASSWORD):
    return post(client, context + "/signin/", {"email": email, "password": password})


def code(device, offset=0):
    otp = TOTP(device.secret)
    otp.time = time.time() + offset * 30
    return f"{otp.token():06}"


def token_from_mail():
    return re.search(r"#token=([A-Za-z0-9_-]+)", mail.outbox[-1].body)[1]


class IdentityTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            "person@example.test", PASSWORD, display_name="Synthetic Person", email_verified=True
        )
        self.buyer = Account.objects.create(user=self.user, context="buyer")
        self.seller = Account.objects.create(user=self.user, context="seller", review_status="pending")
        self.client = APIClient(enforce_csrf_checks=True)

    def registration(self, **extra):
        return post(
            self.client,
            "buyer/register/",
            {
                "email": "new@example.test",
                "password": PASSWORD,
                "display_name": "New Person",
                "intent": "individual",
                "consent": True,
                **extra,
            },
        )

    def test_signup_case_variant_duplicate_keeps_password_and_roles(self):
        self.assertEqual(self.registration(email="New@Example.Test").status_code, 202)
        self.assertEqual(self.registration(email="new@example.test", password=NEW_PASSWORD).status_code, 202)
        user = User.objects.get(email="new@example.test")
        self.assertTrue(user.check_password(PASSWORD))
        self.assertFalse(user.email_verified)
        self.assertFalse(user.is_staff)
        self.assertEqual(user.accounts.count(), 1)
        self.assertEqual(user.accounts.get().review_status, "not_requested")

    def test_database_case_insensitive_constraint(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            User.objects.bulk_create([User(email="PERSON@example.test", display_name="Collision", password="unusable")])

    def test_signup_rejects_privilege_mass_assignment_and_invalid_intent(self):
        for key, value in [
            ("is_staff", True),
            ("owner_authority", True),
            ("is_superuser", True),
            ("review_status", "approved"),
            ("groups", [1]),
            ("user", str(self.user.pk)),
        ]:
            self.assertEqual(self.registration(**{key: value}).status_code, 400)
        self.assertEqual(self.registration(intent="company").status_code, 400)
        self.assertFalse(User.objects.filter(email="new@example.test").exists())

    def test_buyer_business_and_seller_are_pending_separate_reviews(self):
        self.assertEqual(self.registration(intent="business").status_code, 202)
        self.assertEqual(Account.objects.get(user__email="new@example.test").review_status, "pending")
        response = post(
            self.client,
            "seller/register/",
            {
                "email": "seller@example.test",
                "password": PASSWORD,
                "display_name": "Seller",
                "intent": "company",
                "consent": True,
            },
        )
        self.assertEqual(response.status_code, 202)
        self.assertEqual(Account.objects.get(user__email="seller@example.test").review_status, "pending")

    @override_settings(DEVELOPMENT_SIGNUP_ENABLED=False)
    def test_launch_registration_fails_closed_without_approved_policies(self):
        self.assertEqual(self.registration().status_code, 403)

    def test_verification_one_use_expiry_and_state_binding(self):
        self.registration()
        raw = token_from_mail()
        self.assertNotIn(raw, json.dumps(list(ActionToken.objects.values()), default=str))
        self.assertEqual(post(self.client, "verify/", {"token": raw}).status_code, 200)
        self.assertEqual(post(self.client, "verify/", {"token": raw}).status_code, 400)
        user = User.objects.get(email="new@example.test")
        self.assertTrue(user.email_verified)
        self.assertEqual(user.accounts.get().review_status, "not_requested")
        self.assertEqual(self.client.get("/api/v1/auth/buyer/session/").status_code, 403)

    def test_expired_token_and_resend_cooldown(self):
        self.registration()
        raw = token_from_mail()
        count = len(mail.outbox)
        self.assertEqual(post(self.client, "mail/verify/", {"email": "new@example.test"}).status_code, 202)
        self.assertEqual(len(mail.outbox), count)
        ActionToken.objects.update(
            expires_at=timezone.now() - timedelta(seconds=1), created_at=timezone.now() - timedelta(minutes=2)
        )
        self.assertEqual(post(self.client, "verify/", {"token": raw}).status_code, 400)
        post(self.client, "mail/verify/", {"email": "new@example.test"})
        new = token_from_mail()
        self.assertNotEqual(raw, new)
        self.assertEqual(post(self.client, "verify/", {"token": raw}).status_code, 400)
        self.assertEqual(post(self.client, "verify/", {"token": new}).status_code, 200)

    @patch("apps.accounts.delivery.EmailMultiAlternatives.send", side_effect=RuntimeError("private-provider-detail"))
    def test_mail_failure_is_truthful_neutral_recorded_and_retryable(self, send):
        self.assertEqual(self.registration().status_code, 202)
        self.assertEqual(MailAttempt.objects.get().status, "failed")
        self.assertIsNone(ActionToken.objects.get().used_at)
        self.assertEqual(AccountMail.objects.get().status, "delivery_failed")
        self.assertFalse(AuditEvent.objects.filter(action__contains="private").exists())
        post(self.client, "mail/verify/", {"email": "unknown@example.test"})
        post(self.client, "mail/verify/", {"email": "new@example.test"})
        self.assertEqual(MailAttempt.objects.count(), 1)  # Cooldown preserves the same token for retry.

    def test_login_requires_csrf_even_when_anonymous(self):
        response = self.client.post(
            "/api/v1/auth/buyer/signin/",
            {"email": self.user.email, "password": PASSWORD},
            format="json",
            HTTP_ORIGIN=ORIGIN,
        )
        self.assertEqual(response.status_code, 403)
        self.assertNotIn("grants", self.client.session)

    def test_origin_rejection_and_csrf_rotation_no_private_caching(self):
        self.assertEqual(
            post(
                self.client,
                "buyer/signin/",
                {"email": self.user.email, "password": PASSWORD},
                origin="https://evil.example",
            ).status_code,
            403,
        )
        initial = self.client.get("/api/v1/auth/csrf/").json()["csrf_token"]
        old_cookie = self.client.cookies["csrftoken"].value
        self.assertEqual(signin(self.client).status_code, 200)
        self.assertNotEqual(old_cookie, self.client.cookies["csrftoken"].value)
        rejected = self.client.post(
            "/api/v1/auth/buyer/logout/", {}, format="json", HTTP_X_CSRFTOKEN=initial, HTTP_ORIGIN=ORIGIN
        )
        self.assertEqual(rejected.status_code, 403)
        response = self.client.get("/api/v1/auth/buyer/session/")
        self.assertEqual(response["Cache-Control"], "private, no-store")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(post(self.client, "buyer/logout/").status_code, 200)

    def test_csrf_failure_keeps_safe_cors_and_no_store(self):
        response = self.client.post("/api/v1/auth/buyer/signin/", {}, format="json", HTTP_ORIGIN=ORIGIN)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["error"]["code"], "csrf_failed")
        self.assertEqual(response["Access-Control-Allow-Origin"], ORIGIN)
        self.assertEqual(response["Access-Control-Allow-Credentials"], "true")
        self.assertEqual(response["Cache-Control"], "private, no-store")
        denied = self.client.get("/api/v1/auth/csrf/", HTTP_ORIGIN="https://evil.example")
        self.assertNotIn("Access-Control-Allow-Origin", denied)

    def test_foreign_account_grant_is_rejected_and_disabled_identity_stays_revoked(self):
        other = User.objects.create_user("foreign@example.test", PASSWORD, display_name="Foreign", email_verified=True)
        foreign = Account.objects.create(user=other, context="buyer")
        signin(self.client)
        session = self.client.session
        session["grants"]["buyer"]["account"] = str(foreign.pk)
        session.save()
        self.assertEqual(self.client.get("/api/v1/auth/buyer/session/").status_code, 403)
        signin(self.client)
        self.user.is_active = False
        self.user.save(update_fields=["is_active"])
        self.user.is_active = True
        self.user.save(update_fields=["is_active"])
        self.assertEqual(self.client.get("/api/v1/auth/buyer/session/").status_code, 403)

    def test_shared_credentials_require_distinct_grants_and_ids(self):
        self.assertEqual(signin(self.client).status_code, 200)
        self.assertEqual(self.client.get("/api/v1/auth/buyer/session/").json()["accounts"][0]["id"], str(self.buyer.pk))
        self.assertEqual(self.client.get("/api/v1/auth/seller/session/").status_code, 403)
        self.assertEqual(self.client.get("/api/v1/auth/staff/session/").status_code, 403)
        self.assertEqual(signin(self.client, "seller").status_code, 200)
        self.assertEqual(
            self.client.get("/api/v1/auth/seller/session/").json()["accounts"][0]["id"], str(self.seller.pk)
        )
        self.assertEqual(self.client.get("/api/v1/auth/buyer/session/").status_code, 200)

    def test_context_logout_keeps_other_context_and_global_logout_ends_all(self):
        signin(self.client)
        signin(self.client, "seller")
        self.assertEqual(post(self.client, "buyer/logout/").status_code, 200)
        self.assertEqual(self.client.get("/api/v1/auth/buyer/session/").status_code, 403)
        self.assertEqual(self.client.get("/api/v1/auth/seller/session/").status_code, 200)
        post(self.client, "logout-all/")
        self.assertEqual(self.client.get("/api/v1/auth/seller/session/").status_code, 403)

    def test_other_identity_cannot_inherit_prior_grants(self):
        other = User.objects.create_user("other@example.test", PASSWORD, display_name="Other", email_verified=True)
        Account.objects.create(user=other, context="buyer")
        signin(self.client, "seller")
        signin(self.client, email=other.email)
        self.assertEqual(self.client.get("/api/v1/auth/seller/session/").status_code, 403)
        self.assertEqual(self.client.get("/api/v1/auth/buyer/session/").json()["identity"]["id"], str(other.pk))

    def test_live_status_and_grant_expiry_and_other_account_ids(self):
        signin(self.client)
        self.buyer.status = "suspended"
        self.buyer.save()
        self.assertEqual(self.client.get("/api/v1/auth/buyer/session/").status_code, 403)
        self.buyer.status = "active"
        self.buyer.save()
        self.assertEqual(self.client.get("/api/v1/auth/buyer/session/").status_code, 403)
        signin(self.client)
        session = self.client.session
        session["grants"]["buyer"]["at"] = time.time() - 28801
        session.save()
        self.assertEqual(self.client.get("/api/v1/auth/buyer/session/").status_code, 403)
        signin(self.client)
        self.user.is_active = False
        self.user.save()
        self.assertEqual(self.client.get("/api/v1/auth/buyer/session/").status_code, 403)

    def test_profile_cannot_change_identity_account_or_permission_fields(self):
        signin(self.client)
        csrf = self.client.get("/api/v1/auth/csrf/").json()["csrf_token"]
        for field in ["email", "password", "is_staff", "review_status", "account_id"]:
            response = self.client.patch(
                "/api/v1/auth/buyer/profile/", {field: "bad"}, format="json", HTTP_X_CSRFTOKEN=csrf, HTTP_ORIGIN=ORIGIN
            )
            self.assertEqual(response.status_code, 400)
        response = self.client.patch(
            "/api/v1/auth/buyer/profile/",
            {"display_name": "Updated Person"},
            format="json",
            HTTP_X_CSRFTOKEN=csrf,
            HTTP_ORIGIN=ORIGIN,
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(
            AuditEvent.objects.filter(
                action="profile_updated", actor=self.user, account=self.buyer, request_id__isnull=False
            ).exists()
        )

    def test_authenticated_link_preserves_password_and_no_automatic_grant(self):
        user = User.objects.create_user("link@example.test", PASSWORD, display_name="Link", email_verified=True)
        Account.objects.create(user=user, context="buyer")
        signin(self.client, email=user.email)
        self.assertEqual(
            post(self.client, "buyer/link/seller/", {"password": PASSWORD, "intent": "individual"}).status_code, 200
        )
        user.refresh_from_db()
        self.assertTrue(user.check_password(PASSWORD))
        self.assertEqual(self.client.get("/api/v1/auth/seller/session/").status_code, 403)
        self.assertEqual(Account.objects.get(user=user, context="seller").review_status, "pending")
        self.assertEqual(
            post(self.client, "buyer/link/seller/", {"password": PASSWORD, "intent": "individual"}).status_code, 400
        )

    def test_link_denies_anonymous_wrong_password_and_archived_revival(self):
        self.assertEqual(
            post(self.client, "buyer/link/seller/", {"password": PASSWORD, "intent": "individual"}).status_code, 403
        )
        signin(self.client)
        self.assertEqual(
            post(self.client, "buyer/link/seller/", {"password": "wrong", "intent": "individual"}).status_code, 403
        )
        self.seller.status = "archived"
        self.seller.save()
        self.assertEqual(
            post(self.client, "buyer/link/seller/", {"password": PASSWORD, "intent": "individual"}).status_code, 400
        )
        self.seller.refresh_from_db()
        self.assertEqual(self.seller.status, "archived")

    def test_password_change_invalidates_linked_contexts_on_all_devices(self):
        device = APIClient(enforce_csrf_checks=True)
        signin(self.client)
        signin(self.client, "seller")
        signin(device, "seller")
        self.assertEqual(
            post(self.client, "buyer/password/", {"current_password": PASSWORD, "password": NEW_PASSWORD}).status_code,
            200,
        )
        for client in [self.client, device]:
            for context in ["buyer", "seller"]:
                self.assertEqual(client.get(f"/api/v1/auth/{context}/session/").status_code, 403)
        self.assertEqual(signin(self.client, password=NEW_PASSWORD).status_code, 200)

    def test_recovery_one_use_state_bound_preserves_suspension_and_mfa(self):
        self.seller.status = "suspended"
        self.seller.save()
        signin(self.client)
        device = Authenticator(user=self.user, name="Factor", confirmed=True)
        device.set_secret()
        device.save()
        response = post(self.client, "mail/reset/", {"email": self.user.email})
        raw = token_from_mail()
        self.assertEqual(response.status_code, 202)
        self.assertEqual(post(self.client, "reset/", {"token": raw, "password": NEW_PASSWORD}).status_code, 200)
        self.assertEqual(post(self.client, "reset/", {"token": raw, "password": PASSWORD}).status_code, 400)
        self.assertEqual(signin(self.client, "seller", password=NEW_PASSWORD).status_code, 403)
        self.assertTrue(Authenticator.objects.filter(user=self.user, confirmed=True).exists())

    def test_enumeration_neutral_login_mail_and_bounded_attempts(self):
        known = signin(self.client, password="wrong")
        unknown = signin(self.client, email="unknown@example.test", password="wrong")
        self.assertEqual(known.status_code, unknown.status_code)
        self.assertEqual(known.json()["error"]["message"], unknown.json()["error"]["message"])
        self.assertEqual(
            post(self.client, "mail/reset/", {"email": self.user.email}).json(),
            post(self.client, "mail/reset/", {"email": "unknown@example.test"}).json(),
        )
        for _ in range(13):
            response = signin(self.client, password="wrong")
        self.assertEqual(response.status_code, 429)
        RateBucket.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(signin(self.client).status_code, 200)


class PrivilegedTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("staff@example.test", PASSWORD, display_name="Staff", email_verified=True)
        self.account = Account.objects.create(user=self.user, context="staff")
        self.client = APIClient(enforce_csrf_checks=True)

    def enroll(self, context="staff"):
        self.assertEqual(signin(self.client, context, self.user.email).json()["status"], "enroll")
        response = post(self.client, "mfa/enroll/")
        self.assertEqual(response.status_code, 200)
        device = Authenticator.objects.get(user=self.user)
        self.assertNotIn(base64.b32encode(device.secret).decode(), device.encrypted_secret)
        result = post(self.client, "mfa/challenge/", {"code": code(device)})
        self.assertEqual(result.status_code, 200)
        return result.json()["recovery_codes"], device

    def test_password_only_cannot_open_staff_or_admin(self):
        self.assertEqual(signin(self.client, "staff", self.user.email).status_code, 200)
        self.assertEqual(self.client.get("/api/v1/auth/staff/session/").status_code, 403)
        self.assertEqual(self.client.get("/admin/").status_code, 302)
        self.assertFalse(self.user.is_staff)

    def test_owner_form_retains_same_origin_csrf_protection(self):
        response = self.client.get("/admin/login/", HTTP_HOST="127.0.0.1:8100")
        self.assertEqual(response["Referrer-Policy"], "same-origin")
        denied = self.client.post(
            "/admin/login/",
            {"stage": "password", "email": "missing@example.test", "password": "wrong"},
            HTTP_HOST="127.0.0.1:8100",
            HTTP_ORIGIN="http://127.0.0.1:8100",
        )
        self.assertEqual(denied.status_code, 403)
        token = self.client.cookies["csrftoken"].value
        response = self.client.post(
            "/admin/login/",
            {"stage": "password", "email": "missing@example.test", "password": "wrong", "csrfmiddlewaretoken": token},
            HTTP_HOST="127.0.0.1:8100",
            HTTP_ORIGIN="http://127.0.0.1:8100",
        )
        self.assertEqual(response.status_code, 200)

    def test_enrollment_challenge_replay_and_single_use_recovery(self):
        codes, device = self.enroll()
        self.assertEqual(len(codes), 8)
        self.assertEqual(self.client.get("/api/v1/auth/staff/session/").status_code, 200)
        self.assertEqual(self.client.get("/admin/").status_code, 302)
        post(self.client, "logout-all/")
        signin(self.client, "staff", self.user.email)
        self.assertEqual(post(self.client, "mfa/challenge/", {"code": code(device)}).status_code, 403)
        self.assertEqual(post(self.client, "mfa/challenge/", {"code": codes[0], "recovery": True}).status_code, 200)
        post(self.client, "logout-all/")
        signin(self.client, "staff", self.user.email)
        self.assertEqual(post(self.client, "mfa/challenge/", {"code": codes[0], "recovery": True}).status_code, 403)

    def test_owner_authority_and_completed_owner_context_required(self):
        self.user.is_staff = True
        self.user.is_superuser = True
        self.user.owner_authority = True
        self.user.save()
        Account.objects.create(user=self.user, context="buyer")
        signin(self.client, "buyer", self.user.email)
        self.assertEqual(self.client.get("/admin/").status_code, 302)
        self.enroll("owner")
        response = self.client.get("/admin/")
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Bazar Rezayi")
        self.assertEqual(self.client.get("/api/v1/auth/staff/session/").status_code, 403)

    def test_live_permission_group_revocation_and_no_superuser_business_bypass(self):
        self.user.is_superuser = True
        self.user.save()
        self.enroll()
        self.assertEqual(self.client.get("/api/v1/auth/staff/session/").json()["accounts"][0]["permissions"], [])
        group = Group.objects.create(name="Rezayi: Support")
        group.permissions.add(Permission.objects.get(codename="handle_support"))
        self.account.permission_groups.add(group)
        self.assertEqual(self.client.get("/api/v1/auth/staff/session/").status_code, 403)

    def test_factor_reset_needs_password_and_factor_and_invalidates_grants(self):
        codes, device = self.enroll()
        self.assertEqual(
            post(
                self.client, "staff/mfa/reset/", {"password": "wrong", "code": codes[0], "recovery": True}
            ).status_code,
            403,
        )
        self.assertEqual(
            post(
                self.client, "staff/mfa/reset/", {"password": PASSWORD, "code": codes[0], "recovery": True}
            ).status_code,
            200,
        )
        self.assertFalse(Authenticator.objects.filter(user=self.user).exists())
        self.assertEqual(self.client.get("/api/v1/auth/staff/session/").status_code, 403)

    def test_expired_pending_challenge_and_rate_limit(self):
        signin(self.client, "staff", self.user.email)
        session = self.client.session
        session["pending_mfa"]["at"] = time.time() - 301
        session.save()
        self.assertEqual(post(self.client, "mfa/enroll/").status_code, 403)
        signin(self.client, "staff", self.user.email)
        post(self.client, "mfa/enroll/")
        for _ in range(9):
            response = post(self.client, "mfa/challenge/", {"code": "000000"})
        self.assertEqual(response.status_code, 429)

    def test_audit_contains_no_password_token_or_factor_material(self):
        codes, device = self.enroll()
        values = json.dumps(list(AuditEvent.objects.values()), default=str)
        for private in [PASSWORD, base64.b32encode(device.secret).decode(), *codes]:
            self.assertNotIn(private, values)
        self.assertTrue(AuditEvent.objects.filter(action="mfa_enrolled").exists())

    def test_bad_challenge_is_durably_audited(self):
        signin(self.client, "staff", self.user.email)
        post(self.client, "mfa/enroll/")
        self.assertEqual(post(self.client, "mfa/challenge/", {"code": "not-valid"}).status_code, 403)
        self.assertTrue(
            AuditEvent.objects.filter(
                action="mfa_challenge_failed", subject=self.user, request_id__isnull=False
            ).exists()
        )

    def test_reset_credential_during_pending_challenge_is_rechecked_under_lock(self):
        signin(self.client, "staff", self.user.email)
        post(self.client, "mfa/enroll/")
        from apps.accounts.services import pending_identity

        pending = pending_identity(self.client.get("/api/v1/auth/csrf/").wsgi_request)
        self.user.set_password(NEW_PASSWORD)
        self.user.save()
        with patch("apps.accounts.services.pending_identity", return_value=pending):
            self.assertEqual(
                post(
                    self.client, "mfa/challenge/", {"code": code(Authenticator.objects.get(user=self.user))}
                ).status_code,
                403,
            )

    def test_owner_can_provision_staff_and_assign_groups_without_admin_flags(self):
        self.user.is_staff = self.user.is_superuser = self.user.owner_authority = True
        self.user.save()
        self.enroll("owner")
        token = self.client.get("/api/v1/auth/csrf/").json()["csrf_token"]
        response = self.client.post(
            "/admin/accounts/user/add/",
            {
                "email": "new-staff@example.test",
                "display_name": "New Staff",
                "password1": PASSWORD,
                "password2": PASSWORD,
                "_save": "Save",
            },
            HTTP_X_CSRFTOKEN=token,
            HTTP_ORIGIN=ORIGIN,
        )
        self.assertEqual(response.status_code, 302)
        new = User.objects.get(email="new-staff@example.test")
        self.assertFalse(new.is_staff)
        group = Group.objects.create(name="Rezayi: Support")
        group.permissions.add(Permission.objects.get(codename="handle_support"))
        response = self.client.post(
            "/admin/accounts/account/add/",
            {"user": str(new.pk), "status": "active", "permission_groups": [str(group.pk)], "_save": "Save"},
            HTTP_X_CSRFTOKEN=token,
            HTTP_ORIGIN=ORIGIN,
        )
        self.assertEqual(response.status_code, 302)
        account = Account.objects.get(user=new)
        self.assertEqual(account.context, "staff")
        self.assertEqual(list(account.permission_groups.values_list("name", flat=True)), ["Rezayi: Support"])
        self.assertTrue(
            AuditEvent.objects.filter(
                action="owner_staff_permissions_changed", actor=self.user, account=account
            ).exists()
        )


class RaceTests(TransactionTestCase):
    reset_sequences = True

    def parallel(self, function):
        def invoke(i):
            try:
                return function(i)
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            return list(pool.map(invoke, range(2)))

    def test_registration_race_is_single_identity_and_account(self):
        def run(i):
            client = APIClient(enforce_csrf_checks=True)
            return post(
                client,
                "buyer/register/",
                {
                    "email": "Race@example.test" if i else "race@example.test",
                    "password": PASSWORD,
                    "display_name": "Race",
                    "intent": "individual",
                    "consent": True,
                },
            ).status_code

        self.assertEqual(self.parallel(run), [202, 202])
        self.assertEqual(User.objects.filter(email="race@example.test").count(), 1)
        self.assertEqual(Account.objects.count(), 1)

    def test_password_token_race_changes_password_once(self):
        user = User.objects.create_user("race@example.test", PASSWORD, display_name="Race", email_verified=True)
        client = APIClient(enforce_csrf_checks=True)
        post(client, "mail/reset/", {"email": user.email})
        raw = token_from_mail()

        def run(i):
            return post(
                APIClient(enforce_csrf_checks=True), "reset/", {"token": raw, "password": NEW_PASSWORD + str(i)}
            ).status_code

        self.assertEqual(sorted(self.parallel(run)), [200, 400])
        self.assertEqual(AuditEvent.objects.filter(action="password_reset").count(), 1)

    def test_link_race_creates_one_account(self):
        user = User.objects.create_user("link-race@example.test", PASSWORD, display_name="Race", email_verified=True)
        Account.objects.create(user=user, context="buyer")
        clients = [APIClient(enforce_csrf_checks=True), APIClient(enforce_csrf_checks=True)]
        for client in clients:
            signin(client, email=user.email)

        def run(i):
            return post(clients[i], "buyer/link/seller/", {"password": PASSWORD, "intent": "individual"}).status_code

        self.assertEqual(sorted(self.parallel(run)), [200, 400])
        self.assertEqual(Account.objects.filter(user=user, context="seller").count(), 1)

    def test_verification_race_consumes_once(self):
        client = APIClient(enforce_csrf_checks=True)
        post(
            client,
            "buyer/register/",
            {
                "email": "verify-race@example.test",
                "password": PASSWORD,
                "display_name": "Race",
                "intent": "individual",
                "consent": True,
            },
        )
        raw = token_from_mail()

        def run(i):
            return post(APIClient(enforce_csrf_checks=True), "verify/", {"token": raw}).status_code

        self.assertEqual(sorted(self.parallel(run)), [200, 400])
