"""Native dispute/review workspaces: real grants, services and sealed history.

Run only through the maintained disposable MariaDB runner. These tests do not
use a staff REST adapter or mock any business decision or permission boundary.
"""

import uuid
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth.models import Group, Permission
from django.db import DatabaseError
from django.test import TestCase, override_settings
from django.urls import reverse
from rest_framework.exceptions import PermissionDenied
from rest_framework.test import APIClient

from apps.accounts.admin import owner_site
from apps.accounts.models import AuditEvent
from apps.foundation.storage import FileLocation
from apps.orders import disputes, reviews
from apps.orders.models import (
    DisputeDecision, DisputeRequest, DisputeResponse, Review, ReviewDecision,
)
from apps.payments import media
from apps.payments.models import Evidence, EvidenceBinding, RefundDue, RefundReport
from tests.test_aftercare import AftercareFixture
from tests.test_catalogue import image_file
from tests.test_messaging import request_actor
from tests.test_staff_admin import admin_signin


@override_settings(OWNER_MFA_REQUIRED=False)
class DisputeAdminTests(AftercareFixture, TestCase):
    def grant(self, *codes, delivery=False):
        group = Group.objects.create(name="Synthetic dispute-admin " + uuid.uuid4().hex)
        permissions = Permission.objects.filter(content_type__app_label="orders", codename__in=codes)
        self.assertEqual(set(permissions.values_list("codename", flat=True)), set(codes))
        group.permissions.set(permissions)
        if delivery:
            group.permissions.add(*Permission.objects.filter(
                content_type__app_label="fulfilment",
                codename__in=["read_fulfilment", "assign_fulfilment", "manage_delivery_holds"],
            ))
        self.staff.user.groups.add(group)
        return group

    def open_dispute(self, order=None, *, images=()):
        order = order or self.completed()
        result = disputes.mutate(self.buyer, order.pk, "dispute_open", {
            "command_id": uuid.uuid4(), "version": self.head(order),
            "reason": "Synthetic private buyer dispute reason", "evidence": list(images),
        })
        return DisputeRequest.objects.get(pk=result["dispute"])

    def submit_review(self, order=None):
        order = order or self.completed()
        reviews.mutate(self.buyer, order.pk, "review_submit", {
            "command_id": uuid.uuid4(), "version": self.head(order), "rating": 4,
            "text": "Synthetic verbatim buyer review <script>not executable</script>", "language": "fa-AF",
        })
        return Review.objects.get(order=order)

    def dispute_url(self, row):
        return reverse("admin:orders_disputerequest_review", args=[row.pk])

    def review_url(self, row):
        return reverse("admin:orders_review_moderate", args=[row.pk])

    def native_packet(self, client, url, action, **extra):
        response = client.get(url)
        self.assertEqual(response.status_code, 200)
        form = response.context["form"]
        return {
            **{key: str(form[key].value()) for key in ("packet", "command_id", "version", "case_version")},
            "action": action, "reason": "Synthetic native guarded decision reason", **extra,
        }

    def native_post(self, client, url, data):
        return client.post(url, data, HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value)

    def assign_dispute(self, row, user=None):
        result = self.native_post(self.root_client, self.dispute_url(row), self.native_packet(
            self.root_client, self.dispute_url(row), "assign", assigned_to=str((user or self.root.user).pk),
        ))
        self.assertEqual(result.status_code, 302)
        row.refresh_from_db()
        return result

    def domain_snapshot(self):
        return {
            "aftercare": self.domain_state(), "inventory": self.inventory_state(),
            **{model._meta.label: list(model.objects.order_by("pk").values()) for model in (
                DisputeRequest, DisputeResponse, DisputeDecision, Review, ReviewDecision, Evidence, EvidenceBinding,
            )},
        }

    def seller_root(self):
        self.seller.user.is_staff = True
        self.seller.user.is_superuser = True
        self.seller.user.save(update_fields=["is_staff", "is_superuser"])
        client = APIClient(enforce_csrf_checks=True)
        admin_signin(client, self.seller.user)
        return request_actor(client, "owner", self.seller.user), client

    def test_root_can_read_both_workspaces_without_staff_account_and_get_head_do_not_mutate(self):
        order = self.completed()
        row = self.open_dispute(order)
        review = self.submit_review(order)
        before = self.domain_snapshot()
        for url, text in ((self.dispute_url(row), row.reason), (self.review_url(review), "Synthetic verbatim")):
            response = self.root_client.get(url)
            self.assertEqual(response.status_code, 200)
            self.assertContains(response, text)
            self.assertIn("private, no-store", response["Cache-Control"])
            self.assertNotContains(response, self.buyer.user.email)
            self.assertNotContains(response, self.seller.user.email)
            self.assertEqual(self.root_client.head(url).status_code, 200)
        self.assertEqual(self.domain_snapshot(), before)
        self.assertFalse(self.root.user.accounts.filter(context="staff").exists())
        self.assertTrue(AuditEvent.objects.filter(action="dispute_native_workspace", resource_id=row.pk).exists())
        self.assertTrue(AuditEvent.objects.filter(action="review_native_workspace", resource_id=review.pk).exists())

    def test_staff_without_domain_reads_cannot_see_lists_or_workspaces(self):
        row = self.open_dispute()
        review = self.submit_review(row.order)
        for model in ("disputerequest", "disputeresponse", "disputedecision", "review", "reviewdecision"):
            self.assertEqual(self.staff_client.get(f"/admin/orders/{model}/").status_code, 403)
        self.assertEqual(self.staff_client.get(self.dispute_url(row)).status_code, 404)
        self.assertEqual(self.staff_client.get(self.review_url(review)).status_code, 404)

    def test_read_dispute_does_not_require_read_aftercare_and_is_assignment_scoped(self):
        self.grant("read_dispute", "decide_dispute", delivery=True)
        row = self.open_dispute()
        queue = "/admin/orders/disputerequest/"
        self.assertEqual(list(self.staff_client.get(queue).context["cl"].result_list), [])
        self.assertEqual(self.staff_client.get(self.dispute_url(row)).status_code, 404)
        self.assign_dispute(row, self.staff.user)
        self.assertEqual([item.pk for item in self.staff_client.get(queue).context["cl"].result_list], [row.pk])
        self.assertContains(self.staff_client.get(self.dispute_url(row)), row.reason)
        self.assertEqual(self.staff_client.get("/admin/orders/cancellationrequest/").status_code, 403)

    def test_assignment_staff_only_get_metadata_until_assigned_and_cannot_read_child_history(self):
        self.grant("read_dispute", "assign_dispute", "decide_dispute", delivery=True)
        row = self.open_dispute()
        disputes.mutate(self.seller, row.order_id, "dispute_respond", {
            "command_id": uuid.uuid4(), "version": self.head(row.order), "dispute": row.pk,
            "text": "Synthetic private seller response",
        })
        response = self.staff_client.get(self.dispute_url(row))
        self.assertEqual(response.status_code, 200)
        self.assertNotContains(response, row.reason)
        self.assertNotContains(response, "Synthetic private seller response")
        self.assertIsNone(response.context["refund_bound"])
        native = self.staff_client.get(f"/admin/orders/disputerequest/{row.pk}/change/")
        self.assertEqual(native.status_code, 200)
        self.assertNotContains(native, row.reason)
        history = self.staff_client.get("/admin/orders/disputeresponse/")
        self.assertEqual(list(history.context["cl"].result_list), [])
        self.assertEqual(self.staff_client.get(f"/admin/orders/disputeresponse/{row.pk}/change/").status_code, 302)

    def test_native_staff_assignment_and_resolution_use_services_and_close_linked_hold(self):
        self.grant("read_dispute", "assign_dispute", "decide_dispute", delivery=True)
        row = self.open_dispute()
        url = self.dispute_url(row)
        assigned = self.native_post(self.staff_client, url, self.native_packet(
            self.staff_client, url, "assign", assigned_to=str(self.staff.user.pk),
        ))
        self.assertEqual(assigned.status_code, 302)
        row.refresh_from_db()
        self.assertEqual(row.assigned_to_id, self.staff.user.pk)
        decided = self.native_post(self.staff_client, url, self.native_packet(self.staff_client, url, "resolve"))
        self.assertEqual(decided.status_code, 302)
        row.refresh_from_db()
        self.assertEqual(row.state, "resolved_non_monetary")
        decision = DisputeDecision.objects.get(dispute=row)
        self.assertEqual((decision.actor_id, decision.context), (self.staff.user.pk, "staff"))
        self.assertTrue(row.blocker.closure.pk)
        self.assertFalse(RefundDue.objects.filter(order=row.order).exists())

    def test_root_dismiss_requires_exact_assignment_and_records_one_decision(self):
        row = self.open_dispute()
        url = self.dispute_url(row)
        before = self.domain_snapshot()
        rejected = self.native_post(self.root_client, url, self.native_packet(self.root_client, url, "dismiss"))
        self.assertIn("action", rejected.context["form"].errors)
        self.assertEqual(self.domain_snapshot(), before)
        self.assign_dispute(row)
        decided = self.native_post(self.root_client, url, self.native_packet(self.root_client, url, "dismiss"))
        self.assertEqual(decided.status_code, 302)
        self.assertEqual(DisputeDecision.objects.get(dispute=row).action, "dismissed")
        self.assertEqual(DisputeDecision.objects.filter(dispute=row).count(), 1)

    def test_refund_displays_current_exact_bound_and_orders_due_without_execution(self):
        order = self.completed("15.00")
        self.due(order, "2.50")
        row = self.open_dispute(order)
        self.assign_dispute(row)
        url = self.dispute_url(row)
        response = self.root_client.get(url)
        self.assertEqual(response.context["refund_bound"], "12.50")
        self.assertContains(response, "12.50 AFN")
        decided = self.native_post(self.root_client, url, self.native_packet(self.root_client, url, "refund", amount="12.50"))
        self.assertEqual(decided.status_code, 302)
        decision = DisputeDecision.objects.get(dispute=row)
        self.assertEqual((decision.action, decision.amount), ("refund_ordered", Decimal("12.50")))
        self.assertEqual(decision.refund_due.cause, "dispute")
        self.assertFalse(RefundReport.objects.exists())
        self.assertTrue(order.completion.pk)

    def test_refund_over_current_bound_is_refused_and_retains_input_and_packet(self):
        row = self.open_dispute()
        self.assign_dispute(row)
        url = self.dispute_url(row)
        data = self.native_packet(self.root_client, url, "refund", amount="99.00")
        before = self.domain_snapshot()
        response = self.native_post(self.root_client, url, data)
        self.assertEqual(response.status_code, 400)
        self.assertTrue(response.context["form"].non_field_errors())
        for key in ("amount", "reason", "packet", "command_id", "version", "case_version"):
            self.assertEqual(str(response.context["form"][key].value()), data[key])
        self.assertEqual(self.domain_snapshot(), before)

    def test_stale_aftercare_packet_preserves_fields_without_adopting_new_version(self):
        row = self.open_dispute()
        self.assign_dispute(row)
        url = self.dispute_url(row)
        data = self.native_packet(self.root_client, url, "resolve")
        self.submit_review(row.order)
        before = self.domain_snapshot()
        response = self.native_post(self.root_client, url, data)
        self.assertEqual(response.status_code, 400)
        self.assertTrue(response.context["form"].non_field_errors())
        self.assertEqual(response.context["form"]["version"].value(), data["version"])
        self.assertEqual(response.context["form"]["reason"].value(), data["reason"])
        self.assertEqual(response.context["form"]["packet"].value(), data["packet"])
        self.assertEqual(self.domain_snapshot(), before)

    def test_root_seller_conflict_remains_readable_but_cannot_decide_or_be_assignee(self):
        row = self.open_dispute()
        actor, client = self.seller_root()
        url = self.dispute_url(row)
        response = client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, row.reason)
        self.assertFalse(response.context["independent"])
        self.assertNotIn(actor.user.pk, response.context["form"].fields["assigned_to"].queryset.values_list("pk", flat=True))
        before = self.domain_snapshot()
        response = self.native_post(client, url, self.native_packet(client, url, "dismiss"))
        self.assertIn("action", response.context["form"].errors)
        self.assertEqual(self.domain_snapshot(), before)
        with self.assertRaises(PermissionDenied):
            disputes.independent(row.order, actor.user, dispute=row)

    def test_review_read_and_moderation_are_separate_from_aftercare_and_disputes(self):
        self.grant("read_review")
        row = self.submit_review()
        response = self.staff_client.get(self.review_url(row))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Synthetic verbatim")
        self.assertNotContains(response, "<script>not executable</script>")
        self.assertEqual([key for key, _ in response.context["form"].fields["action"].choices], [""])
        self.assertEqual(self.staff_client.get("/admin/orders/review/").status_code, 200)
        self.assertEqual(self.staff_client.get("/admin/orders/disputerequest/").status_code, 403)
        self.assertEqual(self.staff_client.get("/admin/orders/cancellationrequest/").status_code, 403)
        before = self.domain_snapshot()
        rejected = self.native_post(self.staff_client, self.review_url(row), self.native_packet(self.staff_client, self.review_url(row), "approve"))
        self.assertIn("action", rejected.context["form"].errors)
        self.assertEqual(self.domain_snapshot(), before)

    def test_native_staff_approves_and_withdraws_with_append_only_moderation_history(self):
        self.grant("read_review", "moderate_review")
        row = self.submit_review()
        url = self.review_url(row)
        response = self.native_post(self.staff_client, url, self.native_packet(self.staff_client, url, "approve"))
        self.assertEqual(response.status_code, 302)
        row.refresh_from_db()
        self.assertEqual(row.state, "approved")
        self.assertEqual(reviews.aggregate(row.order.seller)["count"], 1)
        original_text = row.text
        response = self.native_post(self.staff_client, url, self.native_packet(self.staff_client, url, "withdraw"))
        self.assertEqual(response.status_code, 302)
        row.refresh_from_db()
        self.assertEqual((row.state, row.text), ("withdrawn", original_text))
        self.assertEqual(set(row.decisions.values_list("action", flat=True)), {"approved", "withdrawn"})
        self.assertEqual(reviews.aggregate(row.order.seller), {"count": 0, "average": None})

    def test_root_can_reject_pending_review_through_guarded_form(self):
        row = self.submit_review()
        response = self.native_post(self.root_client, self.review_url(row), self.native_packet(self.root_client, self.review_url(row), "reject"))
        self.assertEqual(response.status_code, 302)
        self.assertEqual(ReviewDecision.objects.get(review=row).action, "rejected")

    def test_review_stale_packet_retains_reason_and_cannot_moderate(self):
        row = self.submit_review()
        url = self.review_url(row)
        data = self.native_packet(self.root_client, url, "approve")
        self.open_dispute(row.order)
        before = self.domain_snapshot()
        response = self.native_post(self.root_client, url, data)
        self.assertEqual(response.status_code, 400)
        self.assertTrue(response.context["form"].non_field_errors())
        self.assertEqual(response.context["form"]["reason"].value(), data["reason"])
        self.assertEqual(response.context["form"]["packet"].value(), data["packet"])
        self.assertEqual(self.domain_snapshot(), before)

    def test_root_seller_conflict_cannot_moderate_even_with_root_scope(self):
        row = self.submit_review()
        actor, client = self.seller_root()
        url = self.review_url(row)
        response = client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.context["independent"])
        before = self.domain_snapshot()
        response = self.native_post(client, url, self.native_packet(client, url, "approve"))
        self.assertIn("action", response.context["form"].errors)
        self.assertEqual(self.domain_snapshot(), before)
        with self.assertRaises(PermissionDenied):
            reviews.independent(row.order, actor.user, review=row)

    def test_fresh_native_group_revocation_removes_read_and_action_rights(self):
        group = self.grant("read_review", "moderate_review")
        row = self.submit_review()
        data = self.native_packet(self.staff_client, self.review_url(row), "approve")
        group.permissions.remove(Permission.objects.get(content_type__app_label="orders", codename="moderate_review"))
        before = self.domain_snapshot()
        response = self.native_post(self.staff_client, self.review_url(row), data)
        self.assertIn("action", response.context["form"].errors)
        self.assertEqual(self.domain_snapshot(), before)
        self.staff.user.groups.remove(group)
        self.assertEqual(self.staff_client.get(self.review_url(row)).status_code, 404)
        self.assertEqual(self.staff_client.get("/admin/orders/review/").status_code, 403)

    def test_hidden_packet_cannot_be_forged_or_moved_between_cases_or_actors(self):
        self.grant("read_review", "moderate_review")
        first = self.submit_review()
        second = self.submit_review()
        data = self.native_packet(self.root_client, self.review_url(first), "approve")
        before = self.domain_snapshot()
        for client, url, changed in (
            (self.root_client, self.review_url(first), {**data, "version": str(int(data["version"]) + 1)}),
            (self.root_client, self.review_url(first), {**data, "packet": "forged-packet"}),
            (self.root_client, self.review_url(second), data),
            (self.staff_client, self.review_url(first), data),
        ):
            with self.subTest(url=url, changed=changed["packet"] == "forged-packet"):
                response = self.native_post(client, url, changed)
                self.assertIn("packet", response.context["form"].errors)
        self.assertEqual(self.domain_snapshot(), before)

    def test_csrf_strict_methods_queries_and_extra_post_fields_refuse_without_effects(self):
        row = self.submit_review()
        url = self.review_url(row)
        data = self.native_packet(self.root_client, url, "approve")
        before = self.domain_snapshot()
        self.assertEqual(self.root_client.post(url, data).status_code, 403)
        self.assertEqual(self.root_client.get(url + "?page=1").status_code, 403)
        for method in ("put", "patch", "delete"):
            response = getattr(self.root_client, method)(url, {}, HTTP_X_CSRFTOKEN=self.root_client.cookies["csrftoken"].value)
            self.assertEqual(response.status_code, 403)
        self.assertEqual(self.native_post(self.root_client, url, {**data, "state": "approved"}).status_code, 403)
        self.assertEqual(self.domain_snapshot(), before)

    def test_child_history_has_correct_scopes_and_no_inline_or_generic_write_bypass(self):
        self.grant("read_review", "moderate_review", "read_dispute", "decide_dispute", delivery=True)
        order = self.completed()
        row = self.open_dispute(order)
        self.assign_dispute(row, self.staff.user)
        disputes.mutate(self.seller, order.pk, "dispute_respond", {
            "command_id": uuid.uuid4(), "version": self.head(order), "dispute": row.pk,
            "text": "Synthetic retained seller response",
        })
        self.native_post(self.staff_client, self.dispute_url(row), self.native_packet(self.staff_client, self.dispute_url(row), "dismiss"))
        review = self.submit_review(order)
        self.native_post(self.staff_client, self.review_url(review), self.native_packet(self.staff_client, self.review_url(review), "approve"))
        objects = (row, DisputeResponse.objects.get(dispute=row), DisputeDecision.objects.get(dispute=row),
                   review, ReviewDecision.objects.get(review=review))
        before = self.domain_snapshot()
        for obj in objects:
            registered = owner_site._registry[type(obj)]
            self.assertEqual(list(registered.inlines), [])
            model = obj._meta.model_name
            response = self.staff_client.get(f"/admin/orders/{model}/")
            self.assertEqual(response.status_code, 200)
            self.assertEqual([item.pk for item in response.context["cl"].result_list], [obj.pk])
            for client in (self.root_client, self.staff_client):
                for operation in ("change", "delete"):
                    response = self.native_post(client, f"/admin/orders/{model}/{obj.pk}/{operation}/", {"state": "approved", "post": "yes"})
                    self.assertEqual(response.status_code, 403)
        self.assertEqual(self.domain_snapshot(), before)

    def test_review_only_shared_head_and_event_history_do_not_leak_other_aftercare_families(self):
        self.grant("read_review")
        order = self.completed()
        row = self.open_dispute(order)
        review = self.submit_review(order)
        head = self.staff_client.get("/admin/orders/aftercare/")
        self.assertEqual(head.status_code, 200)
        self.assertEqual([item.order_id for item in head.context["cl"].result_list], [order.pk])
        events = self.staff_client.get("/admin/orders/aftercareevent/")
        self.assertEqual(events.status_code, 200)
        self.assertEqual([item.pk for item in events.context["cl"].result_list], [review.event_id])
        self.assertNotIn(row.event_id, [item.pk for item in events.context["cl"].result_list])

    def test_assigned_dispute_shared_history_stays_scoped_and_unassigned_history_is_hidden(self):
        self.grant("read_dispute", "assign_dispute", "decide_dispute", delivery=True)
        row = self.open_dispute()
        review = self.submit_review(row.order)
        self.assertEqual(list(self.staff_client.get("/admin/orders/aftercare/").context["cl"].result_list), [])
        self.assign_dispute(row, self.staff.user)
        events = self.staff_client.get("/admin/orders/aftercareevent/").context["cl"].result_list
        self.assertTrue(events)
        self.assertTrue(all(item.action.startswith("dispute_") for item in events))
        self.assertNotIn(review.event_id, [item.pk for item in events])

    def test_audit_failure_refuses_workspace_disclosure(self):
        row = self.open_dispute()
        with patch("apps.orders.admin.audit", side_effect=DatabaseError("Synthetic audit unavailable")):
            response = self.root_client.get(self.dispute_url(row))
        self.assertEqual(response.status_code, 503)
        self.assertNotContains(response, row.reason, status_code=503)
        self.assertIn("private, no-store", response["Cache-Control"])

    def evidence_dispute(self):
        order = self.completed()
        images = [media.upload(self.buyer, order.pk, uuid.uuid4(), image_file())["id"] for _ in range(3)]
        row = self.open_dispute(order, images=images)
        return row, images

    def test_private_evidence_requires_read_permission_exact_assignment_and_binding(self):
        self.grant("read_dispute", "assign_dispute", "decide_dispute", delivery=True)
        row, images = self.evidence_dispute()
        url = reverse("admin:orders_disputerequest_evidence", args=[row.pk, images[0]])
        self.assertEqual(self.staff_client.get(url).status_code, 403)
        self.assign_dispute(row, self.staff.user)
        self.assertEqual(self.staff_client.get(url).status_code, 403)
        self.grant("read_dispute_evidence")
        self.assertEqual(self.staff_client.head(url).status_code, 200)
        unrelated = self.open_dispute()
        other_url = reverse("admin:orders_disputerequest_evidence", args=[unrelated.pk, images[0]])
        self.assertEqual(self.root_client.get(other_url).status_code, 404)
        self.assertEqual(self.staff_client.get(other_url).status_code, 403)
        self.assign_dispute(row)
        self.assertEqual(self.staff_client.get(url).status_code, 403)

    def test_three_protected_image_links_and_audit_precedes_private_storage_open(self):
        row, images = self.evidence_dispute()
        response = self.root_client.get(self.dispute_url(row))
        self.assertEqual(len(response.context["images"]), 3)
        original_open = FileLocation.open
        evidence = Evidence.objects.get(pk=images[0])
        url = reverse("admin:orders_disputerequest_evidence", args=[row.pk, evidence.pk])
        for method, action in (("get", "dispute_evidence_read"), ("head", "dispute_evidence_head")):
            def audited_open(location):
                self.assertTrue(AuditEvent.objects.filter(action=action, resource_id=evidence.pk).exists())
                return original_open(location)

            with patch.object(FileLocation, "open", audited_open):
                result = getattr(self.root_client, method)(url, HTTP_RANGE="bytes=0-3")
                self.assertEqual(result.status_code, 200)
                self.assertEqual(result["Accept-Ranges"], "none")
                self.assertEqual(result["Content-Type"], "image/jpeg")
                self.assertIn("private, no-store", result["Cache-Control"])
                if method == "get":
                    self.assertEqual(len(b"".join(result.streaming_content)), evidence.size)
                else:
                    self.assertEqual(result.content, b"")
                self.assertTrue(result.closed)
        before = self.domain_snapshot()
        self.assertEqual(self.root_client.get(url + "?download=1").status_code, 403)
        self.assertEqual(self.native_post(self.root_client, url, {}).status_code, 403)
        self.assertEqual(self.domain_snapshot(), before)

    def test_evidence_without_assignee_shows_no_links_even_with_evidence_rights(self):
        self.grant("read_dispute", "assign_dispute", "read_dispute_evidence")
        row, _ = self.evidence_dispute()
        response = self.staff_client.get(self.dispute_url(row))
        self.assertEqual(response.context["images"], [])
        self.assertNotContains(response, "Read protected image")
