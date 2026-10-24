"""Owner dashboard authorization, data accuracy and English-only UI regressions."""
from datetime import timedelta
from unittest.mock import patch

from django.test import TestCase
from django.urls import reverse
from django.utils import timezone, translation
from rest_framework.test import APIClient

from apps.accounts.admin import owner_site
from apps.accounts.dashboard import dashboard_context, activity_series
from apps.accounts.models import Account, Authenticator, User
from apps.catalogue.models import Product
from apps.organizations.models import BusinessProfile
from apps.verification.models import ReviewCase
from tests.test_identity import PASSWORD, code, post, signin


class OwnerDashboardTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_superuser(
            "dashboard-owner@example.test", PASSWORD, display_name="DEMO Owner", email_verified=True
        )
        self.client = APIClient(enforce_csrf_checks=True)

    def authorize(self):
        self.assertEqual(signin(self.client, "owner", self.owner.email).json()["status"], "enroll")
        self.assertEqual(post(self.client, "mfa/enroll/").status_code, 200)
        self.assertEqual(post(self.client, "mfa/challenge/", {
            "code": code(Authenticator.objects.get(user=self.owner))
        }).status_code, 200)

    def test_english_login_and_marketplace_locale_are_separate(self):
        with translation.override("fa-af"):
            response = self.client.get("/admin/login/?locale=fa-AF")
            self.assertContains(response, '<html lang="en" dir="ltr">')
            self.assertContains(response, "Owner sign-in")
            self.assertNotContains(response, '?locale=ps')
            self.assertEqual(response["Content-Language"], "en")
            self.assertEqual(translation.get_language(), "fa-af")
        bootstrap = self.client.get("/api/v1/bootstrap/").json()
        self.assertEqual(bootstrap["default_locale"], "fa-AF")
        self.assertEqual(bootstrap["supported_locales"], ["fa-AF", "en", "ps", "ar"])

    def test_dashboard_denies_anonymous_password_only_and_staff(self):
        self.assertEqual(self.client.get("/admin/").status_code, 302)
        signin(self.client, "owner", self.owner.email)
        self.assertEqual(self.client.get("/admin/").status_code, 302)
        staff = User.objects.create_user("dashboard-staff@example.test", PASSWORD, email_verified=True)
        Account.objects.create(user=staff, context="staff")
        other = APIClient(enforce_csrf_checks=True)
        signin(other, "staff", staff.email)
        post(other, "mfa/enroll/")
        post(other, "mfa/challenge/", {"code": code(Authenticator.objects.get(user=staff))})
        self.assertEqual(other.get("/admin/").status_code, 302)
        # The summary callback itself also requires owner authority.
        request = other.get("/api/v1/auth/staff/session/").wsgi_request
        from apps.accounts.services import AuthFailure
        with self.assertRaises(AuthFailure):
            dashboard_context(request, {})

    def test_counts_and_chart_use_actual_state_and_exclude_older_days(self):
        seller = User.objects.create_user("dashboard-seller@example.test", PASSWORD, email_verified=True)
        account = Account.objects.create(user=seller, context="seller")
        suspended = User.objects.create_user("dashboard-suspended@example.test", PASSWORD, email_verified=True)
        Account.objects.create(user=suspended, context="seller", status="suspended")
        profile = BusinessProfile.objects.create(account=account, kind="individual", display_name="DEMO Seller")
        Product.objects.create(seller=profile, currency="AFN", pricing_mode="fixed")
        ReviewCase.objects.create(profile=profile, status="submitted")
        User.objects.filter(pk=suspended.pk).update(date_joined=timezone.now() - timedelta(days=30))
        self.authorize()
        response = self.client.get("/admin/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual([metric["value"] for metric in response.context["metrics"]], [3, 1, 1, 1])
        self.assertEqual(response.context["pending_total"], 1)
        series = response.context["series"]
        self.assertEqual(len(series), 14)
        self.assertEqual(sum(day["accounts"] for day in series), 2)
        self.assertEqual(sum(day["products"] for day in series), 1)
        self.assertNotIn("Revenue", response.content.decode())

    def test_empty_chart_never_invents_activity(self):
        User.objects.update(date_joined=timezone.now() - timedelta(days=30))
        series = activity_series()
        self.assertEqual(len(series), 14)
        self.assertTrue(all(row["accounts_height"] == row["products_height"] == 0 for row in series))

    def test_navigation_and_every_registered_model_remain_reachable(self):
        self.authorize()
        response = self.client.get("/admin/")
        self.assertContains(response, "Operations")
        self.assertContains(response, "Administration")
        self.assertEqual(response["Content-Language"], "en")
        for model in owner_site._registry:
            url = reverse(f"admin:{model._meta.app_label}_{model._meta.model_name}_changelist")
            response = self.client.get(url)
            if model._meta.label == "site.SiteSettings":
                self.assertRedirects(response, reverse("admin:site_settings_section", kwargs={"section": "general"}))
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
