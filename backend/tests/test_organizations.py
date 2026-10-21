"""Phase 04 API and business invariants, using owned disposable PostgreSQL only."""

import io
import json
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from unittest.mock import patch
from types import SimpleNamespace

from PIL import Image
from pypdf import PdfWriter
from django.conf import settings
from django.contrib.auth.models import Group, Permission
from django.core import mail
from django.core.files.storage import storages
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connections
from django.test import TestCase, TransactionTestCase, override_settings
from django.utils import timezone
from django.utils.html import escape
from rest_framework.exceptions import APIException
from rest_framework.test import APIClient

from apps.accounts.models import Account, AuditEvent, User
from apps.organizations.access import Conflict
from apps.organizations.models import Membership, BUNDLES
from apps.organizations.profiles import create_profile, current_case, effective_entitlement, update_profile
from apps.organizations.teams import accept_invitation, change_member, invite, invitation_action
from apps.organizations.transfers import request_transfer, transfer_action
from apps.organizations.mail import dispatch_invitation, invitation_message
from apps.verification.models import Evidence, ReviewCase
from apps.verification.services import application_action, upload_evidence, review_action
from tests.test_identity import PASSWORD, signin


class ServiceActor:
    def __init__(self, account):
        self.account = account
        self.context = account.context
        self.user = account.user
        self.request = SimpleNamespace(user=account.user)

    def staff(self, code):
        from rest_framework.exceptions import PermissionDenied

        if (
            self.context != "staff"
            or not self.account.permission_groups.filter(
                permissions__codename=code, permissions__content_type__app_label="verification"
            ).exists()
        ):
            raise PermissionDenied()
        return self.account


def identity(name, context="seller"):
    user = User.objects.create_user(
        name + "@example.test", PASSWORD, display_name="Synthetic " + name, email_verified=True
    )
    return Account.objects.create(user=user, context=context)


def review_actor(name="reviewer"):
    account = identity(name, "staff")
    group, _ = Group.objects.get_or_create(name="Synthetic review " + name)
    group.permissions.add(*Permission.objects.filter(content_type__app_label="verification"))
    account.permission_groups.add(group)
    account.refresh_from_db()
    return ServiceActor(account)


def profile_values(kind="company"):
    return {
        "kind": kind,
        "display_name": "Synthetic Company",
        "legal_name": "Synthetic Legal",
        "business_type": "Synthetic trade",
        "contact_phone": "000000",
        "location": "Synthetic test location",
        "representative": "Synthetic representative",
    }


def image_file(kind="PNG", name="evidence.png"):
    output = io.BytesIO()
    Image.new("RGB", (3, 3), (15, 30, 45)).save(output, format=kind)
    return SimpleUploadedFile(name, output.getvalue(), content_type="image/png" if kind == "PNG" else "image/jpeg")


def pdf_file():
    output = io.BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=100, height=100)
    writer.write(output)
    return SimpleUploadedFile("plain.pdf", output.getvalue(), content_type="application/pdf")


def actor_request(account):
    # Maintained synthetic service actor avoids session storage in concurrency tests.
    return ServiceActor(account)


