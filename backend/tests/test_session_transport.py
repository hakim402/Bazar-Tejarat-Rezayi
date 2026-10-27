"""Cookie transport remains safe when old requests finish after session rotation."""

from django.conf import settings
from django.http import HttpResponse
from django.test import RequestFactory, TestCase
from django.utils.module_loading import import_string
from rest_framework.test import APIClient

from apps.accounts.models import Account, User
from tests.test_identity import PASSWORD, post, signin


class SessionTransportTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            "session-race@example.test", PASSWORD, email_verified=True, display_name="Synthetic session race"
        )
        Account.objects.create(user=self.user, context="buyer")
        Account.objects.create(user=self.user, context="seller", review_status="pending")
        self.client = APIClient(enforce_csrf_checks=True)

    def middleware(self):
        path = next(path for path in settings.MIDDLEWARE if path.endswith("SessionMiddleware"))
        return import_string(path)(lambda request: HttpResponse())

    def test_delayed_read_cannot_clear_cookie_created_by_later_signin(self):
        self.assertEqual(signin(self.client, email=self.user.email).status_code, 200)
        cookie_name = settings.SESSION_COOKIE_NAME
        old_key = self.client.cookies[cookie_name].value
        stale = RequestFactory().get("/api/v1/auth/buyer/session/", HTTP_COOKIE=f"{cookie_name}={old_key}")
        middleware = self.middleware()
        middleware.process_request(stale)
        self.assertEqual(signin(self.client, "seller", self.user.email).status_code, 200)
        self.assertFalse(old_key == self.client.cookies[cookie_name].value)
        # Force the old read to load only after signin rotated/deleted its key.
        self.assertFalse(stale.session.get("grants"))
        response = middleware.process_response(stale, HttpResponse(status=403))
        self.assertFalse(cookie_name in response.cookies, "A late read must not clear or replace a newer cookie.")
        self.client.cookies.update(response.cookies)
        for context in ("buyer", "seller"):
            self.assertEqual(self.client.get(f"/api/v1/auth/{context}/session/").status_code, 200)

    def test_explicit_logout_still_clears_cookie_and_rejects_old_grants(self):
        self.assertEqual(signin(self.client, email=self.user.email).status_code, 200)
        name = settings.SESSION_COOKIE_NAME
        previous = self.client.cookies[name].value
        response = post(self.client, "logout-all/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.cookies[name]["max-age"], 0)
        self.assertEqual(self.client.get("/api/v1/auth/buyer/session/").status_code, 403)
        stale_client = APIClient()
        stale_client.cookies[name] = previous
        self.assertEqual(stale_client.get("/api/v1/auth/buyer/session/").status_code, 403)
