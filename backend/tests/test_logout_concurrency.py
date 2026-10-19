"""Independent review regressions. Run only with the guarded Phase 03 test settings."""

from django.contrib.sessions.backends.db import SessionStore
from django.test import TestCase, TransactionTestCase
from rest_framework.test import APIClient, APIRequestFactory

from apps.accounts.models import Account, ContextGrant, User
from apps.accounts.services import begin_signin
from tests.test_identity import PASSWORD, post, signin


class RepeatedContextLoginLogoutReview(TestCase):
    def test_delayed_other_role_signin_must_not_restore_logged_out_buyer(self):
        user = User.objects.create_user(
            "addendum-review@example.test", PASSWORD, display_name="Synthetic review", email_verified=True
        )
        for context in ["buyer", "seller"]:
            Account.objects.create(user=user, context=context)
        client = APIClient()
        signin(client, "buyer", user.email)

        # Seller sign-in request has already loaded the first buyer grant, but pauses
        # before authenticating/rotating its session. This is a real stale-request boundary.
        delayed = APIRequestFactory().post("/api/v1/auth/seller/signin/", {}, format="json")
        delayed.session = SessionStore(session_key=client.cookies["sessionid"].value)
        first_grant = delayed.session["grants"]["buyer"]["grant_id"]
        delayed.user = user

        # Another tab signs in as buyer again, then explicitly logs that context out.
        signin(client, "buyer", user.email)
        second_grant = client.session["grants"]["buyer"]["grant_id"]
        self.assertNotEqual(first_grant, second_grant)
        self.assertEqual(post(client, "buyer/logout/").status_code, 200)
        self.assertEqual(client.get("/api/v1/auth/buyer/session/").status_code, 403)

        # The delayed request now proves the seller password and rotates its own
        # stale session normally. No forced database session insertion is used.
        self.assertEqual(begin_signin(delayed, user.email, PASSWORD, "seller"), "signed_in")
        delayed.session.save()
        client.cookies["sessionid"] = delayed.session.session_key
        self.assertEqual(client.get("/api/v1/auth/seller/session/").status_code, 200)
        self.assertTrue(ContextGrant.objects.filter(pk=second_grant, revoked=True).exists())
        self.assertEqual(
            client.get("/api/v1/auth/buyer/session/").status_code,
            403,
            "An older buyer grant survived the later explicit buyer logout and was restored by seller sign-in.",
        )

    def test_stale_logout_revokes_repeated_signin_grants_only_in_its_browser_context(self):
        user = User.objects.create_user("repeated@example.test", PASSWORD, display_name="Repeated", email_verified=True)
        for context in ["buyer", "seller"]:
            Account.objects.create(user=user, context=context)
        current, other = APIClient(), APIClient()
        signin(current, "buyer", user.email)
        signin(current, "seller", user.email)
        signin(other, "buyer", user.email)
        delayed = APIRequestFactory().post("/api/v1/auth/buyer/logout/", {}, format="json")
        delayed.session = SessionStore(session_key=current.cookies["sessionid"].value)
        authority = delayed.session["authority"]
        delayed.user = user
        signin(current, "buyer", user.email)
        signin(current, "buyer", user.email)
        from apps.accounts.views import LogoutView

        self.assertEqual(LogoutView.as_view()(delayed, context="buyer").status_code, 200)
        from django.contrib.sessions.backends.base import UpdateError

        # Django also rejects saving the deleted pre-rotation session; no forced insertion.
        with self.assertRaises(UpdateError):
            delayed.session.save()
        self.assertFalse(ContextGrant.objects.filter(authority_id=authority, context="buyer", revoked=False).exists())
        self.assertEqual(current.get("/api/v1/auth/buyer/session/").status_code, 403)
        self.assertEqual(current.get("/api/v1/auth/seller/session/").status_code, 200)
        self.assertEqual(other.get("/api/v1/auth/buyer/session/").status_code, 200)


class ConcurrentContextLogoutTests(TransactionTestCase):
    def test_real_concurrent_logout_and_other_context_signin_leave_buyer_revoked(self):
        from concurrent.futures import ThreadPoolExecutor
        from threading import Barrier
        from django.db import connections
        from apps.accounts.services import revoke_context

        user = User.objects.create_user("locked@example.test", PASSWORD, display_name="Locked", email_verified=True)
        for context in ["buyer", "seller"]:
            Account.objects.create(user=user, context=context)
        client = APIClient()
        signin(client, "buyer", user.email)
        requests = []
        for _ in range(2):
            request = APIRequestFactory().post("/api/v1/auth/buyer/logout/", {}, format="json")
            request.session = SessionStore(session_key=client.cookies["sessionid"].value)
            self.assertIn("buyer", request.session["grants"])
            request.user = user
            requests.append(request)
        ready = Barrier(2)

        def run(action):
            connections.close_all()
            request = requests[action]
            ready.wait(timeout=10)
            try:
                if action == 0:
                    revoke_context(request, "buyer")
                else:
                    begin_signin(request, user.email, PASSWORD, "seller")
                    request.session.save()
                return True
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            self.assertEqual(list(pool.map(run, [0, 1])), [True, True])
        client.cookies["sessionid"] = requests[1].session.session_key
        self.assertEqual(client.get("/api/v1/auth/buyer/session/").status_code, 403)
        self.assertEqual(client.get("/api/v1/auth/seller/session/").status_code, 200)
