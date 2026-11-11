"""Phase 16 operations: reports, account closure, audited admin status and staff work queues.

Run only through the maintained disposable MariaDB runner. Every figure comes from the
real order, payment and stock services; nothing mocks a permission or money effect.
"""

import copy
from datetime import timedelta

from django.contrib.auth.models import Group, Permission
from django.http import QueryDict
from django.test import TestCase, override_settings
from django.urls import reverse
from rest_framework.test import APIClient

from apps.accounts.models import Account, AuditEvent
from apps.catalogue import services as catalogue
from apps.catalogue.media import upload
from apps.catalogue.models import Product
from apps.inventory import queries as stock_queries
from apps.inventory.services import today
from apps.organizations.models import BusinessProfile, Membership
from apps.reports import exports, queries
from tests.test_aftercare import AftercareFixture
from tests.test_catalogue import image_file
from tests.test_fulfilment import FulfilmentBatchTests
from tests.test_identity import PASSWORD, signin


@override_settings(OWNER_MFA_REQUIRED=False)
class SellerReportTests(AftercareFixture, TestCase):
    def summary(self, client=None, **params):
        return (client or self.seller_client).get("/api/v1/reports/seller/summary/", {"seller": self.profile.pk, **params})

    def company(self, bundles):
        owner, _ = self.connected("seller", "report-owner-" + "-".join(bundles or ["none"]))
        profile = BusinessProfile.objects.create(account=owner.account, kind="company", display_name="Synthetic co")
        Membership.objects.create(company=profile, account=owner.account, is_owner=True, bundles=[])
        Membership.objects.create(company=profile, account=self.seller.account, is_owner=False, bundles=bundles)
        return profile

    def test_individual_seller_summary_is_exact_per_currency_with_open_work(self):
        order = self.accept("cod")
        response = self.summary()
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertEqual(data["sections"], {"orders": True, "finance": True, "logistics": True})
        self.assertEqual(data["seller"]["id"], str(self.profile.pk))
        [row] = data["orders"]
        self.assertEqual(row["currency"], "AFN")
        self.assertEqual(row["accepted"], 1)
        self.assertEqual(row["cancelled"], 0)
        self.assertEqual(row["goods_total"], format(order.goods_total, ".2f"))
        self.assertEqual(data["finance"], [])
        self.assertEqual(data["logistics"], {"dispatched": 0, "delivered": 0, "completed": 0})
        self.assertEqual(data["queues"]["awaiting_dispatch"], 1)
        for key in ("stock_low", "stock_zero", "stock_expired", "stock_expiring", "publication_pending",
                    "publication_rejected"):
            self.assertIn(key, data["queues"])

    def test_completed_order_moves_money_and_logistics_without_mutating_records(self):
        order = self.completed()
        before = self.domain_state()
        data = self.summary().json()
        self.assertEqual(self.domain_state(), before)
        self.assertEqual(data["orders"][0]["accepted_total"], format(order.goods_total, ".2f"))
        [money] = data["finance"]
        self.assertEqual(money["currency"], "AFN")
        self.assertEqual(money["goods_receipts"], 1)
        self.assertEqual(money["goods_received"], "15.00")
        self.assertEqual(money["goods_net"], "15.00")
        self.assertEqual(data["logistics"], {"dispatched": 1, "delivered": 1, "completed": 1})
        self.assertEqual(data["queues"]["awaiting_dispatch"], 0)

    def test_period_is_bounded_validated_and_strict(self):
        self.accept("cod")
        self.assertEqual(self.summary(start="2026-02-01", end="2026-01-01").status_code, 400)
        self.assertEqual(self.summary(start="2024-01-01", end="2026-01-01").status_code, 400)
        self.assertEqual(self.summary(unknown="1").status_code, 400)
        past = (today() - timedelta(days=400)).isoformat()
        old = self.summary(start=past, end=(today() - timedelta(days=100)).isoformat()).json()
        self.assertEqual(old["orders"], [])

    def test_sections_follow_fresh_membership_bundles(self):
        logistics = self.company(["fulfilment"])
        unrelated = self.company(["messaging"])
        listed = {row["id"]: row["sections"] for row in
                  self.seller_client.get("/api/v1/reports/seller/profiles/").json()["results"]}
        self.assertEqual(listed[str(logistics.pk)], {"orders": False, "finance": False, "logistics": True})
        self.assertNotIn(str(unrelated.pk), listed)
        data = self.seller_client.get("/api/v1/reports/seller/summary/", {"seller": logistics.pk}).json()
        self.assertIsNone(data["orders"])
        self.assertIsNone(data["finance"])
        self.assertIn("holds", data["queues"])
        self.assertNotIn("awaiting_dispatch", data["queues"])
        self.assertIn("stock_low", data["queues"])
        self.assertNotIn("publication_pending", data["queues"])
        self.assertEqual(
            self.seller_client.get("/api/v1/reports/seller/summary/", {"seller": unrelated.pk}).status_code, 404
        )
        export = self.seller_client.get(
            "/api/v1/reports/seller/export/", {"seller": logistics.pk, "kind": "orders"}
        )
        self.assertEqual(export.status_code, 403)
        Membership.objects.filter(company=logistics, account=self.seller.account).update(active=False)
        self.assertEqual(
            self.seller_client.get("/api/v1/reports/seller/summary/", {"seller": logistics.pk}).status_code, 404
        )

    def test_buyer_report_is_own_scope_only(self):
        self.accept("cod")
        data = self.buyer_client.get("/api/v1/reports/buyer/summary/").json()
        self.assertEqual(data["orders"][0]["accepted"], 1)
        self.assertEqual(set(data["queues"]), {"cancellations", "disputes", "in_transit"})
        other = self.other_client.get("/api/v1/reports/buyer/summary/").json()
        self.assertEqual(other["orders"], [])
        self.assertNotEqual(self.buyer_client.get("/api/v1/reports/seller/profiles/").status_code, 200)

    def test_export_is_csv_audited_and_formula_safe(self):
        order = self.accept("cod")
        response = self.seller_client.get(
            "/api/v1/reports/seller/export/", {"seller": self.profile.pk, "kind": "orders"}
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response["Content-Type"].startswith("text/csv"))
        self.assertIn("no-store", response["Cache-Control"])
        body = response.content.decode()
        self.assertTrue(body.startswith("\ufefforder,accepted_at,currency"))
        self.assertIn(str(order.pk), body)
        event = AuditEvent.objects.get(action="seller_report_exported")
        self.assertEqual(event.state["kind"], "orders")
        self.assertEqual(event.state["rows"], 1)
        self.assertEqual(exports.cell("=HYPERLINK(1)"), "'=HYPERLINK(1)")
        self.assertEqual(exports.cell("-5"), "'-5")
        self.assertEqual(exports.cell("plain"), "plain")

    def test_publication_backlog_counts_latest_revision_only(self):
        created = catalogue.create(self.seller, {"seller": self.profile.pk, "currency": "AFN", "pricing_mode": "fixed"})
        product = Product.objects.get(pk=created["id"])
        image = upload(self.seller, product.pk, product.version, image_file())
        product.refresh_from_db()
        body = copy.deepcopy(self.body)
        body["images"] = [{"id": image["id"], "alt": "Synthetic pending goods", "variant": None}]
        body["variants"][0].update(sku="P16-PENDING")
        body["variants"][0].pop("id", None)
        saved = catalogue.save(self.seller, product.pk, {"version": product.version, "body": body})
        product.refresh_from_db()
        catalogue.transition(self.seller, product.pk, {
            "version": product.version, "revision": saved["revision"], "action": "submit", "reason": "Submit",
        })
        result = queries.catalogue_queues(self.seller.account, self.profile)
        self.assertEqual(result["publication_pending"], 1)
        self.assertEqual(result["publication_rejected"], 0)
        page = self.root_client.get(reverse("admin:catalogue_sourcerevision_changelist") + "?state__exact=submitted")
        self.assertEqual(page.status_code, 200)
        self.assertContains(page, "Review")

    def test_root_commerce_report_and_platform_export_staff_denied(self):
        self.accept("cod")
        url = reverse("admin:reports_commerce")
        page = self.root_client.get(url)
        self.assertEqual(page.status_code, 200)
        self.assertContains(page, "Catalogue revisions awaiting publication review")
        export = self.root_client.get(url, {"export": "1", "kind": "orders"})
        self.assertTrue(export["Content-Type"].startswith("text/csv"))
        self.assertTrue(AuditEvent.objects.filter(action="owner_report_exported").exists())
        self.assertEqual(self.staff_client.get(url).status_code, 403)