class OrganizationTests(TransactionTestCase):
    captureOnCommitCallbacks = staticmethod(TestCase.captureOnCommitCallbacks)

    def setUp(self):
        self.account = identity("org-owner")
        self.actor = ServiceActor(self.account)
        self.reviewer = review_actor()
        self.profile = create_profile(self.actor, profile_values())
        self.other_actor = ServiceActor(identity("unrelated"))
        self.other = create_profile(self.other_actor, profile_values())
        self.member_account = identity("member")
        self.member = Membership.objects.create(
            company=self.profile, account=self.member_account, bundles=["catalogue"]
        )
        self.client = APIClient(enforce_csrf_checks=True)
        signin(self.client, "seller", self.account.user.email)

    def request(self, path, data=None, method="post", client=None, format="json"):
        client = client or self.client
        token = client.get("/api/v1/auth/csrf/").json()["csrf_token"]
        with self.captureOnCommitCallbacks(execute=True):
            return getattr(client, method)(
                path, data or {}, format=format, HTTP_X_CSRFTOKEN=token, HTTP_ORIGIN=settings.FRONTEND_ORIGIN
            )

    @property
    def base(self):
        return f"/api/v1/organizations/seller/profiles/{self.profile.pk}/"

    def populate(self, profile=None, actor=None):
        profile = profile or self.profile
        actor = actor or self.actor
        for category in (
            ["identity"]
            if profile.kind == "individual"
            else ["business", "representative_identity", "representative_authority"]
        ):
            upload_evidence(actor, profile.pk, image_file(), category, current_case(profile).version)

    def submit(self):
        self.populate()
        return application_action(
            self.actor, self.profile.pk, {"version": current_case(self.profile).version, "action": "submit"}
        )

    def assign(self, case):
        return review_action(
            self.reviewer,
            case.pk,
            {
                "version": case.version,
                "action": "assign",
                "assigned_to": self.reviewer.account.pk,
                "reason": "Synthetic assignment",
            },
        )

    def approve(self):
        case = self.assign(self.submit())
        return review_action(
            self.reviewer,
            case.pk,
            {
                "version": case.version,
                "action": "approved",
                "reason": "Synthetic reviewed approval",
                "internal_note": "PRIVATE INTERNAL NOTE",
            },
        )

    def test_create_profile_context_validation_and_mass_assignment(self):
        for extra in (
            {"kind": "business"},
            {"review_status": "approved"},
            {"account": str(self.other_actor.account.pk)},
            {"is_owner": True},
        ):
            data = profile_values("individual") | extra
            self.assertEqual(self.request("/api/v1/organizations/seller/profiles/", data).status_code, 400)
        self.assertEqual(
            self.request("/api/v1/organizations/seller/profiles/", profile_values("individual")).status_code, 201
        )
        self.assertEqual(
            self.request("/api/v1/organizations/seller/profiles/", profile_values("individual")).status_code, 400
        )
        self.assertEqual(
            self.request(
                "/api/v1/organizations/seller/profiles/", profile_values() | {"display_name": "Second owned company"}
            ).status_code,
            201,
        )
        selected = self.client.get("/api/v1/organizations/seller/profiles/").json()["profiles"]
        self.assertEqual(len([profile for profile in selected if profile["kind"] == "company"]), 2)

    def test_private_profile_access_and_company_switching(self):
        response = self.client.get("/api/v1/organizations/seller/profiles/").json()
        self.assertEqual([p["id"] for p in response["profiles"]], [str(self.profile.pk)])
        for method in ("get", "patch"):
            response = (
                self.client.get(f"/api/v1/organizations/seller/profiles/{self.other.pk}/")
                if method == "get"
                else self.request(
                    f"/api/v1/organizations/seller/profiles/{self.other.pk}/",
                    {"version": 1, "display_name": "Intruder"},
                    method="patch",
                )
            )
            self.assertEqual(response.status_code, 404)

    def test_team_members_share_entitlement_but_no_private_contacts_or_evidence(self):
        self.approve()
        self.assertTrue(effective_entitlement(self.profile, self.member_account))
        client = APIClient(enforce_csrf_checks=True)
        signin(client, "seller", self.member_account.user.email)
        response = client.get(self.base).json()
        self.assertTrue(response["entitlement"])
        self.assertFalse(response["can_manage"])
        self.assertNotIn("legal_name", response)
        self.assertNotIn("contact_phone", response)
        self.assertEqual(
            client.get(f"/api/v1/verification/seller/profiles/{self.profile.pk}/application/").status_code, 403
        )
        evidence = current_case(self.profile).evidence.first()
        self.assertEqual(client.get(f"/api/v1/verification/evidence/seller/{evidence.pk}/").status_code, 403)

    def test_business_buyer_seller_approvals_independent_and_stored_flag_not_authority(self):
        buyer = Account.objects.create(
            user=self.account.user, context="buyer", intent="business", review_status="approved"
        )
        business = create_profile(ServiceActor(buyer), profile_values("business"))
        self.approve()
        self.assertTrue(effective_entitlement(self.profile, self.account))
        self.assertFalse(effective_entitlement(business, buyer))
        from apps.accounts.services import account_summary

        self.assertEqual(account_summary(buyer)["review_status"], "pending")

    def test_draft_submission_requires_profile_and_each_category_or_alternative(self):
        response = self.request(
            f"/api/v1/verification/seller/profiles/{self.profile.pk}/application/", {"version": 1, "action": "submit"}
        )
        self.assertEqual(response.status_code, 400)
        self.populate()
        case = application_action(
            self.actor, self.profile.pk, {"version": current_case(self.profile).version, "action": "submit"}
        )
        self.assertEqual(case.status, "submitted")
        self.assertTrue(case.snapshot)
        with self.assertRaises(Conflict):
            upload_evidence(self.actor, self.profile.pk, image_file(), "business", case.version)

    def test_alternative_requires_explicit_reviewer_reason(self):
        case = application_action(
            self.actor,
            self.profile.pk,
            {
                "version": 1,
                "action": "submit",
                "alternative_requests": {
                    key: "Synthetic alternative request"
                    for key in ["business", "representative_identity", "representative_authority"]
                },
            },
        )
        case = self.assign(case)
        with self.assertRaises(APIException):
            review_action(
                self.reviewer,
                case.pk,
                {"version": case.version, "action": "approved", "reason": "No alternative reasons"},
            )
        approved = review_action(
            self.reviewer,
            case.pk,
            {
                "version": case.version,
                "action": "approved",
                "reason": "Reviewed",
                "accepted_alternatives": {
                    key: "Documented accepted alternative"
                    for key in ["business", "representative_identity", "representative_authority"]
                },
            },
        )
        self.assertEqual(approved.status, "approved")

    def test_corrections_and_resubmission_preserve_previous_evidence_and_internal_notes(self):
        case = self.assign(self.submit())
        old_ids = list(case.evidence.values_list("pk", flat=True))
        review_action(
            self.reviewer,
            case.pk,
            {
                "version": case.version,
                "action": "needs_information",
                "reason": "Provide clearer evidence",
                "internal_note": "PRIVATE INTERNAL NOTE",
            },
        )
        result = self.client.get(f"/api/v1/verification/seller/profiles/{self.profile.pk}/application/")
        self.assertNotIn("PRIVATE INTERNAL NOTE", result.content.decode())
        case.refresh_from_db()
        draft = application_action(self.actor, self.profile.pk, {"version": case.version, "action": "revise"})
        self.assertEqual(draft.revision, 2)
        self.assertEqual(Evidence.objects.filter(pk__in=old_ids).count(), 3)
        replacement = upload_evidence(
            self.actor,
            self.profile.pk,
            image_file(),
            "business",
            draft.version,
            str(draft.evidence.get(category="business").pk),
        )
        self.assertEqual(replacement.case_id, draft.pk)
        draft.refresh_from_db()
        resubmitted = application_action(self.actor, self.profile.pk, {"version": draft.version, "action": "submit"})
        self.assertEqual(resubmitted.status, "submitted")
        self.assertEqual(ReviewCase.objects.filter(profile=self.profile).count(), 2)

    def test_material_edit_invalidates_entitlement_but_display_edit_does_not(self):
        self.approve()
        self.profile.refresh_from_db()
        update_profile(self.actor, self.profile.pk, {"version": self.profile.version, "display_name": "New display"})
        self.profile.refresh_from_db()
        self.assertTrue(effective_entitlement(self.profile, self.account))
        update_profile(
            self.actor, self.profile.pk, {"version": self.profile.version, "legal_name": "Replacement identity"}
        )
        self.profile.refresh_from_db()
        self.assertFalse(effective_entitlement(self.profile, self.account))
        self.assertEqual(self.profile.revision, 2)

    def test_stale_edits_and_stale_reviews_refused(self):
        update_profile(self.actor, self.profile.pk, {"version": 1, "display_name": "Display"})
        self.assertEqual(
            self.request(self.base, {"version": 1, "display_name": "Stale"}, method="patch").status_code, 409
        )
        case = self.assign(self.submit())
        with self.assertRaises(Conflict):
            review_action(
                self.reviewer, case.pk, {"version": case.version - 1, "action": "approved", "reason": "Stale"}
            )
        self.profile.refresh_from_db()
        update_profile(self.actor, self.profile.pk, {"version": self.profile.version, "legal_name": "Changed"})
        with self.assertRaises(Conflict):
            review_action(
                self.reviewer, case.pk, {"version": case.version, "action": "approved", "reason": "Old revision"}
            )

    def test_staff_permission_assignment_and_self_review(self):
        case = self.submit()
        with self.assertRaises(APIException):
            review_action(
                self.reviewer, case.pk, {"version": case.version, "action": "approved", "reason": "Unassigned"}
            )
        unauthorized = ServiceActor(identity("content-only", "staff"))
        with self.assertRaises(APIException):
            review_action(
                unauthorized,
                case.pk,
                {
                    "version": case.version,
                    "action": "assign",
                    "reason": "No authority",
                    "assigned_to": unauthorized.account.pk,
                },
            )
        staff = review_actor("conflicted")
        Membership.objects.create(
            company=self.profile, account=Account.objects.create(user=staff.user, context="seller")
        )
        with self.assertRaises(APIException):
            review_action(
                staff,
                case.pk,
                {"version": case.version, "action": "assign", "reason": "Conflict", "assigned_to": staff.account.pk},
            )

    def test_upload_content_limits_malicious_types_and_private_opaque_storage(self):
        for file in [
            SimpleUploadedFile("bad.svg", b"<svg/>", content_type="image/svg+xml"),
            SimpleUploadedFile("bad.png", b"<html>hello</html>", content_type="image/png"),
            SimpleUploadedFile("bad.pdf", b"%PDF-1.7\n/JavaScript\n%%EOF", content_type="application/pdf"),
            SimpleUploadedFile("huge.png", b"x" * (10 * 1024 * 1024 + 1), content_type="image/png"),
        ]:
            with self.assertRaises(APIException):
                upload_evidence(self.actor, self.profile.pk, file, "business", current_case(self.profile).version)
        for file in (image_file(), image_file("JPEG", "evidence.jpg"), pdf_file()):
            evidence = upload_evidence(
                self.actor, self.profile.pk, file, "business", current_case(self.profile).version
            )
            self.assertTrue(evidence.key.startswith("evidence/"))
            self.assertNotIn(file.name, evidence.key)
            with self.assertRaises(Exception):
                storages[evidence.storage_alias].url(evidence.key)
        for _ in range(7):
            upload_evidence(self.actor, self.profile.pk, image_file(), "business", current_case(self.profile).version)
        with self.assertRaises(APIException):
            upload_evidence(self.actor, self.profile.pk, image_file(), "business", current_case(self.profile).version)

    def test_evidence_foreign_substitution_and_download_headers_audit(self):
        self.populate()
        self.populate(self.other, self.other_actor)
        foreign = current_case(self.other).evidence.first()
        response = self.request(
            f"/api/v1/verification/seller/profiles/{self.profile.pk}/evidence/",
            {
                "version": current_case(self.profile).version,
                "category": "business",
                "file": image_file(),
                "replace_id": str(foreign.pk),
            },
            format="multipart",
        )
        self.assertEqual(response.status_code, 403)
        evidence = current_case(self.profile).evidence.first()
        path = f"/api/v1/verification/evidence/seller/{evidence.pk}/"
        response = self.client.get(path)
        self.assertEqual(response.status_code, 200)
        self.assertIn("attachment", response["Content-Disposition"])
        self.assertEqual(response["Cache-Control"], "private, no-store")
        response.close()
        self.assertTrue(
            AuditEvent.objects.filter(action="verification_evidence_downloaded", resource_id=evidence.pk).exists()
        )
        client = APIClient()
        self.assertEqual(client.get(path).status_code, 403)
        self.assertEqual(self.client.get(f"/api/v1/verification/evidence/seller/{foreign.pk}/").status_code, 403)

    def test_storage_failure_does_not_approve_missing_evidence_or_leave_orphans(self):
        with patch(
            "django.core.files.storage.filesystem.FileSystemStorage.save",
            side_effect=OSError("Private storage failure"),
        ):
            with self.assertRaises(OSError):
                upload_evidence(self.actor, self.profile.pk, image_file(), "business", 1)
        self.assertFalse(current_case(self.profile).evidence.exists())
        case = self.assign(self.submit())
        evidence = case.evidence.first()
        storages[evidence.storage_alias].delete(evidence.key)
        with self.assertRaises(APIException):
            review_action(
                self.reviewer, case.pk, {"version": case.version, "action": "approved", "reason": "Missing bytes"}
            )
        self.assertFalse(effective_entitlement(self.profile, self.account))

    def invite_token(self, email="new-member@example.test"):
        with self.captureOnCommitCallbacks(execute=True):
            item = invite(self.actor, self.profile.pk, {"email": email, "bundles": ["catalogue"], "locale": "en"})
        token = re.search(r"#token=([A-Za-z0-9_-]+)", mail.outbox[-1].body)[1]
        return item, token

    def test_invitation_preview_is_inert_private_and_correct_identity_accepts_once(self):
        item, token = self.invite_token()
        account = identity("new-member")
        actor = ServiceActor(account)
        anon = APIClient(enforce_csrf_checks=True)
        preview = self.request("/api/v1/organizations/invitations/preview/", {"token": token}, client=anon)
        self.assertEqual(preview.json()["status"], "signin_required")
        self.assertNotIn("Synthetic Company", preview.content.decode())
        item.refresh_from_db()
        self.assertEqual(item.status, "pending")
        accepted = accept_invitation(actor, token)
        again = accept_invitation(actor, token)
        self.assertEqual(accepted.pk, again.pk)
        self.assertFalse(accepted.is_owner)
        self.assertEqual(Membership.objects.filter(company=self.profile, account=account).count(), 1)
        self.assertNotEqual(item.digest, token)
        self.assertNotIn(token, json.dumps(list(AuditEvent.objects.values("reason", "state"))))

    def test_invitation_wrong_email_buyer_context_expired_revoked_and_unknown(self):
        item, token = self.invite_token()
        for actor in (self.other_actor, ServiceActor(identity("new-member", "buyer"))):
            with self.assertRaises(APIException):
                accept_invitation(actor, token)
        item.expires_at = timezone.now() - timedelta(seconds=1)
        item.save()
        with self.assertRaises(APIException):
            accept_invitation(self.other_actor, token)
        item.expires_at = timezone.now() + timedelta(days=1)
        item.status = "revoked"
        item.save()
        with self.assertRaises(APIException):
            accept_invitation(self.other_actor, token)
        self.assertEqual(
            self.request("/api/v1/organizations/invitations/preview/", {"token": "x" * 43}).json()["status"],
            "unavailable",
        )

    def test_invitation_resend_invalidates_old_token_and_rechecks_inviter(self):
        item, token = self.invite_token()
        new_account = identity("new-member")
        with self.captureOnCommitCallbacks(execute=True):
            invitation_action(self.actor, self.profile.pk, item.pk, "resend", item.version)
        new = re.search(r"#token=([A-Za-z0-9_-]+)", mail.outbox[-1].body)[1]
        with self.assertRaises(APIException):
            accept_invitation(ServiceActor(new_account), token)
        Membership.objects.filter(company=self.profile, account=self.account).update(active=False)
        with self.assertRaises(APIException):
            accept_invitation(ServiceActor(new_account), new)

    def test_invite_idempotency_no_excessive_delegation_and_no_member_admin(self):
        item, token = self.invite_token()
        duplicate = invite(self.actor, self.profile.pk, {"email": item.email, "bundles": ["catalogue"], "locale": "en"})
        self.assertEqual(item.pk, duplicate.pk)
        with self.assertRaises(APIException):
            invite(
                ServiceActor(self.member_account),
                self.profile.pk,
                {"email": "intruder@example.test", "bundles": ["catalogue"], "locale": "en"},
            )
        Membership.objects.filter(company=self.profile, account=self.account).update(bundles=["catalogue"])
        with self.assertRaises(APIException):
            invite(
                self.actor,
                self.profile.pk,
                {"email": "intruder@example.test", "bundles": ["payments_refunds"], "locale": "en"},
            )

    def test_invitation_mail_failure_retry_and_localized_branding(self):
        with patch("django.core.mail.message.EmailMultiAlternatives.send", side_effect=OSError("PRIVATE CREDENTIAL")):
            with self.captureOnCommitCallbacks(execute=True):
                item = invite(
                    self.actor, self.profile.pk, {"email": "new@example.test", "bundles": [], "locale": "fa-AF"}
                )
        delivery = item.deliveries.first()
        self.assertEqual(delivery.status, "delivery_failed")
        self.assertTrue(delivery.encrypted_payload)
        delivery.next_attempt_at = timezone.now()
        delivery.save()
        self.assertEqual(dispatch_invitation(delivery.pk), "captured")
        self.assertFalse(Membership.objects.filter(company=self.profile, account__user__email=item.email).exists())
        for locale in ("fa-AF", "en", "ps", "ar"):
            item.locale = locale
            message = invitation_message(item, "x" * 43)
            self.assertEqual(len(message.attachments), 1)
            self.assertIn("rezayi-brand", message.alternatives[0].content)
            self.assertIn('dir="ltr"' if locale == "en" else 'dir="rtl"', message.alternatives[0].content)

    def test_permission_reduction_revocation_and_last_owner(self):
        member_actor = ServiceActor(self.member_account)
        change_member(
            self.actor,
            self.profile.pk,
            self.member.pk,
            {"version": 1, "action": "permissions", "bundles": ["messaging"]},
        )
        self.member.refresh_from_db()
        self.assertEqual(self.member.bundles, ["messaging"])
        self.profile.refresh_from_db()
        change_member(
            self.actor, self.profile.pk, self.member.pk, {"version": self.profile.version, "action": "revoke"}
        )
        with self.assertRaises(APIException):
            invite(member_actor, self.profile.pk, {"email": "x@example.test", "bundles": [], "locale": "en"})
        self.profile.refresh_from_db()
        owner = self.profile.memberships.get(is_owner=True)
        with self.assertRaises(APIException):
            change_member(self.actor, self.profile.pk, owner.pk, {"version": self.profile.version, "action": "leave"})
        self.assertTrue(Membership.objects.get(pk=owner.pk).active)

    def test_transfer_requires_recipient_acceptance_independent_staff_and_retained_permissions(self):
        item = request_transfer(
            self.actor, self.profile.pk, {"recipient": self.member.pk, "retained_bundles": ["messaging"]}
        )
        with self.assertRaises(APIException):
            transfer_action(self.reviewer, item.pk, {"version": 1, "action": "approve", "reason": "Too early"})
        item = transfer_action(ServiceActor(self.member_account), item.pk, {"version": 1, "action": "accept"})
        item = transfer_action(
            self.reviewer, item.pk, {"version": item.version, "action": "approve", "reason": "Synthetic staff decision"}
        )
        self.assertEqual(item.status, "approved")
        self.member.refresh_from_db()
        self.assertTrue(self.member.is_owner)
        old = self.profile.memberships.get(account=self.account)
        self.assertFalse(old.is_owner)
        self.assertTrue(old.active)
        self.assertEqual(old.bundles, ["messaging"])
        with self.assertRaises(APIException):
            invite(self.actor, self.profile.pk, {"email": "x@example.test", "bundles": [], "locale": "en"})

    def test_transfer_cancel_reject_conflicts_and_revoked_recipient(self):
        data = {"recipient": self.member.pk, "retained_bundles": []}
        item = request_transfer(self.actor, self.profile.pk, data)
        self.assertEqual(request_transfer(self.actor, self.profile.pk, data).pk, item.pk)
        transfer_action(self.actor, item.pk, {"version": 1, "action": "cancel"})
        item = request_transfer(self.actor, self.profile.pk, data)
        item = transfer_action(ServiceActor(self.member_account), item.pk, {"version": 1, "action": "accept"})
        transfer_action(
            self.reviewer, item.pk, {"version": item.version, "action": "reject", "reason": "Insufficient authority"}
        )
        self.assertTrue(self.profile.memberships.get(account=self.account).is_owner)
        item = request_transfer(self.actor, self.profile.pk, data)
        item = transfer_action(ServiceActor(self.member_account), item.pk, {"version": 1, "action": "accept"})
        self.member.active = False
        self.member.save()
        with self.assertRaises(Conflict):
            transfer_action(self.reviewer, item.pk, {"version": item.version, "action": "approve", "reason": "Revoked"})

    def test_material_company_identity_edit_invalidates_pending_ownership_transfer(self):
        item = request_transfer(self.actor, self.profile.pk, {"recipient": self.member.pk, "retained_bundles": []})
        item = transfer_action(ServiceActor(self.member_account), item.pk, {"action": "accept", "version": 1})
        update_profile(self.actor, self.profile.pk, {"version": 1, "legal_name": "Replacement company identity"})
        with self.assertRaises(Conflict):
            transfer_action(
                self.reviewer, item.pk, {"version": item.version, "action": "approve", "reason": "Stale identity"}
            )
        self.assertTrue(self.profile.memberships.get(account=self.account).is_owner)

    def test_reinviting_revoked_previous_owner_never_regrants_ownership(self):
        self.member.active = False
        self.member.is_owner = True
        self.member.save()
        item, token = self.invite_token(self.member_account.user.email)
        accepted = accept_invitation(ServiceActor(self.member_account), token)
        self.assertTrue(accepted.active)
        self.assertFalse(accepted.is_owner)
        self.assertEqual(accepted.bundles, ["catalogue"])

    def test_new_invited_identity_and_buyer_second_role_require_explicit_controlled_steps(self):
        from tests.test_identity import post

        item, token = self.invite_token("invited-buyer@example.test")
        account = identity("invited-buyer", "buyer")
        client = APIClient(enforce_csrf_checks=True)
        signin(client, "buyer", account.user.email)
        denied = self.request("/api/v1/organizations/invitations/accept/", {"token": token}, client=client)
        self.assertEqual(denied.status_code, 403)
        before_profiles = self.profile.__class__.objects.count()
        response = post(client, "buyer/link/seller/", {"password": PASSWORD, "intent": "individual"})
        self.assertEqual(response.status_code, 200)
        seller = Account.objects.get(user=account.user, context="seller")
        self.assertEqual(User.objects.filter(email=account.user.email).count(), 1)
        signin(client, "seller", account.user.email)
        accepted = self.request("/api/v1/organizations/invitations/accept/", {"token": token}, client=client)
        self.assertEqual(accepted.status_code, 200)
        self.assertTrue(
            Membership.objects.filter(company=self.profile, account=seller, active=True, is_owner=False).exists()
        )
        self.assertEqual(self.profile.__class__.objects.count(), before_profiles)

    def test_approved_business_fails_closed_when_reviewed_evidence_is_unavailable(self):
        from apps.organizations.eligibility import require_seller_approval

        self.approve()
        self.assertTrue(effective_entitlement(self.profile, self.account))
        storage = storages[settings.NEW_PRIVATE_STORAGE_ALIAS]
        with patch.object(storage, "exists", side_effect=OSError("Synthetic unavailable storage")):
            self.assertFalse(effective_entitlement(self.profile, self.account))
        evidence = current_case(self.profile).evidence.first()
        storage.delete(evidence.key)
        self.assertFalse(effective_entitlement(self.profile, self.account))
        self.assertEqual(current_case(self.profile).status, "approved")
        with self.assertRaises(APIException):
            require_seller_approval(self.actor, self.profile.pk)

    def test_old_accepted_invitation_cannot_reactivate_revoked_membership(self):
        item, token = self.invite_token()
        account = identity("new-member")
        member = accept_invitation(ServiceActor(account), token)
        member.active = False
        member.save()
        with self.assertRaises(APIException):
            accept_invitation(ServiceActor(account), token)
        member.refresh_from_db()
        self.assertFalse(member.active)

    def test_five_effective_bundles_recheck_fresh_reduction_and_suspension(self):
        from apps.organizations.eligibility import require_seller_approval

        self.approve()
        self.member.bundles = list(BUNDLES)
        self.member.save()
        actor = ServiceActor(self.member_account)
        for bundle in BUNDLES:
            self.assertEqual(require_seller_approval(actor, self.profile.pk, bundle).pk, self.profile.pk)
        Membership.objects.filter(pk=self.member.pk).update(bundles=[])
        for bundle in BUNDLES:
            with self.assertRaises(APIException):
                require_seller_approval(actor, self.profile.pk, bundle)
        Account.objects.filter(pk=self.member_account.pk).update(status="suspended")
        self.assertFalse(effective_entitlement(self.profile, self.member_account))

    def test_file_path_and_server_request_limit_rejected_before_multipart_storage(self):
        path = f"/api/v1/verification/seller/profiles/{self.profile.pk}/evidence/"
        csrf = self.client.get("/api/v1/auth/csrf/").json()["csrf_token"]
        body = b'--boundary\r\nContent-Disposition: form-data; name="file"; filename="../../evil.png"\r\nContent-Type: image/png\r\n\r\nx\r\n--boundary--\r\n'
        response = self.client.post(
            path, body, content_type="multipart/form-data; boundary=boundary", HTTP_X_CSRFTOKEN=csrf
        )
        self.assertEqual(response.status_code, 400)
        response = self.client.post(
            path,
            b"x",
            content_type="multipart/form-data; boundary=boundary",
            CONTENT_LENGTH=str(12 * 1024 * 1024),
            HTTP_X_CSRFTOKEN=csrf,
        )
        self.assertEqual(response.status_code, 400)
        self.assertFalse(current_case(self.profile).evidence.exists())

    def test_failed_database_write_deletes_only_just_created_orphan_file(self):
        storage = storages[settings.NEW_PRIVATE_STORAGE_ALIAS]
        saved = []
        original = storage.save

        def record(key, content):
            result = original(key, content)
            saved.append(result)
            return result

        with (
            patch.object(storage, "save", side_effect=record),
            patch(
                "apps.verification.services.Evidence.objects.create",
                side_effect=RuntimeError("Synthetic database failure"),
            ),
        ):
            with self.assertRaises(RuntimeError):
                upload_evidence(self.actor, self.profile.pk, image_file(), "business", 1)
        self.assertEqual(len(saved), 1)
        self.assertFalse(storage.exists(saved[0]))

    def staff_client(self, account=None):
        from tests.test_identity import post, code
        from apps.accounts.models import Authenticator

        account = account or self.reviewer.account
        client = APIClient(enforce_csrf_checks=True)
        signin(client, "staff", account.user.email)
        post(client, "mfa/enroll/")
        post(client, "mfa/challenge/", {"code": code(Authenticator.objects.get(user=account.user)), "recovery": False})
        return client

    def test_staff_queue_file_and_decision_authorization_at_each_endpoint(self):
        case = self.submit()
        staff = self.staff_client()
        self.assertEqual(self.client.get("/api/v1/verification/queue/").status_code, 403)
        queue = staff.get("/api/v1/verification/queue/")
        self.assertEqual(queue.status_code, 200)
        self.assertNotIn("contact_phone", queue.content.decode())
        self.assertNotIn("Synthetic test location", queue.content.decode())
        self.assertEqual(staff.get(f"/api/v1/verification/cases/{case.pk}/").status_code, 403)
        evidence = case.evidence.first()
        download = f"/api/v1/verification/evidence/staff/{evidence.pk}/"
        self.assertEqual(staff.get(download).status_code, 403)
        result = self.request(
            f"/api/v1/verification/cases/{case.pk}/",
            {
                "version": case.version,
                "action": "assign",
                "assigned_to": str(self.reviewer.account.pk),
                "reason": "PRIVATE ASSIGNMENT NOTE",
            },
            client=staff,
        )
        self.assertEqual(result.status_code, 200)
        applicant = self.client.get(f"/api/v1/verification/seller/profiles/{self.profile.pk}/application/")
        self.assertNotIn("PRIVATE ASSIGNMENT NOTE", applicant.content.decode())
        self.assertIn("PRIVATE ASSIGNMENT NOTE", staff.get(f"/api/v1/verification/cases/{case.pk}/").content.decode())
        assignment = AuditEvent.objects.get(resource_id=case.pk, action="verification_assign")
        self.assertIsNone(assignment.state["before"]["assigned_to"])
        self.assertEqual(assignment.state["after"]["assigned_to"], str(self.reviewer.account.pk))
        self.assertEqual(staff.get(f"/api/v1/verification/cases/{case.pk}/").status_code, 200)
        response = staff.get(download)
        self.assertEqual(response.status_code, 200)
        response.close()
        self.reviewer.account.permission_groups.clear()
        self.assertEqual(staff.get(download).status_code, 403)
        self.assertEqual(staff.get("/api/v1/verification/queue/").status_code, 403)

    def test_membership_revocation_takes_effect_with_already_open_session(self):
        client = APIClient()
        signin(client, "seller", self.member_account.user.email)
        self.assertEqual(client.get(self.base).status_code, 200)
        change_member(self.actor, self.profile.pk, self.member.pk, {"version": 1, "action": "revoke"})
        self.assertEqual(client.get(self.base).status_code, 404)
        self.assertEqual(client.get(self.base + "team/").status_code, 404)
        self.assertEqual(client.get("/api/v1/auth/seller/session/").status_code, 200)

    def test_queue_metadata_authority_does_not_grant_private_evidence(self):
        case = self.submit()
        self.assign(case)
        group = self.reviewer.account.permission_groups.first()
        group.permissions.set(Permission.objects.filter(content_type__app_label="verification", codename="view_queue"))
        staff = self.staff_client()
        self.assertEqual(staff.get("/api/v1/verification/queue/").status_code, 200)
        self.assertEqual(staff.get(f"/api/v1/verification/cases/{case.pk}/").status_code, 403)

    def test_no_csrf_or_get_side_effect_and_suspended_member_fail_closed(self):
        self.assertEqual(self.client.post(self.base + "invitations/", {}, format="json").status_code, 403)
        self.assertEqual(self.client.get("/api/v1/organizations/invitations/accept/").status_code, 405)
        self.member_account.status = "suspended"
        self.member_account.save()
        self.assertFalse(effective_entitlement(self.profile, self.member_account))

    def owner_client(self, account=None):
        owner = (account or self.reviewer.account).user
        owner.owner_authority = owner.is_staff = owner.is_superuser = True
        owner.save()
        client = APIClient(enforce_csrf_checks=True)
        signin(client, "owner", owner.email)
        return client

    def alternative_case(self, profile=None, actor=None):
        from apps.verification.services import categories

        profile, actor = profile or self.profile, actor or self.actor
        reasons = {key: "Synthetic applicant alternative " + key for key in categories(profile)}
        return application_action(actor, profile.pk, {
            "version": current_case(profile).version, "action": "submit", "alternative_requests": reasons,
        })

    def assert_minimal_review_response(self, response):
        self.assertEqual(response.status_code, 200)
        self.assertEqual(set(response.json()), {"id", "status", "version"})

    def test_review_decision_without_read_authority_returns_only_acknowledgment(self):
        case = self.assign(self.submit())
        staff = self.staff_client()
        path = f"/api/v1/verification/cases/{case.pk}/"
        self.assertEqual(staff.get(path).status_code, 200)
        self.reviewer.account.permission_groups.first().permissions.remove(
            Permission.objects.get(content_type__app_label="verification", codename="read_evidence")
        )
        self.assertEqual(staff.get(path).status_code, 403)
        self.assertEqual(staff.get(f"/api/v1/verification/evidence/staff/{case.evidence.first().pk}/").status_code, 403)
        result = self.request(path, {"version": case.version, "action": "needs_information",
            "reason": "Synthetic correction", "internal_note": "PRIVATE decision note"}, client=staff)
        self.assert_minimal_review_response(result)
        self.assertEqual(staff.get(path).status_code, 403)
        case.refresh_from_db()
        self.assertEqual(case.status, "needs_information")
        self.assertTrue(AuditEvent.objects.filter(resource_id=case.pk, action="verification_internal_note").exists())

    def test_review_mutations_keep_stale_target_conflict_and_active_guards(self):
        case = self.submit()
        staff = self.staff_client()
        path = f"/api/v1/verification/cases/{case.pk}/"
        data = {"version": case.version, "action": "assign", "reason": "Synthetic guarded assignment",
            "assigned_to": str(self.reviewer.account.pk)}
        self.assertEqual(self.request(path, data).status_code, 403)
        self.assertEqual(self.request(path, data | {"version": case.version + 1}, client=staff).status_code, 409)
        self.assertEqual(self.request(path, data | {"assigned_to": str(self.member_account.pk)}, client=staff).status_code, 400)
        conflicted = Account.objects.create(user=self.account.user, context="staff")
        conflicted.permission_groups.add(self.reviewer.account.permission_groups.first())
        self.assertEqual(self.request(path, data | {"assigned_to": str(conflicted.pk)}, client=staff).status_code, 403)
        self.reviewer.account.status = "suspended"
        self.reviewer.account.save()
        self.assertEqual(self.request(path, data, client=staff).status_code, 403)
        case.refresh_from_db()
        self.assertEqual(case.status, "submitted")

    @override_settings(OWNER_MFA_REQUIRED=False)
    def test_owner_review_form_categories_requests_and_locales(self):
        from apps.organizations.owner_copy import COPY
        from apps.verification.services import categories

        client = self.owner_client()
        individual = create_profile(self.actor, profile_values("individual"))
        buyer_actor = ServiceActor(identity("review-form-buyer", "buyer"))
        business = create_profile(buyer_actor, profile_values("business"))
        for profile, actor in ((self.profile, self.actor), (individual, self.actor), (business, buyer_actor)):
            case = self.alternative_case(profile, actor)
            for locale, t in COPY.items():
                with self.subTest(kind=profile.kind, locale=locale):
                    page = client.get(f"/admin/verification/reviewcase/{case.pk}/workflow/?locale={locale}")
                    self.assertEqual(page.status_code, 200)
                    self.assertContains(page, escape(t["requested"]))
                    form = page.context["form"]
                    self.assertEqual({key.removeprefix("alternative_") for key in form.fields if key.startswith("alternative_")}, set(categories(profile)))
                    for category in categories(profile):
                        self.assertContains(page, case.alternative_requests[category])
                        self.assertContains(page, f'name="alternative_{category}"')
            result = self.request(f"/admin/verification/reviewcase/{case.pk}/workflow/?locale=en", {
                "version": case.version, "action": "approved", "reason": "Synthetic category-specific review",
                **{"alternative_" + key: "Synthetic accepted " + key for key in categories(profile)},
            }, client=client, format="multipart")
            self.assertEqual(result.status_code, 302)
            case.refresh_from_db()
            self.assertEqual(case.status, "approved")
            self.assertEqual(set(case.accepted_alternatives), set(categories(profile)))

    @override_settings(OWNER_MFA_REQUIRED=False)
    def test_owner_review_alternatives_validation_retains_values(self):
        case = self.alternative_case()
        client = self.owner_client()
        path = f"/admin/verification/reviewcase/{case.pk}/workflow/?locale=en"
        values = {"version": case.version, "action": "approved", "reason": "Synthetic review decision",
            **{"alternative_"+key: "Synthetic accepted " + key for key in case.alternative_requests}}
        invalid = [
            {"alternative_business": ""}, {"alternative_business": "   "},
            {"alternative_business": "X" * 1001}, {"alternative_unrecognized": "Forged category"},
            {"accepted_alternatives": json.dumps({"unknown": "Forged category"})},
        ]
        for bad in invalid:
            with self.subTest(fields=list(bad)):
                response = self.request(path, values | bad, client=client, format="multipart")
                self.assertEqual(response.status_code, 200)
                self.assertTrue(response.context["form"].errors)
                self.assertContains(response, "Synthetic review decision")
                self.assertContains(response, "Synthetic accepted representative_identity")
                case.refresh_from_db()
                self.assertEqual(case.status, "submitted")
                self.assertEqual(case.accepted_alternatives, {})
        response = self.request(path, values, client=client, format="multipart")
        self.assertEqual(response.status_code, 302)
        case.refresh_from_db()
        self.assertEqual(case.reason, values["reason"])
        self.assertEqual(case.accepted_alternatives["business"], values["alternative_business"])

    @override_settings(OWNER_MFA_REQUIRED=False)
    def test_owner_review_evidence_only_approval(self):
        case = self.submit()
        client = self.owner_client()
        response = self.request(f"/admin/verification/reviewcase/{case.pk}/workflow/", {
            "version": case.version, "action": "approved", "reason": "Synthetic ordinary evidence review",
        }, client=client, format="multipart")
        self.assertEqual(response.status_code, 302)
        case.refresh_from_db()
        self.assertEqual(case.status, "approved")
        self.assertEqual(case.accepted_alternatives, {})

    @override_settings(OWNER_MFA_REQUIRED=False)
    def test_owner_review_stale_revision_conflict_and_missing_storage_refused(self):
        case = self.submit()
        client = self.owner_client()
        path = f"/admin/verification/reviewcase/{case.pk}/workflow/"
        values = {"version": case.version, "action": "approved", "reason": "Synthetic guarded review"}
        result = self.request(path, values | {"version": case.version - 1}, client=client, format="multipart")
        self.assertEqual(result.status_code, 200)
        self.assertTrue(result.context["form"].errors)
        item = case.evidence.first()
        with patch.object(storages[item.storage_alias], "exists", return_value=False):
            result = self.request(path, values, client=client, format="multipart")
            self.assertEqual(result.status_code, 200)
            self.assertTrue(result.context["form"].errors)
        update_profile(self.actor, self.profile.pk, {"version": self.profile.version, "legal_name": "Changed legal identity"})
        result = self.request(path, values, client=client, format="multipart")
        self.assertEqual(result.status_code, 200)
        self.assertTrue(result.context["form"].errors)
        case.refresh_from_db()
        self.assertEqual(case.status, "submitted")
        self.assertEqual(client.get(path).status_code, 200)
        conflicted = self.owner_client(self.account)
        self.assertEqual(conflicted.get(path).status_code, 403)
        self.assertEqual(self.request(path, values, client=conflicted, format="multipart").status_code, 403)

    @override_settings(OWNER_MFA_REQUIRED=False)
    def test_owner_membership_and_transfer_forms_have_no_evidence_alternatives(self):
        from apps.organizations.transfers import request_transfer, transfer_action

        client = self.owner_client()
        item = request_transfer(self.actor, self.profile.pk, {"recipient": self.member.pk, "retained_bundles": ["catalogue"]})
        item = transfer_action(ServiceActor(self.member_account), item.pk, {"version": item.version, "action": "accept"})
        path = f"/admin/organizations/ownershiptransfer/{item.pk}/workflow/"
        for url in (path, f"/admin/organizations/membership/{self.member.pk}/workflow/"):
            response = client.get(url)
            self.assertEqual(response.status_code, 200)
            self.assertNotContains(response, 'name="alternative_')
            self.assertNotContains(response, 'name="assigned_to"')
        response = self.request(path, {"version": item.version, "action": "approve", "reason": "Synthetic owner oversight transfer"}, client=client, format="multipart")
        self.assertEqual(response.status_code, 302)
        self.member.refresh_from_db()
        self.assertTrue(self.member.is_owner)
        self.profile.refresh_from_db()
        outgoing = self.profile.memberships.get(account=self.account)
        response = self.request(f"/admin/organizations/membership/{outgoing.pk}/workflow/", {
            "version": self.profile.version, "action": "revoke", "reason": "Synthetic ordinary membership revocation",
        }, client=client, format="multipart")
        self.assertEqual(response.status_code, 302)
        outgoing.refresh_from_db()
        self.assertFalse(outgoing.active)

    def test_assignment_only_response_must_not_disclose_private_case(self):
        case = self.submit()
        target = review_actor("independent-assignment-target")
        self.reviewer.account.permission_groups.first().permissions.set(
            Permission.objects.filter(
                content_type__app_label="verification", codename__in=["view_queue", "assign_review"]
            )
        )
        client = self.staff_client()
        path = f"/api/v1/verification/cases/{case.pk}/"
        self.assertEqual(client.get(path).status_code, 403)
        response = self.request(path, {
            "version": case.version, "action": "assign", "assigned_to": str(target.account.pk),
            "reason": "Synthetic assignment-only review",
        }, client=client)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(client.get(path).status_code, 403)
        self.assertNotIn("snapshot", response.json())
        self.assertNotIn("evidence", response.json())
        self.assertNotIn("history", response.json())
        self.assertNotIn("alternative_requests", response.json())
        self.assert_minimal_review_response(response)
        self.assertEqual(client.get(f"/api/v1/verification/evidence/staff/{case.evidence.first().pk}/").status_code, 403)
        assigned = self.staff_client(target.account)
        self.assertEqual(assigned.get(path).status_code, 200)
        result = self.request(path, {"version": response.json()["version"], "action": "approved",
            "reason": "Synthetic independent assigned decision"}, client=assigned)
        self.assert_minimal_review_response(result)
        self.assertEqual(assigned.get(path).json()["status"], "approved")

    def test_reassignment_response_must_not_disclose_case_assigned_to_another_staff_member(self):
        case = self.assign(self.submit())
        other = review_actor("independent-other-reviewer")
        client = self.staff_client()
        path = f"/api/v1/verification/cases/{case.pk}/"
        self.assertEqual(client.get(path).status_code, 200)
        response = self.request(path, {
            "version": case.version, "action": "assign", "assigned_to": str(other.account.pk),
            "reason": "Synthetic reassignment",
        }, client=client)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(client.get(path).status_code, 403)
        self.assertNotIn("snapshot", response.json())
        self.assertNotIn("evidence", response.json())
        self.assertNotIn("history", response.json())

    def test_owner_admin_can_record_accepted_alternatives_when_approving(self):
        from django.test import override_settings

        reasons = {key: "Synthetic documented alternative" for key in (
            "business", "representative_identity", "representative_authority"
        )}
        case = application_action(self.actor, self.profile.pk, {
            "version": current_case(self.profile).version, "action": "submit", "alternative_requests": reasons,
        })
        owner = self.reviewer.account.user
        owner.owner_authority = owner.is_staff = owner.is_superuser = True
        owner.save()
        with override_settings(OWNER_MFA_REQUIRED=False):
            client = APIClient(enforce_csrf_checks=True)
            signin(client, "owner", owner.email)
            response = self.request(f"/admin/verification/reviewcase/{case.pk}/workflow/?locale=en", {
                "version": case.version, "action": "approved", "reason": "Synthetic reasoned alternative review",
                **{"alternative_" + key: value for key, value in reasons.items()},
            }, client=client, format="multipart")
            self.assertIn(response.status_code, (200, 302))
        case.refresh_from_db()
        self.assertEqual(case.status, "approved")
        self.assertEqual(case.accepted_alternatives, reasons)

    def test_owner_admin_readonly_flags_and_conflict_guarded_workflow(self):
        from django.test import override_settings

        self.account.user.owner_authority = True
        self.account.user.is_staff = True
        self.account.user.is_superuser = True
        self.account.user.save()
        with override_settings(OWNER_MFA_REQUIRED=False):
            client = APIClient(enforce_csrf_checks=True)
            signin(client, "owner", self.account.user.email)
            owner = self.profile.memberships.get(is_owner=True)
            response = self.request(
                f"/admin/organizations/membership/{owner.pk}/change/",
                {"is_owner": "", "active": "", "_save": "Save"},
                client=client,
                format="multipart",
            )
            self.assertIn(response.status_code, (200, 302))
            owner.refresh_from_db()
            self.assertTrue(owner.is_owner)
            self.assertTrue(owner.active)
            response = self.request(
                f"/admin/organizations/membership/{owner.pk}/workflow/",
                {"version": 1, "action": "revoke", "reason": "Attempt removal"},
                client=client,
                format="multipart",
            )
            self.assertEqual(response.status_code, 200)
            owner.refresh_from_db()
            self.assertTrue(owner.active)
            self.populate()
            evidence = current_case(self.profile).evidence.first()
            self.assertEqual(client.get(f"/admin/verification/evidence/{evidence.pk}/download/").status_code, 403)


