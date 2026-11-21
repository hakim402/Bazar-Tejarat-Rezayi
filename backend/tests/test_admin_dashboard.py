"""Owner overview authorization, queue accuracy and localization."""
from tests.test_identity import native_auth
from unittest.mock import patch

from django.test import TestCase
from django.urls import reverse
from django.utils import translation
from rest_framework.test import APIClient

from apps.accounts.admin import owner_site
from apps.accounts.admin.dashboard import dashboard_context
from apps.accounts.models import Account, Authenticator, User
from apps.organizations.models import BusinessProfile
from apps.verification.models import ReviewCase
from tests.test_identity import PASSWORD, code, signin


class OwnerDashboardTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_superuser(
            "dashboard-owner@example.test", PASSWORD, display_name="DEMO Owner", email_verified=True
        )
        self.client = APIClient(enforce_csrf_checks=True)

    def authorize(self):
        self.assertEqual(signin(self.client, "owner", self.owner.email).json()["status"], "enroll")
        self.assertEqual(native_auth(self.client, "enroll", {}).status_code, 200)
        self.assertEqual(native_auth(self.client, "challenge", {
            "code": code(Authenticator.objects.get(user=self.owner))
        }).status_code, 200)

    def test_english_login_and_marketplace_locale_are_separate(self):
        with translation.override("fa-af"):
            response = self.client.get("/admin/login/?locale=fa-AF")
            self.assertContains(response, '<html lang="en" dir="ltr">')
            self.assertContains(response, "Admin sign-in")
            self.assertNotContains(response, '?locale=ps')
            self.assertEqual(response["Content-Language"], "en")
            self.assertEqual(translation.get_language(), "fa-af")
        bootstrap = self.client.get("/api/v1/bootstrap/").json()
        self.assertEqual(bootstrap["default_locale"], "fa-AF")
        self.assertEqual(bootstrap["supported_locales"], ["fa-AF", "en", "ps", "ar"])

    def switch_language(self, language, next_url="/admin/"):
        self.client.get("/admin/login/")
        token = self.client.cookies.get("csrftoken")
        return self.client.post(
            "/admin/language/",
            {"language": language, "next": next_url, "csrfmiddlewaretoken": token.value if token else ""},
            HTTP_X_CSRFTOKEN=token.value if token else "",
        )

    def test_admin_language_switcher_sets_dari_rtl_without_touching_marketplace(self):
        # Default admin language is English even when the marketplace default is Dari.
        self.assertEqual(self.client.get("/admin/login/").status_code, 200)
        switch = self.switch_language("fa-af", "/admin/login/")
        self.assertEqual(switch.status_code, 302)
        self.assertEqual(switch["Location"], "/admin/login/")
        login = self.client.get("/admin/login/")
        self.assertContains(login, '<html lang="fa-af" dir="rtl">')
        self.assertEqual(login["Content-Language"], "fa-af")
        self.assertContains(login, "ورود مدیر سیستم")
        # An unsafe next target is refused; the preference still applies.
        self.switch_language("en", "https://evil.example/")
        back = self.client.get("/admin/login/")
        self.assertEqual(back["Content-Language"], "en")
        self.assertContains(back, '<html lang="en" dir="ltr">')
        # Marketplace/API localization is independent of the admin preference.
        bootstrap = self.client.get("/api/v1/bootstrap/").json()
        self.assertEqual(bootstrap["default_locale"], "fa-AF")

    def test_owner_dashboard_renders_dari_labels_and_navigation(self):
        self.authorize()
        self.switch_language("fa-af", "/admin/")
        response = self.client.get("/admin/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Language"], "fa-af")
        self.assertContains(response, 'dir="rtl"')
        self.assertContains(response, "کاربران")
        self.assertContains(response, "محصولات")
        self.assertContains(response, "تنظیمات سایت")

    def test_dashboard_denies_anonymous_password_only_and_staff(self):
        self.assertEqual(self.client.get("/admin/").status_code, 302)
        signin(self.client, "owner", self.owner.email)
        self.assertEqual(self.client.get("/admin/").status_code, 302)
        staff = User.objects.create_user("dashboard-staff@example.test", PASSWORD, email_verified=True, is_staff=True)
        Account.objects.create(user=staff, context="staff")
        other = APIClient(enforce_csrf_checks=True)
        signin(other, "staff", staff.email)
        native_auth(other, "enroll", {})
        native_auth(other, "challenge", {"code": code(Authenticator.objects.get(user=staff))})
        self.assertEqual(other.get("/admin/").status_code, 200)
        self.assertNotContains(other.get("/admin/"), "Registered users")
        # The summary callback itself also requires owner authority.
        request = other.get("/api/v1/auth/staff/session/").wsgi_request
        from apps.accounts.services import AuthFailure
        with self.assertRaises(AuthFailure):
            dashboard_context(request, {})

    def test_overview_shows_live_queue_counts_without_retired_widgets(self):
        seller = User.objects.create_user("dashboard-seller@example.test", PASSWORD, email_verified=True)
        account = Account.objects.create(user=seller, context="seller")
        profile = BusinessProfile.objects.create(account=account, kind="individual", display_name="DEMO Seller")
        ReviewCase.objects.create(profile=profile, status="submitted")
        self.authorize()
        response = self.client.get("/admin/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.context["active_queue_count"], 1)
        self.assertEqual(len(response.context["queue_rows"]), 1)
        row = response.context["queue_rows"][0]
        with translation.override("en"):
            self.assertEqual(str(row["label"]), "Business verification")
        self.assertEqual(row["count"], 1)
        self.assertNotContains(response, "activity-chart")
        self.assertNotContains(response, "Recent activity")

    def test_empty_overview_never_invents_queue_activity(self):
        self.authorize()
        response = self.client.get("/admin/")
        self.assertContains(response, "No open items in these queues.")
        self.assertEqual(response.context["active_queue_count"], 0)
        self.assertEqual(response.context["overview_priority_slots"], [])

    def test_navigation_and_every_registered_model_remain_reachable(self):
        self.authorize()
        response = self.client.get("/admin/")
        self.assertContains(response, "Catalogue")
        self.assertContains(response, "People &amp; stores")
        self.assertEqual(response["Content-Language"], "en")
        for model in owner_site._registry:
            url = reverse(f"admin:{model._meta.app_label}_{model._meta.model_name}_changelist")
            response = self.client.get(url)
            if model._meta.label == "site.SiteSettings":
                self.assertRedirects(response, reverse("admin:site_sitesettings_change", args=[1]))
            else:
                self.assertEqual(response.status_code, 200, url)

    def test_revoked_owner_grant_cannot_read_dashboard(self):
        self.authorize()
        self.assertEqual(self.client.get("/admin/").status_code, 200)
        self.owner.owner_authority = False
        self.owner.save(update_fields=["owner_authority"])
        self.assertEqual(self.client.get("/admin/").status_code, 302)

    def test_dashboard_does_not_write_or_expose_audit_state(self):
        from apps.accounts.models import AuditEvent
        AuditEvent.objects.create(actor=self.owner, action="demo_event", state={"private_marker": "must-stay-private"})
        self.authorize()
        with patch("apps.accounts.models.AuditEvent.save", side_effect=AssertionError("Dashboard wrote audit data")):
            response = self.client.get("/admin/")
        self.assertNotContains(response, "must-stay-private")
        self.assertEqual(response["Cache-Control"], "max-age=0, no-cache, no-store, must-revalidate, private")