@override_settings(OWNER_MFA_REQUIRED=False)
class ExpiringStockTests(AftercareFixture, TestCase):
    def test_expiring_batches_are_counted_filtered_and_reported(self):
        FulfilmentBatchTests.batch_stock(self, (today() + timedelta(days=10)).isoformat())
        data = stock_queries.overview(self.seller, self.profile.pk, QueryDict("state=expiring"))
        self.assertGreaterEqual(data["counts"]["expiring"], 1)
        self.assertEqual({row["id"] for row in data["results"]}, {str(self.variant.pk)})
        variant = stock_queries.variants(self.profile).get(pk=self.variant.pk)
        detail = stock_queries.position_data(variant, {"read": True, "write": True}, detail=True)
        self.assertEqual(detail["expiring"], "1.000")
        self.assertTrue(all(batch["expiring"] and not batch["expired"] for batch in detail["batches"]))
        self.assertGreaterEqual(queries.catalogue_queues(self.seller.account, self.profile)["stock_expiring"], 1)
        far = stock_queries.overview(self.seller, self.profile.pk, QueryDict("state=expired"))
        self.assertEqual(far["count"], 0)


@override_settings(OWNER_MFA_REQUIRED=False)
class AccountClosureTests(AftercareFixture, TestCase):
    def closure(self, client, context="buyer", **data):
        return self.post(client, f"auth/{context}/closure/", {"password": PASSWORD, "confirm": True, **data})

    def test_clean_buyer_closes_once_keeps_history_and_signs_out(self):
        actor, client = self.connected("buyer", "closing-buyer")
        account = Account.objects.get(pk=actor.account.pk)
        self.assertEqual(client.get("/api/v1/auth/buyer/closure/").json(), {"context": "buyer", "blockers": []})
        self.assertEqual(self.closure(client, confirm=False).status_code, 400)
        self.assertEqual(self.closure(client, password="Wrong-synthetic-pass-1").status_code, 403)
        account.refresh_from_db()
        self.assertEqual(account.status, "active")
        response = self.closure(client)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json(), {"closed": True, "context": "buyer"})
        closed = Account.objects.get(pk=account.pk)
        self.assertEqual(closed.status, "archived")
        self.assertGreater(closed.access_epoch, account.access_epoch)
        event = AuditEvent.objects.get(action="account_closed", account=closed)
        self.assertEqual(event.reason, "self_service")
        self.assertEqual(event.state["status"], {"before": "active", "after": "archived"})
        self.assertNotEqual(client.get("/api/v1/auth/buyer/closure/").status_code, 200)
        fresh = APIClient(enforce_csrf_checks=True)
        signed = signin(fresh, "buyer", actor.user.email)
        self.assertNotEqual(fresh.get("/api/v1/auth/buyer/closure/").status_code, 200, signed.content)

    def test_open_obligations_block_closure_without_side_effects(self):
        self.accept("cod")
        status = self.buyer_client.get("/api/v1/auth/buyer/closure/").json()
        self.assertIn("open_orders", status["blockers"])
        before = AuditEvent.objects.filter(action="account_closed").count()
        response = self.closure(self.buyer_client)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["fields"], {"blockers": status["blockers"]})
        self.assertEqual(Account.objects.get(pk=self.buyer.account.pk).status, "active")
        self.assertEqual(AuditEvent.objects.filter(action="account_closed").count(), before)
        seller = self.seller_client.get("/api/v1/auth/seller/closure/").json()
        self.assertIn("open_orders", seller["blockers"])

    def test_sole_company_owner_must_hand_over_first(self):
        owner, client = self.connected("seller", "sole-owner")
        company = BusinessProfile.objects.create(account=owner.account, kind="company", display_name="Synthetic sole")
        Membership.objects.create(company=company, account=owner.account, is_owner=True, bundles=[])
        self.assertEqual(client.get("/api/v1/auth/seller/closure/").json()["blockers"], ["sole_company_owner"])
        partner, _ = self.connected("seller", "co-owner")
        Membership.objects.create(company=company, account=partner.account, is_owner=True, bundles=[])
        self.assertEqual(client.get("/api/v1/auth/seller/closure/").json()["blockers"], [])


