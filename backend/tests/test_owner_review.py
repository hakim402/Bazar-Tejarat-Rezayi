"""Direct owner review with no operational staff or permission-group dependency."""

from unittest.mock import patch

from django.core.files.storage import storages
from django.test import TransactionTestCase, override_settings
from rest_framework.test import APIClient

from apps.accounts.models import Account, AuditEvent, User
from apps.organizations.profiles import create_profile, current_case
from apps.verification.models import ReviewCase
from apps.verification.services import application_action, upload_evidence
from tests.test_identity import PASSWORD, signin
from tests.test_organizations import ServiceActor, identity, image_file, profile_values


@override_settings(OWNER_MFA_REQUIRED=False)
class OwnerReviewTests(TransactionTestCase):
    def setUp(self):
        self.owner = User.objects.create_superuser(
            "direct-owner@example.test", PASSWORD, display_name="Synthetic sole owner", email_verified=True
        )
        self.client = APIClient(enforce_csrf_checks=True)
        signin(self.client, "owner", self.owner.email)
        self.seller = identity("direct-review-seller")
        self.actor = ServiceActor(self.seller)
        self.profile = create_profile(self.actor, profile_values("individual"))

    def submitted(self):
        upload_evidence(self.actor, self.profile.pk, image_file(), "identity", current_case(self.profile).version)
        return application_action(self.actor, self.profile.pk, {
            "version": current_case(self.profile).version, "action": "submit",
        })

    def path(self, case):
        return f"/admin/verification/reviewcase/{case.pk}/workflow/"

    def post(self, case, **changes):
        return self.client.post(self.path(case), {
            "version": case.version, "action": "approved", "reason": "Synthetic direct owner decision", **changes,
        }, HTTP_X_CSRFTOKEN=self.client.cookies["csrftoken"].value)

    def test_direct_owner_decisions_without_staff_or_assignment_and_audit(self):
        self.assertFalse(Account.objects.filter(context="staff").exists())
        for action in ("approved", "rejected", "needs_information"):
            with self.subTest(action=action):
                if action != "approved":
                    # Another independent applicant; previous decisions remain immutable revisions.
                    actor = ServiceActor(identity("direct-" + action))
                    self.profile = create_profile(actor, profile_values("individual"))
                    self.actor = actor
                case = self.submitted()
                page = self.client.get(self.path(case))
                self.assertContains(page, "no staff account or assignment is required")
                self.assertNotIn("assigned_to", page.context["form"].fields)
                self.assertNotContains(page, 'value="assign"')
                self.assertContains(page, "Download Identity evidence 1")
                self.assertEqual(self.post(case, action=action).status_code, 302)
                case.refresh_from_db()
                self.assertEqual(case.status, action)
                self.assertIsNone(case.assigned_to_id)
                self.assertTrue(AuditEvent.objects.filter(
                    resource_id=case.pk, actor=self.owner, context="owner", action="verification_" + action
                ).exists())
                self.assertNotContains(self.client.get(self.path(case)), "Save review decision")

    def test_draft_is_readonly_and_generic_change_cannot_write(self):
        case = current_case(self.profile)
        page = self.client.get(self.path(case))
        self.assertContains(page, "seller has not submitted")
        self.assertNotContains(page, "Save review decision")
        self.assertNotEqual(self.post(case).status_code, 302)
        case.refresh_from_db()
        self.assertEqual(case.status, "draft")
        path = f"/admin/verification/reviewcase/{case.pk}/change/"
        self.assertRedirects(self.client.get(path), self.path(case), fetch_redirect_response=False)
        self.assertEqual(self.client.post(path, {"status": "approved"},
            HTTP_X_CSRFTOKEN=self.client.cookies["csrftoken"].value).status_code, 403)
        self.assertEqual(self.client.get("/admin/verification/reviewcase/not-a-uuid/change/").status_code, 404)

    def test_csrf_stale_and_unavailable_evidence_preserve_case_and_input(self):
        case = self.submitted()
        self.assertEqual(self.client.post(self.path(case), {
            "version": case.version, "action": "approved", "reason": "Synthetic CSRF attempt",
        }).status_code, 403)
        page = self.post(case, version=case.version - 1)
        self.assertContains(page, "This record changed")
        self.assertContains(page, "Reload current case")
        self.assertEqual(page.context["form"]["reason"].value(), "Synthetic direct owner decision")
        item = case.evidence.get()
        with patch.object(storages[item.storage_alias], "exists", return_value=False):
            page = self.post(case)
        self.assertContains(page, "Evidence is unavailable; approval refused.")
        case.refresh_from_db()
        self.assertEqual(case.status, "submitted")

    def test_evidence_download_stays_guarded_audited_and_no_store(self):
        case = self.submitted()
        page = self.client.get(self.path(case))
        self.assertIn("private", page["Cache-Control"])
        self.assertIn("no-store", page["Cache-Control"])
        item = case.evidence.get()
        self.assertNotContains(page, item.key)
        self.assertNotContains(page, item.sha256)
        path = f"/admin/verification/evidence/{item.pk}/download/"
        download = self.client.get(path)
        self.assertEqual(download.status_code, 200)
        download.close()
        self.assertTrue(AuditEvent.objects.filter(
            action="verification_evidence_downloaded", resource_id=item.pk, actor=self.owner
        ).exists())
        self.assertEqual(APIClient().get(path).status_code, 302)
        seller = APIClient(enforce_csrf_checks=True)
        signin(seller, "seller", self.seller.user.email)
        self.assertEqual(seller.get(self.path(case)).status_code, 302)
        self.assertEqual(seller.get(path).status_code, 302)

    def test_case_list_exposes_review_action_without_raw_snapshot(self):
        case = self.submitted()
        page = self.client.get("/admin/verification/reviewcase/")
        self.assertContains(page, self.path(case))
        self.assertContains(page, "Review case")
        self.assertNotContains(page, "contact_phone")
        self.assertEqual(ReviewCase.objects.get(pk=case.pk).version, case.version)
