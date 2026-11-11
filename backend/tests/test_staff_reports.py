"""Staff report boundaries use real grants, native groups and scoped queues."""
from django.contrib.auth.models import Group, Permission
from django.test import TestCase, override_settings
from django.urls import reverse

from apps.accounts.models import AuditEvent
from tests.test_aftercare import AftercareFixture


@override_settings(OWNER_MFA_REQUIRED=False, LANGUAGE_CODE="en")
class StaffReportTests(AftercareFixture, TestCase):
    def test_staff_report_matches_its_scoped_landing(self):
        page = self.staff_client.get(reverse("admin:reports_work"))
        self.assertEqual(page.status_code, 200)
        landing = self.staff_client.get("/admin/")
        self.assertEqual(page.context["my_work"], landing.context["my_work"])
        self.assertNotIn("report", page.context)
        self.assertNotIn("sellers", page.context)

    def test_export_is_audited_private_and_contains_only_queue_counts(self):
        response = self.staff_client.get(reverse("admin:reports_work"), {"export": "1"})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.content.startswith(b"\xef\xbb\xbfqueue,open,assigned_to_me,unassigned"))
        self.assertIn("no-store", response["Cache-Control"])
        self.assertEqual(response["X-Content-Type-Options"], "nosniff")
        event = AuditEvent.objects.get(action="staff_report_exported")
        self.assertEqual(event.actor_id, self.staff.user.pk)
        self.assertEqual(event.resource_type, "reports.work")
        self.assertNotIn(b"goods_total", response.content)
        self.assertEqual(self.staff_client.get(reverse("admin:reports_commerce")).status_code, 403)

    def test_report_rechecks_group_revocation(self):
        group = Group.objects.create(name="Synthetic report dispute reader")
        group.permissions.set(Permission.objects.filter(content_type__app_label="orders", codename="read_dispute"))
        self.staff.user.groups.add(group)
        url = reverse("admin:reports_work")
        self.assertIn("Disputes", {row["label"] for row in self.staff_client.get(url).context["my_work"]})
        self.staff.user.groups.remove(group)
        self.assertNotIn("Disputes", {row["label"] for row in self.staff_client.get(url).context["my_work"]})

    def test_invalid_queries_and_buyer_cannot_export(self):
        url = reverse("admin:reports_work")
        for query in ("?export=0", "?export=1&export=1", "?seller=any", "?start=2026-01-01"):
            self.assertEqual(self.staff_client.get(url + query).status_code, 400)
        self.assertNotEqual(self.buyer_client.get(url, {"export": "1"}).status_code, 200)
        self.assertFalse(AuditEvent.objects.filter(action="staff_report_exported").exists())