@override_settings(OWNER_MFA_REQUIRED=False)
class AdminAuditTests(AftercareFixture, TestCase):
    def native_post(self, client, url, data):
        client.get(url)
        return client.post(url, data, HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value)

    def test_status_change_requires_reason_and_records_before_after(self):
        actor, _ = self.connected("buyer", "suspend-me")
        account = Account.objects.get(pk=actor.account.pk)
        url = reverse("admin:accounts_account_change", args=[account.pk])
        refused = self.native_post(self.root_client, url, {"status": "suspended", "status_reason": " "})
        self.assertEqual(refused.status_code, 200)
        self.assertEqual(Account.objects.get(pk=account.pk).status, "active")
        saved = self.native_post(self.root_client, url, {"status": "suspended", "status_reason": "Synthetic abuse"})
        self.assertEqual(saved.status_code, 302)
        event = AuditEvent.objects.get(action="account_suspended", account=account)
        self.assertEqual(event.reason, "Synthetic abuse")
        self.assertEqual(event.state["status"], {"before": "active", "after": "suspended"})
        self.native_post(self.root_client, url, {"status": "active", "status_reason": "Synthetic appeal accepted"})
        self.assertTrue(AuditEvent.objects.filter(action="account_reopened", account=account).exists())

    def test_group_changes_from_either_side_are_audited_per_identity(self):
        group = Group.objects.create(name="Synthetic audited role")
        self.staff.user.groups.add(group)
        forward = AuditEvent.objects.filter(action="admin_groups_changed", subject=self.staff.user).latest("created_at")
        self.assertEqual(forward.state, {"action": "post_add", "group_ids": [str(group.pk)]})
        group.user_set.remove(self.staff.user)
        reverse_event = AuditEvent.objects.filter(
            action="admin_groups_changed", subject=self.staff.user
        ).latest("created_at")
        self.assertEqual(reverse_event.state, {"action": "post_remove", "group_ids": [str(group.pk)]})

    @override_settings(LANGUAGE_CODE="en")
    def test_staff_my_work_lists_only_permitted_queues(self):
        page = self.staff_client.get("/admin/")
        self.assertEqual(page.status_code, 200)
        labels = {row["label"] for row in page.context["my_work"]}
        self.assertIn("Message reports", labels)
        self.assertNotIn("Business verification", labels)
        self.assertNotIn("Disputes", labels)
        group = Group.objects.create(name="Synthetic dispute reader")
        group.permissions.set(Permission.objects.filter(content_type__app_label="orders", codename="read_dispute"))
        self.staff.user.groups.add(group)
        labels = {row["label"] for row in self.staff_client.get("/admin/").context["my_work"]}
        self.assertIn("Disputes", labels)
        self.assertNotIn("my_work", self.root_client.get("/admin/").context or {})