class OrganizationConcurrencyTests(TransactionTestCase):
    def setUp(self):
        self.actor = ServiceActor(identity("race-owner"))
        self.profile = create_profile(self.actor, profile_values())
        self.recipient = ServiceActor(identity("race-recipient"))
        self.member = Membership.objects.create(
            company=self.profile, account=self.recipient.account, bundles=["catalogue"]
        )
        self.reviewer = review_actor("race-reviewer")

    def concurrent(self, *functions):
        def run(function):
            try:
                function()
                return "ok"
            except APIException:
                return "denied"
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=len(functions)) as pool:
            return list(pool.map(run, functions))

    def test_concurrent_invitation_acceptance_creates_one_membership(self):
        from apps.accounts.delivery import reveal

        self.member.active = False
        self.member.save()
        with patch("apps.organizations.mail.dispatch_invitation"):
            invitation = invite(
                self.actor, self.profile.pk, {"email": self.recipient.user.email, "bundles": [], "locale": "en"}
            )
        token = reveal(invitation.deliveries.first().encrypted_payload)["token"]
        results = self.concurrent(
            lambda: accept_invitation(self.recipient, token), lambda: accept_invitation(self.recipient, token)
        )
        self.assertEqual(results, ["ok", "ok"])
        self.assertEqual(Membership.objects.filter(company=self.profile, account=self.recipient.account).count(), 1)

    def test_concurrent_last_owner_removal_serializes_and_preserves_one(self):
        self.member.is_owner = True
        self.member.bundles = list(BUNDLES)
        self.member.save()
        owner = self.profile.memberships.get(account=self.actor.account)
        results = self.concurrent(
            lambda: change_member(self.actor, self.profile.pk, owner.pk, {"version": 1, "action": "leave"}),
            lambda: change_member(self.recipient, self.profile.pk, self.member.pk, {"version": 1, "action": "leave"}),
        )
        self.assertEqual(sorted(results), ["denied", "ok"])
        self.assertEqual(Membership.objects.filter(company=self.profile, is_owner=True, active=True).count(), 1)

    def submitted(self):
        case = application_action(
            self.actor,
            self.profile.pk,
            {
                "action": "submit",
                "version": 1,
                "alternative_requests": {
                    key: "Synthetic alternative"
                    for key in ("business", "representative_identity", "representative_authority")
                },
            },
        )
        return review_action(
            self.reviewer,
            case.pk,
            {
                "action": "assign",
                "version": case.version,
                "assigned_to": self.reviewer.account.pk,
                "reason": "Synthetic assignment",
            },
        )

    def decision(self, case, action):
        return review_action(
            self.reviewer,
            case.pk,
            {
                "action": action,
                "version": case.version,
                "reason": "Synthetic decision",
                "accepted_alternatives": {
                    key: "Accepted alternative"
                    for key in ("business", "representative_identity", "representative_authority")
                },
            },
        )

    def test_concurrent_decisions_create_one_final_decision(self):
        case = self.submitted()
        results = self.concurrent(lambda: self.decision(case, "approved"), lambda: self.decision(case, "rejected"))
        self.assertEqual(sorted(results), ["denied", "ok"])
        self.assertEqual(
            AuditEvent.objects.filter(
                resource_id=case.pk, action__in=["verification_approved", "verification_rejected"]
            ).count(),
            1,
        )

    def test_review_versus_material_edit_never_leaves_new_identity_approved(self):
        case = self.submitted()
        self.concurrent(
            lambda: self.decision(case, "approved"),
            lambda: update_profile(self.actor, self.profile.pk, {"version": 1, "legal_name": "Changed legal identity"}),
        )
        self.profile.refresh_from_db()
        self.assertEqual(current_case(self.profile).status, "draft")
        self.assertFalse(effective_entitlement(self.profile, self.actor.account))

    def test_transfer_versus_revocation_preserves_owner_and_rechecks_recipient(self):
        item = request_transfer(self.actor, self.profile.pk, {"recipient": self.member.pk, "retained_bundles": []})
        item = transfer_action(self.recipient, item.pk, {"action": "accept", "version": 1})
        results = self.concurrent(
            lambda: transfer_action(
                self.reviewer, item.pk, {"version": item.version, "action": "approve", "reason": "Reviewed"}
            ),
            lambda: change_member(self.actor, self.profile.pk, self.member.pk, {"version": 1, "action": "revoke"}),
        )
        self.assertEqual(sorted(results), ["denied", "ok"])
        self.assertEqual(Membership.objects.filter(company=self.profile, is_owner=True, active=True).count(), 1)
