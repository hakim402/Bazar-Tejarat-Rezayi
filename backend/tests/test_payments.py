"""Real-grant financial regressions; only the owned native test runner may run these."""

import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from django.db import connections
from django.test import TransactionTestCase
from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch
from django.test import TestCase, override_settings
from django.db import connection, transaction, DatabaseError
from django.utils import timezone
from rest_framework.exceptions import ValidationError, PermissionDenied
from apps.organizations.access import Conflict
from apps.orders import services as orders, queries as order_queries
from apps.orders.models import SellerOrder
from apps.inventory.models import Bucket, Allocation
from apps.payments import services as pay, queries, allocation
from apps.payments.models import (
    Finance,
    StockPlan,
    Event,
    Command,
    Receipt,
    Claim,
    ClaimDecision,
    ReviewCase,
    AllocationIntent,
)
from tests.test_commerce import CommerceFixture


@override_settings(OWNER_MFA_REQUIRED=False)
class PaymentsTests(CommerceFixture, TestCase):
    def accept(self, method="advance"):
        self.add()
        orders.submit(self.buyer, self.packet(method))
        return SellerOrder.objects.get()

    def command(self, order, action, actor=None, **fields):
        actor = actor or self.seller
        return pay.mutate(
            actor,
            order.pk,
            action,
            {
                "command_id": uuid.uuid4(),
                "version": Finance.objects.filter(order=order).values_list("version", flat=True).first() or 0,
                **fields,
            },
        )

    def facts(self, amount="5.00"):
        return {
            "amount": amount,
            "currency": "AFN",
            "paid_at": timezone.now() - timedelta(minutes=1),
            "description": "Synthetic actual cash receipt",
        }

    def plan(self, order, **extra):
        return self.command(
            order,
            "plan",
            intent_version=AllocationIntent.objects.filter(order=order).values_list("version", flat=True).first() or 0,
            reason="Exact accepted goods selection",
            lines=[{"variant": str(self.variant.pk), "batch": None, "quantity": "1.000"}],
            **extra,
        )

    def decide(self, case, action, **extra):
        case.refresh_from_db()
        return pay.decide(
            self.root,
            case.pk,
            {
                "command_id": uuid.uuid4(),
                "version": Finance.objects.get(order=case.order).version,
                "case_version": case.version,
                "action": action,
                "reason": "Independent synthetic review",
                **extra,
            },
        )

    def assign_decide(self, case, action="approve"):
        self.decide(case, "assign", assigned_to=self.root.user.pk)
        return self.decide(case, action)

    def test_read_does_not_create_finance_and_exact_dimensions(self):
        order = self.accept()
        data = queries.detail(self.buyer, order.pk)
        self.assertEqual((data["confirmed_total"], data["remaining"], data["financial"]), ("0.00", "12.50", "unpaid"))
        self.assertFalse(Finance.objects.exists())
        self.assertEqual(order_queries.order_page(self.buyer)["results"][0]["dimensions"]["financial"], "unpaid")

    def test_claim_no_money_or_hold_exact_confirm_and_command_replay(self):
        order = self.accept()
        claim = self.command(order, "claim", self.buyer, **self.facts())["outcome"]["claim"]
        self.assertEqual(queries.confirmed(order), 0)
        self.assertEqual(Bucket.objects.get().held, 0)
        packet = {
            "command_id": uuid.uuid4(),
            "version": 1,
            "claim": claim,
            "claim_version": 1,
            "reason": "Exact receipt confirmed",
        }
        first = pay.mutate(self.seller, order.pk, "confirm", packet)
        second = pay.mutate(self.seller, order.pk, "confirm", packet)
        self.assertEqual(first["outcome"], second["outcome"])
        self.assertEqual(Receipt.objects.count(), 1)
        self.assertEqual(
            (first["current"]["confirmed_total"], first["current"]["allocation"]), ("5.00", "awaiting_selection")
        )
        self.assertEqual(ClaimDecision.objects.get().action, "confirmed")

    def test_first_positive_receipt_reserves_whole_order_once(self):
        order = self.accept()
        self.plan(order)
        first = self.command(order, "receipt", **self.facts())
        self.assertEqual(first["current"]["allocation"], "reserved")
        self.assertEqual(Bucket.objects.get().held, Decimal("1.000"))
        self.command(order, "receipt", **self.facts("2.00"))
        allocation.execute(order.pk)
        self.assertEqual(Allocation.objects.count(), 1)
        self.assertEqual(Bucket.objects.get().held, Decimal("1.000"))
        self.assertEqual(order_queries.order_page(self.buyer)["results"][0]["dimensions"]["financial"], "partial")

    def test_cod_receipt_never_allocates_and_overpayment_separate(self):
        order = self.accept("cod")
        result = self.command(order, "receipt", **self.facts("13.00"))
        self.assertEqual((result["current"]["financial"], result["current"]["overpayment"]), ("overpaid", "0.50"))
        self.assertFalse(AllocationIntent.objects.exists())
        self.assertEqual(Bucket.objects.get().held, 0)

    def test_recorded_receipt_survives_stock_dependency_failure_and_recovers(self):
        order = self.accept()
        self.plan(order)
        with patch("apps.payments.allocation.before_stock", side_effect=OSError("Synthetic stock dependency")):
            value = self.command(order, "receipt", **self.facts())
        self.assertEqual(Receipt.objects.count(), 1)
        self.assertEqual(value["current"]["allocation"], "pending")
        allocation.execute(order.pk)
        self.assertEqual(AllocationIntent.objects.get().state, "reserved")

    def test_shortage_preserves_receipt_and_exact_replenishment(self):
        order = self.accept()
        self.plan(order)
        from apps.inventory import services as stock
        from apps.inventory.models import Position

        stock.manual(
            self.seller,
            self.profile.pk,
            self.variant.pk,
            {
                "token": str(uuid.uuid4()),
                "reason": "Synthetic outgoing adjustment",
                "version": Position.objects.get(pk=self.variant.pk).version,
                "quantity": "-100.000",
            },
            adjustment=True,
        )
        value = self.command(order, "receipt", **self.facts())
        self.assertEqual(value["current"]["allocation"], "shortage")
        self.assertEqual(queries.confirmed(order), Decimal("5.00"))
        self.assertFalse(Allocation.objects.exists())
        self.seed_stock(self.variant, "2.000")
        self.assign_decide(ReviewCase.objects.get(kind="shortage"), "replenish")
        self.assertEqual(AllocationIntent.objects.get().state, "reserved")

    def test_approved_zero_correction_preserves_hold_and_original(self):
        order = self.accept()
        self.plan(order)
        receipt = self.command(order, "receipt", **self.facts())["outcome"]["receipt"]
        self.command(
            order,
            "correction",
            receipt=receipt,
            receipt_version=1,
            reason="Correct incorrect receipt facts",
            **self.facts("0.00"),
        )
        self.assertEqual(queries.confirmed(order), Decimal("5.00"))
        self.assign_decide(ReviewCase.objects.get(kind="correction"))
        self.assertEqual(queries.confirmed(order), 0)
        retained = queries.before_correction(ReviewCase.objects.get(kind="correction").correction)
        self.assertEqual((retained["amount"], retained["version"]), ("5.00", 1))
        self.assertEqual(Receipt.objects.get().amount, Decimal("5.00"))
        self.assertEqual(Bucket.objects.get().held, 1)
        self.assertTrue(ReviewCase.objects.filter(kind="zero_balance", state="open").exists())

    def test_correction_rejection_not_money_reversal(self):
        order = self.accept("cod")
        receipt = self.command(order, "receipt", **self.facts())["outcome"]["receipt"]
        self.command(
            order,
            "correction",
            receipt=receipt,
            receipt_version=1,
            reason="Propose synthetic correction",
            **self.facts("1.00"),
        )
        self.assign_decide(ReviewCase.objects.get(kind="correction"), "reject")
        self.assertEqual(queries.confirmed(order), Decimal("5.00"))
        self.assign_decide(ReviewCase.objects.get(kind="receipt"), "reject")
        self.assertEqual(queries.confirmed(order), Decimal("5.00"))

    def test_extension_original_due_immutable_and_generation_strict(self):
        order = self.accept()
        original = order.due_at
        result = self.command(
            order,
            "extension",
            deadline_generation=1,
            due_at=original + timedelta(days=1),
            reason="Agreed later due deadline",
        )
        order.refresh_from_db()
        self.assertEqual(order.due_at, original)
        self.assertEqual(result["current"]["deadline_generation"], 2)
        with self.assertRaises(Conflict):
            self.command(
                order,
                "extension",
                deadline_generation=1,
                due_at=original + timedelta(days=2),
                reason="Stale deadline generation",
            )

    def test_withdraw_reject_and_replacement_claim_immutable(self):
        order = self.accept()
        claim = self.command(order, "claim", self.buyer, **self.facts())["outcome"]["claim"]
        self.command(
            order, "withdraw", self.buyer, claim=claim, claim_version=1, reason="Withdraw wrong transfer facts"
        )
        new = self.command(order, "claim", self.buyer, previous=claim, **self.facts("6.00"))
        self.assertNotEqual(new["outcome"]["claim"], claim)
        with self.assertRaises(Conflict):
            self.command(order, "confirm", claim=claim, claim_version=1, reason="Stale confirmation attempt")

    def test_fenced_absence_blocks_delayed_original_and_foreign_identity(self):
        order = self.accept()
        key = uuid.uuid4()
        pay.reconcile(self.buyer, order.pk, key, settle=True)
        with self.assertRaises(Conflict):
            pay.mutate(self.buyer, order.pk, "claim", {"command_id": key, "version": 0, **self.facts()})
        with self.assertRaises(PermissionDenied):
            pay.reconcile(self.seller, order.pk, key)
        self.assertFalse(Receipt.objects.exists())
        self.assertFalse(Claim.objects.exists())

    def test_buyer_cannot_receipt_and_foreign_buyer_cannot_read(self):
        order = self.accept()
        with self.assertRaises(PermissionDenied):
            self.command(order, "receipt", self.buyer, **self.facts())
        from django.http import Http404

        with self.assertRaises(Http404):
            queries.detail(self.other_buyer, order.pk)

    def test_exact_money_rejects_float_overprecision_exponent_and_future(self):
        order = self.accept()
        for value in [1.0, "1", "1.001", "1e2", "NaN", "-1.00", "0.00", "10000000000000000000000.00"]:
            with self.subTest(value=value), self.assertRaises(ValidationError):
                self.command(order, "receipt", **self.facts(value))
        with self.assertRaises(ValidationError):
            self.command(order, "receipt", **{**self.facts(), "paid_at": timezone.now() + timedelta(days=1)})

    def test_receipt_and_money_history_raw_sql_immutable(self):
        order = self.accept("cod")
        self.command(order, "receipt", **self.facts())
        item = Receipt.objects.get()
        for query, args in [
            ("UPDATE payments_receipt SET amount=0 WHERE id=%s", [item.pk.hex]),
            ("DELETE FROM payments_receipt WHERE id=%s", [item.pk.hex]),
        ]:
            with self.assertRaises(DatabaseError), transaction.atomic(), connection.cursor() as cursor:
                cursor.execute(query, args)
        self.assertEqual(queries.confirmed(order), Decimal("5.00"))

    def test_native_root_covers_all_models_but_cannot_self_review(self):
        from apps.accounts.admin import owner_site
        from django.apps import apps

        for model in apps.get_app_config("payments").get_models():
            self.assertIn(model, owner_site._registry)
        order = self.accept("cod")
        self.command(order, "receipt", **self.facts())
        case = ReviewCase.objects.get(kind="receipt")
        with self.assertRaises(PermissionDenied):
            pay.access.independent(order, self.seller.user)
        self.assign_decide(case)
        self.assertEqual(ReviewCase.objects.get(pk=case.pk).state, "approved")
        from apps.accounts.models import Account
        from apps.organizations.models import Membership

        root_seller = Account.objects.create(user=self.root.user, context="seller")
        Membership.objects.create(company=self.profile, account=root_seller, active=False, bundles=["payments_refunds"])
        receipt = self.command(order, "receipt", **self.facts("2.00"))["outcome"]["receipt"]
        conflicted = ReviewCase.objects.get(kind="receipt", receipt_id=receipt)
        with self.assertRaises(PermissionDenied):
            self.decide(conflicted, "assign", assigned_to=self.root.user.pk)

    def test_pending_correction_unique_and_stale_version_denied(self):
        order = self.accept("cod")
        receipt = self.command(order, "receipt", **self.facts())["outcome"]["receipt"]
        self.command(
            order,
            "correction",
            receipt=receipt,
            receipt_version=1,
            reason="First proposed correction",
            **self.facts("4.00"),
        )
        with self.assertRaises(Conflict):
            self.command(
                order,
                "correction",
                receipt=receipt,
                receipt_version=1,
                reason="Second pending correction",
                **self.facts("3.00"),
            )
        self.assign_decide(ReviewCase.objects.get(kind="correction"))
        with self.assertRaises(Conflict):
            self.command(
                order,
                "correction",
                receipt=receipt,
                receipt_version=1,
                reason="Stale original version",
                **self.facts("3.00"),
            )
        self.assertEqual(queries.confirmed(order), Decimal("4.00"))

    def test_changed_packet_same_key_denied_and_currency_fixed(self):
        order = self.accept("cod")
        packet = {"command_id": uuid.uuid4(), "version": 0, **self.facts()}
        pay.mutate(self.seller, order.pk, "receipt", packet)
        with self.assertRaises(Conflict):
            pay.mutate(self.seller, order.pk, "receipt", {**packet, "amount": "6.00"})
        with self.assertRaises(ValidationError):
            self.command(order, "receipt", **{**self.facts(), "currency": "USD"})
        self.assertEqual(Receipt.objects.count(), 1)

    def test_complete_selection_required_and_plan_history_immutable(self):
        order = self.accept()
        for lines in [
            [{"variant": str(self.variant.pk), "batch": None, "quantity": "0.500"}],
            [{"variant": str(self.variant.pk), "batch": None, "quantity": "1.000"}] * 2,
        ]:
            with self.assertRaises(ValidationError):
                self.command(order, "plan", intent_version=0, reason="Invalid incomplete stock", lines=lines)
        self.plan(order)
        plan = StockPlan.objects.get()
        with self.assertRaises(DatabaseError), transaction.atomic(), connection.cursor() as cursor:
            cursor.execute("UPDATE payments_stockplan SET reason='altered' WHERE id=%s", [plan.pk.hex])

    def test_approved_zero_without_hold_blocks_pending_until_positive_receipt(self):
        order = self.accept()
        receipt = self.command(order, "receipt", **self.facts())["outcome"]["receipt"]
        self.command(
            order,
            "correction",
            receipt=receipt,
            receipt_version=1,
            reason="Void incorrect money facts",
            **self.facts("0.00"),
        )
        self.assign_decide(ReviewCase.objects.get(kind="correction"))
        self.plan(order)
        allocation.execute(order.pk)
        self.assertEqual(AllocationIntent.objects.get().state, "blocked_zero")
        self.assertFalse(Allocation.objects.exists())
        self.command(order, "receipt", **self.facts("2.00"))
        self.assertEqual(Allocation.objects.count(), 1)

    def test_staff_fresh_group_and_assignment_scope(self):
        from django.contrib.auth.models import Permission

        self.group.permissions.add(
            *Permission.objects.filter(content_type__app_label="payments", codename="review_payment")
        )
        order = self.accept("cod")
        self.command(order, "receipt", **self.facts())
        case = ReviewCase.objects.get(kind="receipt")
        self.assertFalse(pay.access.scope(self.staff).exists())
        self.assertNotIn(self.staff.user.pk, [user.pk for user in pay.reviewers(case)])
        with self.assertRaises(PermissionDenied):
            self.decide(case, "assign", assigned_to=self.staff.user.pk)
        self.group.permissions.add(*Permission.objects.filter(content_type__app_label="payments"))
        self.assertFalse(pay.access.scope(self.staff).exists())
        self.decide(case, "assign", assigned_to=self.staff.user.pk)
        self.assertEqual(queries.detail(self.staff, order.pk)["confirmed_total"], "5.00")
        result = pay.decide(
            self.staff,
            case.pk,
            {
                "command_id": uuid.uuid4(),
                "version": Finance.objects.get(order=order).version,
                "case_version": 2,
                "action": "approve",
                "reason": "Assigned independent staff review",
            },
        )
        self.assertEqual(result["state"], "approved")
        self.group.permissions.clear()
        self.assertFalse(pay.access.scope(self.staff).exists())

    def test_historical_membership_prevents_independent_assignment(self):
        from apps.organizations.models import Membership

        from django.contrib.auth.models import Permission

        self.group.permissions.add(*Permission.objects.filter(content_type__app_label="payments"))
        # A former company member is conflicted even after revocation.
        company = self.profile
        Membership.objects.create(
            company=company, account=self.staff.account, active=False, bundles=["payments_refunds"]
        )
        order = self.accept("cod")
        self.command(order, "receipt", **self.facts())
        case = ReviewCase.objects.get(kind="receipt")
        with self.assertRaises(PermissionDenied):
            self.decide(case, "assign", assigned_to=self.staff.user.pk)

    def test_private_evidence_staging_binding_head_and_wrong_account(self):
        from apps.payments import media
        from apps.payments.models import EvidenceBinding
        from tests.test_catalogue import image_file

        order = self.accept("cod")
        key = uuid.uuid4()
        image = media.upload(self.buyer, order.pk, key, image_file())
        self.assertEqual(media.upload(self.buyer, order.pk, key, image_file())["id"], image["id"])
        response = self.buyer_client.head(f"/api/v1/payments/buyer/evidence/{image['id']}/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("no-store", response["Cache-Control"])
        self.assertEqual(self.other_client.get(f"/api/v1/payments/buyer/evidence/{image['id']}/").status_code, 404)
        self.command(order, "claim", self.buyer, evidence=[image["id"]], **self.facts())
        self.assertEqual(EvidenceBinding.objects.count(), 1)
        self.assertEqual(self.seller_client.get(f"/api/v1/payments/seller/evidence/{image['id']}/").status_code, 200)

    def test_invalid_evidence_formats_rejected(self):
        from apps.payments import media
        from django.core.files.uploadedfile import SimpleUploadedFile

        order = self.accept("cod")
        for name, body, mime in [
            ("bad.pdf", b"%PDF-1.7", "application/pdf"),
            ("bad.jpg", b"not an image", "image/jpeg"),
        ]:
            with self.assertRaises(ValidationError):
                media.upload(self.buyer, order.pk, uuid.uuid4(), SimpleUploadedFile(name, body, content_type=mime))

    def test_overdue_generation_dedup_extension_stales_queued_email(self):
        from apps.payments import jobs, delivery
        from apps.payments.models import Reminder, NoticeCursor, Email
        from unittest.mock import patch

        old = timezone.now() - timedelta(days=5)
        with patch("django.utils.timezone.now", return_value=old):
            order = self.accept()
        self.assertTrue(queries.projection(order)["overdue"])
        jobs.check_order(order.pk)
        jobs.check_order(order.pk)
        self.assertEqual(Reminder.objects.count(), 1)
        for cursor in NoticeCursor.objects.filter(complete=False):
            jobs.fanout(cursor.pk)
        self.assertEqual(Email.objects.count(), 2)
        self.command(
            order,
            "extension",
            deadline_generation=1,
            due_at=timezone.now() + timedelta(days=2),
            reason="New explicit later deadline",
        )
        for email in Email.objects.all():
            delivery.dispatch(email.pk)
        self.assertFalse(Email.objects.exclude(status="cancelled").exists())
        jobs.check_order(order.pk)
        self.assertFalse(ReviewCase.objects.filter(kind="overdue", overdue_active=True).exists())

    def test_generic_mail_contains_no_financial_reference_or_evidence(self):
        from apps.payments.delivery import rendered

        order = self.accept()
        text = " ".join(rendered(self.buyer.account, order, "en"))
        for forbidden in ["12.50", "Synthetic actual cash receipt", "payments/evidence", str(order.buyer.user.email)]:
            self.assertNotIn(forbidden, text)

    def test_receipt_read_survives_product_unpublication_without_public_gate(self):
        order = self.accept("cod")

        from apps.catalogue import services as catalogue

        self.product.refresh_from_db()
        catalogue.transition(
            self.reviewer,
            self.product.pk,
            {
                "action": "unpublish",
                "version": self.product.version,
                "revision": self.product.published_id,
                "reason": "Synthetic withdrawal from public discovery",
            },
        )
        self.product.refresh_from_db()
        self.assertIsNone(self.product.published_id)
        self.command(order, "receipt", **self.facts())
        self.assertEqual(queries.detail(self.seller, order.pk)["confirmed_total"], "5.00")

    def test_guard_readiness_is_current_and_get_has_no_side_effects(self):
        from apps.runtime.mariadb.schema import ready, verify

        self.assertTrue(ready())
        verify(record=False)
        order = self.accept()
        before = (Finance.objects.count(), ReviewCase.objects.count(), Event.objects.count(), Command.objects.count())
        for _ in range(2):
            self.assertEqual(self.buyer_client.get(f"/api/v1/payments/buyer/orders/{order.pk}/").status_code, 200)
        self.assertEqual(
            (Finance.objects.count(), ReviewCase.objects.count(), Event.objects.count(), Command.objects.count()),
            before,
        )

    def batch_shortage(self):
        from apps.inventory import services as stock
        from apps.inventory.models import Position, Batch

        def move(quantity, **extra):
            return stock.manual(
                self.seller,
                self.profile.pk,
                self.variant.pk,
                {
                    "token": uuid.uuid4(),
                    "version": Position.objects.get(pk=self.variant.pk).version,
                    "reason": "Synthetic exact batch stock",
                    "quantity": quantity,
                    **extra,
                },
                adjustment=quantity.startswith("-"),
            )

        import copy
        from apps.catalogue.models import Product, Variant
        from apps.catalogue import services as catalogue
        from apps.catalogue.media import upload
        from tests.test_catalogue import image_file

        created = catalogue.create(self.seller, {"seller": self.profile.pk, "currency": "AFN", "pricing_mode": "fixed"})
        product = Product.objects.get(pk=created["id"])
        image = upload(self.seller, product.pk, product.version, image_file())
        product.refresh_from_db()
        body = copy.deepcopy(self.body)
        body["variants"][0]["sku"] = "P12-BATCH"
        body["images"] = [{"id": image["id"], "alt": "Synthetic exact batch goods", "variant": None}]
        saved = catalogue.save(self.seller, product.pk, {"version": product.version, "body": body})
        for principal, action in [(self.seller, "submit"), (self.reviewer, "publish")]:
            product.refresh_from_db()
            catalogue.transition(
                principal,
                product.pk,
                {
                    "version": product.version,
                    "revision": saved["revision"],
                    "action": action,
                    "reason": "Synthetic reviewed batch goods",
                },
            )
        self.variant = Variant.objects.get(product=product)
        stock.configure(
            self.seller,
            self.profile.pk,
            self.variant.pk,
            {
                "token": uuid.uuid4(),
                "version": 0,
                "reason": "Synthetic reviewed batch tracking",
                "tracking": "batch",
                "expiry_required": False,
                "threshold": None,
            },
        )
        move("1.000", batch_code="P12-A")
        move("1.000", batch_code="P12-B")
        a = Batch.objects.get(code="P12-A")
        b = Batch.objects.get(code="P12-B")
        order = self.accept()
        self.command(
            order,
            "plan",
            intent_version=0,
            reason="First accepted whole-order batch",
            lines=[{"variant": str(self.variant.pk), "batch": str(a.pk), "quantity": "1.000"}],
        )
        move("-1.000", batch=str(a.pk))
        result = self.command(order, "receipt", **self.facts())
        self.assertEqual(result["current"]["allocation"], "shortage")
        return order, a, b, move

    def replacement_plan(self, order, batch):
        intent = AllocationIntent.objects.get(order=order)
        result = self.command(
            order,
            "plan",
            intent_version=intent.version,
            replaces=str(intent.attempts.get().shortage_id),
            reason="Different batch for same whole goods",
            lines=[{"variant": str(self.variant.pk), "batch": str(batch.pk), "quantity": "1.000"}],
        )
        return ReviewCase.objects.get(pk=result["outcome"]["case"])

    def test_changed_shortage_batch_requires_independent_whole_order_approval(self):
        order, _, batch, _ = self.batch_shortage()
        case = self.replacement_plan(order, batch)
        self.assertFalse(Allocation.objects.exists())
        self.assign_decide(case)
        intent = AllocationIntent.objects.get(order=order)
        self.assertEqual(intent.state, "reserved")
        self.assertEqual(intent.attempts.count(), 2)
        self.assertEqual(Bucket.objects.get(batch=batch).held, 1)
        self.assertEqual(queries.confirmed(order), Decimal("5.00"))

    def stale_replacement_rejection(self, *, replenish):
        order, original_batch, replacement_batch, move = self.batch_shortage()
        first = self.replacement_plan(order, replacement_batch)
        second = self.replacement_plan(order, replacement_batch)
        if replenish:
            move("1.000", batch=str(original_batch.pk))
            self.assign_decide(ReviewCase.objects.get(order=order, kind="shortage"), "replenish")
        else:
            self.assign_decide(first)
        intent = AllocationIntent.objects.get(order=order)
        self.assertEqual(intent.state, "reserved")
        before = (intent.allocation_id, intent.version, intent.attempts.count())
        self.decide(second, "assign", assigned_to=self.root.user.pk)
        with self.assertRaises(Conflict):
            self.decide(second, "approve")
        second.refresh_from_db()
        self.assertEqual(second.state, "open")
        self.decide(second, "reject")
        second.refresh_from_db()
        self.assertEqual(second.state, "rejected")
        self.assertEqual(second.events.filter(action="reject").count(), 1)
        if replenish:
            self.assign_decide(first, "reject")
        intent.refresh_from_db()
        self.assertEqual((intent.allocation_id, intent.version, intent.attempts.count()), before)
        self.assertEqual(Allocation.objects.count(), 1)
        self.assertEqual(queries.confirmed(order), Decimal("5.00"))
        self.assertEqual(Receipt.objects.count(), 1)

    def test_superseded_replacement_rejection_after_competing_approval(self):
        self.stale_replacement_rejection(replenish=False)

    def test_superseded_replacement_rejection_after_replenishment(self):
        self.stale_replacement_rejection(replenish=True)

    def test_cod_zero_correction_opens_retained_review_and_can_flag_later_zero_again(self):
        order = self.accept("cod")
        for amount in ["2.00", "3.00"]:
            receipt = self.command(order, "receipt", **self.facts(amount))["outcome"]["receipt"]
            self.command(
                order,
                "correction",
                receipt=receipt,
                receipt_version=1,
                reason="Correct actual receipt to zero",
                **self.facts("0.00"),
            )
            self.assign_decide(ReviewCase.objects.get(kind="correction", state="open"))
            case = ReviewCase.objects.get(kind="zero_balance", state="open")
            self.assign_decide(case, "resolve")
        self.assertEqual(ReviewCase.objects.filter(kind="zero_balance").count(), 2)
        self.assertFalse(AllocationIntent.objects.exists())
        self.assertEqual(queries.confirmed(order), 0)

    def test_exact_aggregate_overflow_rejected_without_partial_financial_write(self):
        order = self.accept("cod")
        self.command(order, "receipt", **self.facts("9999999999999999999999.99"))
        with self.assertRaises(ValidationError):
            self.command(order, "receipt", **self.facts("0.01"))
        self.assertEqual(Receipt.objects.count(), 1)
        self.assertEqual(queries.confirmed(order), Decimal("9999999999999999999999.99"))

    def test_email_revocation_and_ambiguous_delivery_not_blindly_retried(self):
        from apps.payments import jobs, delivery
        from apps.payments.models import NoticeCursor, Email

        old = timezone.now() - timedelta(days=5)
        with patch("django.utils.timezone.now", return_value=old):
            order = self.accept()
        jobs.check_order(order.pk)
        for cursor in NoticeCursor.objects.filter(complete=False):
            jobs.fanout(cursor.pk)
        row = Email.objects.get(account=self.buyer.account)
        # A network exception may follow remote acceptance; never resend it.
        with patch(
            "django.core.mail.message.EmailMultiAlternatives.send", side_effect=OSError("Synthetic ambiguous send")
        ):
            self.assertEqual(delivery.dispatch(row.pk), "delivery_unknown")
        with patch("django.core.mail.message.EmailMultiAlternatives.send") as send:
            self.assertEqual(delivery.dispatch(row.pk), "delivery_unknown")
            send.assert_not_called()
        row = Email.objects.get(account=self.seller.account)
        from apps.notifications import services as notices

        notices.set_preference(
            self.seller, {"message_email": True, "payment_email": False, "locale": "en", "version": 0}
        )
        self.assertEqual(delivery.dispatch(row.pk), "cancelled")

    def test_native_review_pins_exact_receipt_outside_history_page(self):
        order = self.accept("cod")
        original = self.command(
            order,
            "receipt",
            **{**self.facts("0.01"), "description": "Original retained cash fact outside history page"},
        )["outcome"]["receipt"]
        for _ in range(20):
            self.command(order, "receipt", **self.facts("0.01"))
        self.assertNotIn(original, [x["id"] for x in queries.detail(self.root, order.pk)["receipts"]])
        case = ReviewCase.objects.get(kind="receipt", receipt_id=original)
        response = self.root_client.get(f"/admin/payments/reviewcase/{case.pk}/review/")
        self.assertContains(response, 'aria-label="Exact recorded receipt"')
        self.assertContains(response, original)
        self.assertContains(response, "Original retained cash fact outside history page")

    def test_overdue_cadence_has_no_catchup_storm_and_zero_disables_repeats(self):
        from apps.payments import jobs
        from apps.payments.models import Reminder
        from apps.orders.models import OrderPolicy

        from contextlib import contextmanager

        @contextmanager
        def at(instant):
            # Keep service and native UTC_TIMESTAMP guard clocks coherent in
            # this disposable connection; never weaken the current-slot guard.
            with patch("django.utils.timezone.now", return_value=instant):
                if connection.vendor == "mysql":
                    with connection.cursor() as cursor:
                        cursor.execute("SET timestamp=%s", [int(instant.timestamp())])
                try:
                    yield
                finally:
                    if connection.vendor == "mysql":
                        with connection.cursor() as cursor:
                            cursor.execute("SET timestamp=0")

        old = timezone.now() - timedelta(days=5, hours=1)
        with patch("django.utils.timezone.now", return_value=old):
            order = self.accept()
        now = timezone.now()
        with at(now):
            jobs.check_order(order.pk)
        self.assertEqual(list(Reminder.objects.values_list("slot", flat=True)), [2])
        later = now + timedelta(days=2)
        with at(later):
            jobs.check_order(order.pk)
        self.assertEqual(set(Reminder.objects.values_list("slot", flat=True)), {2, 4})
        policy = OrderPolicy.objects.get(pk=1)
        orders.set_policy(
            self.root, policy.version, policy.advance_hours, "Disable repeat reminder cadence", reminder_hours=0
        )
        with at(later + timedelta(days=30)):
            jobs.check_order(order.pk)
        with at(later + timedelta(days=60)):
            jobs.check_order(order.pk)
        self.assertEqual(set(Reminder.objects.values_list("slot", flat=True)), {0, 2, 4})


@override_settings(OWNER_MFA_REQUIRED=False)
class PaymentRaces(CommerceFixture, TransactionTestCase):
    def accept(self):
        self.add()
        orders.submit(self.buyer, self.packet())
        return SellerOrder.objects.get()

    def race(self, calls):
        barrier = Barrier(len(calls))

        def run(call):
            connections.close_all()
            try:
                barrier.wait(timeout=15)
                try:
                    return ("ok", call())
                except Conflict:
                    return ("conflict", None)
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=len(calls)) as pool:
            return list(pool.map(run, calls))

    def test_same_receipt_command_concurrent_replay_one_fact(self):
        order = self.accept()
        packet = {
            "command_id": uuid.uuid4(),
            "version": 0,
            "amount": "1.00",
            "currency": "AFN",
            "paid_at": timezone.now() - timedelta(minutes=1),
            "description": "Concurrent actual receipt",
        }
        result = self.race([lambda: pay.mutate(self.seller, order.pk, "receipt", packet)] * 2)
        self.assertEqual([x[0] for x in result], ["ok", "ok"])
        self.assertEqual(Receipt.objects.count(), 1)
        self.assertEqual(AllocationIntent.objects.count(), 1)
        self.assertEqual(result[0][1]["outcome"], result[1][1]["outcome"])

    def test_confirm_withdraw_race_one_winner(self):
        order = self.accept()
        claim = pay.mutate(
            self.buyer,
            order.pk,
            "claim",
            {
                "command_id": uuid.uuid4(),
                "version": 0,
                "amount": "1.00",
                "currency": "AFN",
                "paid_at": timezone.now() - timedelta(minutes=1),
                "description": "Concurrent claim",
            },
        )["outcome"]["claim"]
        common = {"version": 1, "claim": claim, "claim_version": 1, "reason": "Concurrent independent action"}
        result = self.race(
            [
                lambda: pay.mutate(self.seller, order.pk, "confirm", {**common, "command_id": uuid.uuid4()}),
                lambda: pay.mutate(self.buyer, order.pk, "withdraw", {**common, "command_id": uuid.uuid4()}),
            ]
        )
        self.assertEqual(sorted(x[0] for x in result), ["conflict", "ok"])
        self.assertEqual(ClaimDecision.objects.count(), 1)
        self.assertLessEqual(Receipt.objects.count(), 1)

    def test_two_distinct_claim_confirmations_reconcile_one_whole_hold(self):
        order = self.accept()
        pay.mutate(
            self.seller,
            order.pk,
            "plan",
            {
                "command_id": uuid.uuid4(),
                "version": 0,
                "intent_version": 0,
                "reason": "Complete accepted plain-stock selection",
                "lines": [{"variant": str(self.variant.pk), "batch": None, "quantity": "1.000"}],
            },
        )
        claims = []
        for amount in ["1.00", "2.00"]:
            claims.append(
                pay.mutate(
                    self.buyer,
                    order.pk,
                    "claim",
                    {
                        "command_id": uuid.uuid4(),
                        "version": Finance.objects.get(order=order).version,
                        "amount": amount,
                        "currency": "AFN",
                        "paid_at": timezone.now() - timedelta(minutes=1),
                        "description": "Distinct actual buyer claim",
                    },
                )["outcome"]["claim"]
            )
        version = Finance.objects.get(order=order).version
        packets = [
            {
                "command_id": uuid.uuid4(),
                "version": version,
                "claim": claim,
                "claim_version": 1,
                "reason": "Exact concurrent confirmation",
            }
            for claim in claims
        ]
        result = self.race(
            [lambda packet=packet: pay.mutate(self.seller, order.pk, "confirm", packet) for packet in packets]
        )
        self.assertEqual(sorted(x[0] for x in result), ["conflict", "ok"])
        loser = next(packet for packet, outcome in zip(packets, result, strict=True) if outcome[0] == "conflict")
        pay.mutate(
            self.seller,
            order.pk,
            "confirm",
            {**loser, "command_id": uuid.uuid4(), "version": Finance.objects.get(order=order).version},
        )
        allocation.execute(order.pk)
        self.assertEqual(Receipt.objects.count(), 2)
        self.assertEqual(queries.confirmed(order), Decimal("3.00"))
        self.assertEqual(AllocationIntent.objects.count(), 1)
        self.assertEqual(Allocation.objects.count(), 1)
        self.assertEqual(Bucket.objects.get().held, Decimal("1.000"))

    def test_competing_paid_orders_keep_both_receipts_and_only_one_available_hold(self):
        from apps.inventory import services as stock
        from apps.inventory.models import Position, Shortage

        stock.manual(
            self.seller,
            self.profile.pk,
            self.variant.pk,
            {
                "token": str(uuid.uuid4()),
                "reason": "Leave one synthetic available unit",
                "version": Position.objects.get(pk=self.variant.pk).version,
                "quantity": "-99.000",
            },
            adjustment=True,
        )
        first = self.accept()
        self.add()
        orders.submit(self.buyer, self.packet())
        second = SellerOrder.objects.exclude(pk=first.pk).get()
        for order in [first, second]:
            pay.mutate(
                self.seller,
                order.pk,
                "plan",
                {
                    "command_id": uuid.uuid4(),
                    "version": 0,
                    "intent_version": 0,
                    "reason": "Complete competing accepted selection",
                    "lines": [{"variant": str(self.variant.pk), "batch": None, "quantity": "1.000"}],
                },
            )

        def receipt(order):
            return pay.mutate(
                self.seller,
                order.pk,
                "receipt",
                {
                    "command_id": uuid.uuid4(),
                    "version": 1,
                    "amount": "1.00",
                    "currency": "AFN",
                    "paid_at": timezone.now() - timedelta(minutes=1),
                    "description": "Competing actual receipt",
                },
            )

        result = self.race([lambda: receipt(first), lambda: receipt(second)])
        self.assertEqual([x[0] for x in result], ["ok", "ok"])
        for order in [first, second]:
            allocation.execute(order.pk)
            self.assertEqual(queries.confirmed(order), Decimal("1.00"))
        self.assertEqual(Receipt.objects.count(), 2)
        self.assertEqual(Allocation.objects.count(), 1)
        self.assertEqual(Shortage.objects.count(), 1)
        self.assertEqual(set(AllocationIntent.objects.values_list("state", flat=True)), {"reserved", "shortage"})
        self.assertEqual(Bucket.objects.get().held, Decimal("1.000"))
