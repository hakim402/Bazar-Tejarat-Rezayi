"""Phase 14 aftercare: cancellations, accepted amendments, refunds and their guards.

Every test drives the real services, native grants and MariaDB guards; nothing
here mocks a financial or stock effect.
"""

import io
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta, timezone as datetime_timezone
from decimal import Decimal
from threading import Barrier
from unittest.mock import patch

from django.contrib.auth.models import Group, Permission
from django.core import mail
from django.core.management import call_command
from django.db import DatabaseError, connection, connections, transaction
from django.http import Http404
from django.test import TestCase, TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.fulfilment import models as delivery
from apps.fulfilment import queries as delivery_queries
from apps.inventory.models import Allocation, AllocationLine, AllocationReduction, Bucket, Movement, Operation, StockTransition
from apps.notifications.models import (
    AftercareEmail,
    AftercareEmailAttempt,
    AftercareNoticeCursor,
    Event,
    Notice,
)
from apps.orders import aftercare as projection
from apps.orders import aftercare_queries, amendments, cancellations
from apps.orders import services as orders
from apps.orders.models import (
    Aftercare,
    AftercareCommand,
    AftercareEvent,
    Amendment,
    AmendmentDecision,
    AmendmentLine,
    CancellationDecision,
    CancellationRequest,
    Invoice,
    InvoiceAdjustment,
    OrderLine,
    SellerOrder,
)
from apps.accounts.models import AuditEvent, User
from apps.organizations.access import Conflict
from apps.payments import allocation, queries as pay, refunds
from apps.runtime.models import Job
from apps.payments import services as pay_services
from apps.payments.models import (
    AllocationIntent,
    Event as PaymentEvent,
    ReviewCase as PaymentReviewCase,
    Finance,
    Receipt,
    RefundDecision,
    RefundDue,
    RefundReport,
    RefundSeal,
)
from tests.test_fulfilment import FulfilmentBatchTests, FulfilmentFixture

ZERO = Decimal("0.00")


class AftercareFixture(FulfilmentFixture):
    """Shared sealed-packet helpers for the four aftercare command families."""

    def native_group(self, role):
        call_command("setup_aftercare_groups", stdout=io.StringIO())
        return Group.objects.get(name="Rezayi: " + role)

    def domain_state(self):
        """Snapshot actual business rows; auth throttling/audit are not domain effects."""
        models = (
            Aftercare, AftercareCommand, AftercareEvent, CancellationRequest, CancellationDecision,
            Amendment, AmendmentLine, AmendmentDecision, InvoiceAdjustment, Finance, PaymentEvent,
            RefundDue, RefundSeal, RefundReport, RefundDecision, delivery.State, delivery.Event,
            delivery.ReviewCase, delivery.Blocker, delivery.BlockerClosure, delivery.Shipment,
            delivery.Delivery, delivery.Completion, Event, Notice, AftercareNoticeCursor, AftercareEmail, Job,
        )
        return {model._meta.label: list(model.objects.order_by("pk").values()) for model in models}

    def head(self, order):
        return Aftercare.objects.filter(order=order).values_list("version", flat=True).first() or 0

    def finance(self, order):
        return Finance.objects.filter(order=order).values_list("version", flat=True).first() or 0

    def receipt(self, order, amount="12.50", actor=None):
        return pay_services.mutate(
            actor or self.seller,
            order.pk,
            "receipt",
            {
                "command_id": uuid.uuid4(),
                "version": self.finance(order),
                "amount": amount,
                "currency": "AFN",
                "paid_at": timezone.now() - timedelta(minutes=1),
                "description": "Synthetic actual goods receipt",
            },
        )

    def plan(self, order, quantity="1.000"):
        return pay_services.mutate(
            self.seller,
            order.pk,
            "plan",
            {
                "command_id": uuid.uuid4(),
                "version": self.finance(order),
                "intent_version": AllocationIntent.objects.filter(order=order).values_list("version", flat=True).first()
                or 0,
                "reason": "Whole accepted goods selection",
                "lines": [{"variant": str(self.variant.pk), "batch": None, "quantity": quantity}],
            },
        )

    def reserved(self, order, amount="12.50"):
        """Reserve an advance order through the real sealed plan, receipt and stock transaction."""
        self.plan(order)
        self.receipt(order, amount)
        allocation.execute(order.pk)
        return order

    def cancel(self, order, actor=None, reason="Synthetic cancellation request", version=None, key=None):
        key = key or uuid.uuid4()
        return cancellations.mutate(
            actor or self.buyer,
            order.pk,
            "request",
            {
                "command_id": key,
                "version": self.head(order) if version is None else version,
                "reason": reason,
            },
        )

    def withdraw(self, order, row, actor=None, reason="Synthetic cancellation withdrawal", key=None):
        return cancellations.mutate(
            actor or self.buyer,
            order.pk,
            "withdraw",
            {
                "command_id": key or uuid.uuid4(),
                "version": self.head(order),
                "request": str(row.pk) if hasattr(row, "pk") else str(row),
                "reason": reason,
            },
        )

    def decide(self, row, action, actor=None, reason="Independent synthetic cancellation decision", **extra):
        row.refresh_from_db()
        return cancellations.decide(
            actor or self.root,
            row.pk,
            {
                "command_id": uuid.uuid4(),
                "version": self.head(row.order),
                "request_version": row.version,
                "action": action,
                "reason": reason,
                **extra,
            },
        )

    def assign(self, row, actor=None, **extra):
        extra.setdefault("assigned_to", (actor or self.root).user.pk)
        return self.decide(row, "assign", actor=actor, reason="Assigned synthetic review", **extra)

    def approve(self, row, actor=None, reason="Independent synthetic cancellation approval"):
        self.assign(row, actor=actor)
        return self.decide(row, "approve", actor=actor, reason=reason)

    def reject(self, row, actor=None, reason="Independent synthetic cancellation rejection"):
        self.assign(row, actor=actor)
        return self.decide(row, "reject", actor=actor, reason=reason)

    def propose(self, order, rows, actor=None, reason="Synthetic accepted-price amendment", version=None):
        """rows is a list of (line, quantity[, unit_price])."""
        return amendments.mutate(
            actor or self.seller,
            order.pk,
            "propose",
            {
                "command_id": uuid.uuid4(),
                "version": self.head(order) if version is None else version,
                "lines": [
                    {
                        "line": str(item[0].pk),
                        "quantity": item[1],
                        "unit_price": item[2] if len(item) > 2 else format(item[0].unit_price, ".2f"),
                    }
                    for item in rows
                ],
                "reason": reason,
            },
        )

    def amend(self, row, action, actor=None, reason="Independent synthetic amendment decision", **extra):
        row.refresh_from_db()
        return amendments.decide(
            actor or self.root,
            row.pk,
            {
                "command_id": uuid.uuid4(),
                "version": self.head(row.order),
                "amendment_version": row.version,
                "action": action,
                "reason": reason,
                **extra,
            },
        )

    def approve_amendment(self, row, actor=None):
        self.amend(row, "assign", actor=actor, assigned_to=(actor or self.root).user.pk, reason="Assigned synthetic review")
        return self.amend(row, "approve", actor=actor)

    def reject_amendment(self, row, actor=None):
        self.amend(row, "assign", actor=actor, assigned_to=(actor or self.root).user.pk, reason="Assigned synthetic review")
        return self.amend(row, "reject", actor=actor)

    def due(self, order, amount="5.00", actor=None, reason="Synthetic excess refund obligation"):
        return refunds.mutate(
            actor or self.seller,
            order.pk,
            "due",
            {
                "command_id": uuid.uuid4(),
                "version": self.finance(order),
                "amount": amount,
                "reason": reason,
            },
        )

    def report(self, order, row, actor=None, amount=None, reference="SYNTHETIC-REFUND-1", **extra):
        due = row if isinstance(row, RefundDue) else RefundDue.objects.get(pk=row)
        return refunds.mutate(
            actor or self.seller,
            order.pk,
            "report",
            {
                "command_id": uuid.uuid4(),
                "version": self.finance(order),
                "due": str(due.pk),
                "amount": amount if amount is not None else format(due.amount, ".2f"),
                "sent_at": timezone.now() - timedelta(minutes=2),
                "reference": reference,
                "description": "Synthetic private refund proof",
                **extra,
            },
        )

    def refund(self, row, action, actor=None, reason="Independent synthetic refund decision", **extra):
        row.refresh_from_db()
        return refunds.decide(
            actor or self.root,
            row.pk,
            {
                "command_id": uuid.uuid4(),
                "version": self.finance(row.order),
                "due_version": row.version,
                "action": action,
                "reason": reason,
                **extra,
            },
        )

    def confirm_refund(self, row, actor=None):
        self.refund(row, "assign", actor=actor, assigned_to=(actor or self.root).user.pk, reason="Assigned synthetic review")
        return self.refund(row, "confirm", actor=actor)

    def completed(self, amount="15.00"):
        order = self.accept("cod")
        self.prepare(order)
        self.send(order)
        self.command(order, "deliver", self.buyer, occurred_at=timezone.now(), reason="Actual synthetic whole delivery")
        self.receipt(order, amount)
        self.assertTrue(delivery.Delivery.objects.filter(order=order).exists())
        self.assertTrue(delivery.Completion.objects.filter(order=order).exists())
        return order


@override_settings(OWNER_MFA_REQUIRED=False)
class CancellationRequestTests(AftercareFixture, TestCase):
    def test_buyer_request_seals_event_request_and_operational_hold(self):
        order = self.reserved(self.accept("advance"))
        key = uuid.uuid4()
        outcome = self.cancel(order, key=key)
        row = CancellationRequest.objects.get(pk=outcome["request"])
        self.assertEqual((row.state, row.requester_context, row.version), ("pending", "buyer", 1))
        self.assertEqual(row.requester_account_id, self.buyer.account.pk)
        event = AftercareEvent.objects.get(pk=row.event_id)
        self.assertEqual((event.action, event.version, event.context), ("cancellation_requested", 1, "buyer"))
        self.assertEqual(event.account_id, self.buyer.account.pk)
        blocker = delivery.Blocker.objects.get(order=order, kind="cancellation")
        self.assertEqual(row.blocker_id, blocker.pk)
        self.assertEqual(delivery.ReviewCase.objects.get(order=order, kind="blocker").state, "open")
        self.assertEqual(AftercareCommand.objects.get(pk=key).action, "request")

    def test_seller_request_uses_membership_and_raises_the_same_hold(self):
        order = self.accept("advance")
        outcome = self.cancel(order, actor=self.seller, reason="Synthetic seller cancellation request")
        row = CancellationRequest.objects.get(pk=outcome["request"])
        self.assertEqual((row.requester_context, row.requester_account_id), ("seller", self.seller.account.pk))
        self.assertTrue(delivery.Blocker.objects.filter(order=order, kind="cancellation").exists())

    def test_request_replay_returns_the_same_outcome_and_changed_packet_is_refused(self):
        order = self.accept("advance")
        packet = {"command_id": uuid.uuid4(), "version": 0, "reason": "Synthetic cancellation request"}
        first = cancellations.mutate(self.buyer, order.pk, "request", packet)
        self.assertEqual(cancellations.mutate(self.buyer, order.pk, "request", packet), first)
        self.assertEqual(CancellationRequest.objects.count(), 1)
        with self.assertRaises(Conflict):
            cancellations.mutate(self.buyer, order.pk, "request", {**packet, "reason": "Different reason wording"})
        with self.assertRaises(Conflict):
            cancellations.mutate(self.seller, order.pk, "request", packet)

    def test_request_requires_current_version_and_bounded_reason(self):
        order = self.accept("advance")
        self.cancel(order)
        for reason in ("ab", "x" * 1001, None, 7):
            with self.assertRaises(ValidationError):
                self.cancel(order, version=self.head(order), reason=reason)
        with self.assertRaises(ValidationError):
            self.cancel(order, version=self.head(order) + 1)
        with self.assertRaises(ValidationError):
            self.cancel(order, version="0")

    def test_second_pending_request_is_refused_until_the_first_is_decided(self):
        order = self.accept("advance")
        row = CancellationRequest.objects.get(pk=self.cancel(order)["request"])
        with self.assertRaises(ValidationError) as refused:
            self.cancel(order, version=self.head(order))
        self.assertEqual(refused.exception.detail["cancellation"], ["cancellation_request_pending"])
        self.reject(row)
        self.assertEqual(self.cancel(order, version=self.head(order))["state"], "pending")

    def test_withdraw_retains_the_open_hold_for_independent_closure(self):
        order = self.reserved(self.accept("advance"))
        row = CancellationRequest.objects.get(pk=self.cancel(order)["request"])
        outcome = self.withdraw(order, row)
        row.refresh_from_db()
        self.assertEqual((row.state, row.version, outcome["state"]), ("withdrawn", 2, "withdrawn"))
        self.assertEqual(delivery.ReviewCase.objects.get(order=order, kind="blocker").state, "open")
        self.assertFalse(delivery.BlockerClosure.objects.filter(blocker_id=row.blocker_id).exists())
        self.assertTrue(delivery_queries.active_blockers(order).filter(pk=row.blocker_id).exists())
        self.assertEqual(Allocation.objects.get().state, "held")
        self.assertFalse(CancellationDecision.objects.filter(request=row).exists())
        self.assertEqual(
            list(AftercareEvent.objects.order_by("version").values_list("action", flat=True)),
            ["cancellation_requested", "cancellation_withdrawn"],
        )

    def test_withdraw_is_limited_to_the_requester_and_a_pending_request(self):
        order = self.accept("advance")
        row = CancellationRequest.objects.get(pk=self.cancel(order)["request"])
        with self.assertRaises(Http404):
            self.withdraw(order, row, actor=self.seller)
        self.withdraw(order, row)
        with self.assertRaises(Http404):
            self.withdraw(order, row)

    def test_reconcile_is_scoped_and_returns_the_sealed_result(self):
        order = self.accept("advance")
        key = uuid.uuid4()
        outcome = self.cancel(order, key=key)
        with self.assertRaises(Http404):
            cancellations.reconcile(self.other_buyer, order.pk, key)
        self.assertEqual(
            cancellations.reconcile(self.buyer, order.pk, key), {"state": "applied", "result": outcome}
        )

    def test_absence_fence_rejects_a_never_seen_command_without_inventing_history(self):
        order = self.accept("advance")
        key = uuid.uuid4()
        self.assertEqual(cancellations.reconcile(self.buyer, order.pk, key), {"state": "unknown", "result": None})
        self.assertEqual(cancellations.settle(self.buyer, order.pk, key)["state"], "rejected")
        self.assertEqual(
            cancellations.reconcile(self.buyer, order.pk, key), {"state": "rejected", "result": {"settled": True}}
        )
        self.assertEqual(CancellationRequest.objects.count(), 0)
        self.assertFalse(AftercareEvent.objects.filter(order=order).exists())

    def test_projections_are_scoped_and_report_aftercare_eligibility(self):
        order = self.accept("advance")
        row = CancellationRequest.objects.get(pk=self.cancel(order)["request"])
        self.assertEqual(projection.eligibility(SellerOrder.objects.get(pk=order.pk))["cancel"], False)
        self.assertEqual([x["id"] for x in aftercare_queries.cancellation_page(self.buyer)["results"]], [str(row.pk)])
        self.assertEqual(aftercare_queries.cancellation_page(self.other_buyer)["count"], 0)
        self.assertEqual(aftercare_queries.cancellation_page(self.seller)["count"], 1)
        detail = aftercare_queries.cancellation_detail(self.buyer, row.pk)
        self.assertEqual((detail["state"], detail["order_detail"]["id"]), ("pending", str(order.pk)))
        self.assertEqual(aftercare_queries.aftercare_detail(self.buyer, order.pk)["cancellations"][0]["id"], str(row.pk))
        with self.assertRaises(PermissionDenied):
            aftercare_queries.cancellation_page(self.staff)

    def test_request_leaves_accepted_lines_invoice_and_money_untouched(self):
        order = self.reserved(self.accept("advance"))
        lines = list(OrderLine.objects.filter(order=order).values_list("quantity", "unit_price", "snapshot"))
        invoice = list(Invoice.objects.filter(order=order).values())
        self.cancel(order)
        order = SellerOrder.objects.get(pk=order.pk)
        self.assertEqual(list(OrderLine.objects.filter(order=order).values_list("quantity", "unit_price", "snapshot")), lines)
        self.assertEqual(list(Invoice.objects.filter(order=order).values()), invoice)
        self.assertEqual((order.goods_total, projection.accepted_total(order)), (Decimal("12.50"), Decimal("12.50")))
        self.assertEqual(pay.confirmed(order), Decimal("12.50"))
        self.assertEqual(Allocation.objects.get().state, "held")

    def test_receipt_after_a_pending_request_still_uses_the_goods_authority(self):
        order = self.accept("advance")
        self.plan(order)
        self.cancel(order)
        self.receipt(order, "2.00")
        self.assertEqual(pay.confirmed(SellerOrder.objects.get(pk=order.pk)), Decimal("2.00"))
        self.assertEqual(CancellationRequest.objects.get().state, "pending")


@override_settings(OWNER_MFA_REQUIRED=False)
class CancellationDecisionTests(AftercareFixture, TestCase):
    def pending(self, method="advance", received=True):
        order = self.reserved(self.accept(method)) if method == "advance" else self.accept(method)
        if method == "cod" and received:
            self.receipt(order, "12.50")
        return order, CancellationRequest.objects.get(pk=self.cancel(order)["request"])

    def test_approval_is_terminal_freezes_the_request_and_writes_one_adjustment(self):
        order, row = self.pending("cod", received=False)
        outcome = self.approve(row)
        row.refresh_from_db()
        self.assertEqual((row.state, row.version, outcome["state"]), ("approved", 3, "approved"))
        decision = CancellationDecision.objects.get(request=row)
        self.assertEqual((decision.action, decision.context, decision.actor_id), ("approved", "owner", self.root.user.pk))
        adjustment = InvoiceAdjustment.objects.get(order=order)
        self.assertEqual((adjustment.cause, adjustment.after_total, adjustment.after_lines), ("cancellation", ZERO, []))
        self.assertEqual(format(adjustment.before_total, ".2f"), "12.50")
        self.assertEqual(len(adjustment.before_lines), 1)
        self.assertEqual(adjustment.event_id, decision.event_id)
        self.assertEqual(InvoiceAdjustment.objects.count(), 1)
        self.assertEqual(projection.accepted_total(SellerOrder.objects.get(pk=order.pk)), ZERO)

    def test_approval_releases_the_held_advance_reservation_exactly_once(self):
        order, row = self.pending()
        held = Bucket.objects.get().held
        self.assertEqual(Allocation.objects.get().state, "held")
        self.approve(row)
        self.assertEqual(Allocation.objects.get().state, "released")
        self.assertEqual(Bucket.objects.get().held, ZERO)
        self.assertGreater(held, ZERO)
        self.assertEqual(Operation.objects.filter(action="release").count(), 1)
        self.assertEqual(Movement.objects.filter(operation__action="release").count(), 1)
        movement = Movement.objects.get(operation__action="release")
        witness = StockTransition.objects.get(movement=movement, pending=False)
        bucket = Bucket.objects.get()
        self.assertEqual(
            (movement.physical_delta, movement.held_delta, movement.physical_after, movement.held_after),
            (Decimal("0.000"), -held, bucket.physical, Decimal("0.000")),
        )
        self.assertEqual(
            (witness.before_physical, witness.before_held, witness.after_physical, witness.after_held),
            (bucket.physical, held, bucket.physical, Decimal("0.000")),
        )
        self.assertEqual(AllocationIntent.objects.get(order=order).state, "reserved")

    def test_approval_creates_one_refund_due_bounded_by_confirmed_received_money(self):
        order, row = self.pending()
        outcome = self.approve(row)
        due = RefundDue.objects.get(pk=outcome["refund_due"])
        self.assertEqual((due.cause, format(due.amount, ".2f"), due.currency), ("cancellation", "12.50", "AFN"))
        self.assertEqual(RefundSeal.objects.get(due=due).due_id, due.pk)
        self.assertEqual(RefundDue.objects.count(), 1)
        self.assertEqual(pay.confirmed(SellerOrder.objects.get(pk=order.pk)), Decimal("12.50"))

    def test_approval_without_received_money_creates_no_refund_and_no_release(self):
        order, row = self.pending("cod", received=False)
        outcome = self.approve(row)
        self.assertIsNone(outcome["refund_due"])
        self.assertIsNone(outcome["release"])
        self.assertFalse(RefundDue.objects.exists())
        self.assertFalse(Operation.objects.filter(action="release").exists())

    def test_existing_dues_bound_the_cancellation_refund_and_never_exceed_received(self):
        order = self.accept("cod")
        self.receipt(order, "15.00")
        self.due(order, "2.50")
        row = CancellationRequest.objects.get(pk=self.cancel(order)["request"])
        outcome = self.approve(row)
        self.assertEqual(RefundDue.objects.get(pk=outcome["refund_due"]).amount, Decimal("12.50"))
        self.assertEqual(sum(x.amount for x in RefundDue.objects.filter(order=order)), Decimal("15.00"))
        self.assertEqual(InvoiceAdjustment.objects.get(order=order).after_total, ZERO)

    def test_replay_of_the_same_decision_command_repeats_the_result_without_effects(self):
        order, row = self.pending()
        self.assign(row)
        row.refresh_from_db()
        packet = {
            "command_id": uuid.uuid4(),
            "version": self.head(order),
            "request_version": row.version,
            "action": "approve",
            "reason": "Independent synthetic cancellation approval",
        }
        first = cancellations.decide(self.root, row.pk, packet)
        self.assertEqual(cancellations.decide(self.root, row.pk, packet), first)
        self.assertEqual(CancellationDecision.objects.count(), 1)
        self.assertEqual(InvoiceAdjustment.objects.count(), 1)
        self.assertEqual(RefundDue.objects.count(), 1)
        self.assertEqual(Operation.objects.filter(action="release").count(), 1)
        with self.assertRaises(Conflict):
            cancellations.decide(self.root, row.pk, {**packet, "reason": "A different approval reason"})

    def test_decision_requires_both_the_aftercare_and_request_version(self):
        order, row = self.pending()
        with self.assertRaises(ValidationError):
            cancellations.decide(
                self.root,
                row.pk,
                {"command_id": uuid.uuid4(), "version": 99, "request_version": row.version, "action": "approve", "reason": "Stale head version"},
            )
        row.refresh_from_db()
        with self.assertRaises(ValidationError):
            cancellations.decide(
                self.root,
                row.pk,
                {"command_id": uuid.uuid4(), "version": self.head(order), "request_version": 7, "action": "approve", "reason": "Stale request version"},
            )
        self.assertEqual(CancellationRequest.objects.get(pk=row.pk).state, "pending")

    def test_a_second_decision_on_a_decided_request_is_refused(self):
        order, row = self.pending()
        self.approve(row)
        with self.assertRaises(Conflict):
            self.decide(row, "reject")
        self.assertEqual(CancellationDecision.objects.count(), 1)

    def test_approval_requires_an_independent_assigned_reviewer_first(self):
        order, row = self.pending()
        with self.assertRaises(PermissionDenied):
            self.decide(row, "approve")
        self.assertEqual(row.state, "pending")
        with self.assertRaises(Http404):
            self.decide(row, "approve", actor=self.seller)
        with self.assertRaises(Http404):
            self.decide(row, "approve", actor=self.buyer)

    def test_assignment_is_limited_to_eligible_independent_reviewers(self):
        order, row = self.pending()
        with self.assertRaises(PermissionDenied):
            self.assign(row, assigned_to=self.seller.user.pk)
        with self.assertRaises(PermissionDenied):
            self.assign(row, assigned_to=uuid.uuid4().hex)
        outcome = self.decide(
            row, "assign", assigned_to=self.root.user.pk, reason="Explicit independent reviewer assignment"
        )
        row.refresh_from_db()
        self.assertEqual((outcome["state"], row.assigned_to_id), ("pending", self.root.user.pk))

    def test_assigning_the_request_also_assigns_the_linked_operational_hold(self):
        order, row = self.pending()
        self.assign(row)
        case = delivery.ReviewCase.objects.get(order=order, kind="blocker")
        self.assertEqual(case.assigned_to_id, self.root.user.pk)
        self.assertEqual(delivery.CaseEvent.objects.filter(case=case, action="assign").count(), 1)

    def test_rejection_keeps_stock_money_and_history_and_closes_the_hold(self):
        order, row = self.pending()
        held = Bucket.objects.get().held
        outcome = self.reject(row)
        row.refresh_from_db()
        self.assertEqual((row.state, outcome["state"]), ("rejected", "rejected"))
        self.assertEqual(CancellationDecision.objects.get(request=row).action, "rejected")
        self.assertEqual(Allocation.objects.get().state, "held")
        self.assertEqual(Bucket.objects.get().held, held)
        self.assertFalse(InvoiceAdjustment.objects.exists())
        self.assertFalse(RefundDue.objects.exists())
        self.assertEqual(delivery.ReviewCase.objects.get(order=order, kind="blocker").state, "resolved")
        self.assertEqual(projection.accepted_total(SellerOrder.objects.get(pk=order.pk)), Decimal("12.50"))
        self.assertEqual(self.cancel(order, version=self.head(order))["state"], "pending")

    def test_pending_cancellation_blocks_dispatch_without_changing_stock(self):
        order = self.accept("cod")
        self.prepare(order)
        row = CancellationRequest.objects.get(pk=self.cancel(order)["request"])
        before = self.inventory_state()
        outcome = self.send(order)
        self.assertEqual((outcome["state"], outcome["code"]), ("blocked", "cancellation_hold"))
        self.assertFalse(delivery.Shipment.objects.filter(order=order).exists())
        self.assertFalse(delivery.Completion.objects.filter(order=order).exists())
        self.assertEqual(self.inventory_state(), before)
        self.assertEqual(CancellationRequest.objects.get(pk=row.pk).state, "pending")

    def test_dispatched_orders_refuse_a_new_cancellation_request(self):
        order = self.accept("cod")
        self.prepare(order)
        self.send(order)
        with self.assertRaises(ValidationError) as refused:
            self.cancel(order)
        self.assertEqual(refused.exception.detail["cancellation"], ["cancellation_ineligible_dispatched"])
        self.assertFalse(CancellationRequest.objects.filter(order=order).exists())
        self.assertEqual(delivery.Shipment.objects.filter(order=order).count(), 1)

    def test_completed_orders_cannot_be_cancelled_at_all(self):
        order = self.completed("12.50")
        with self.assertRaises(ValidationError) as refused:
            self.cancel(order)
        self.assertEqual(refused.exception.detail["cancellation"], ["cancellation_ineligible_completed"])
        self.assertFalse(CancellationRequest.objects.filter(order=order).exists())

    def test_cancellation_after_approval_blocks_pending_stock_execution(self):
        order = self.accept("advance")
        self.plan(order)
        self.receipt(order, "12.50")
        intent = AllocationIntent.objects.get(order=order)
        row = CancellationRequest.objects.get(pk=self.cancel(order)["request"])
        self.approve(row)
        self.assertIsNone(allocation.execute(order.pk))
        self.assertEqual(Allocation.objects.get().state, "released")
        self.assertEqual(Operation.objects.filter(action="reserve").count(), 1)
        self.assertEqual(Operation.objects.filter(action="release").count(), 1)
        self.assertEqual(AllocationIntent.objects.get(order=order).pk, intent.pk)

    def test_approval_and_rejection_are_audited_in_the_native_history(self):
        from apps.accounts.models import AuditEvent

        order, row = self.pending("cod", received=False)
        self.approve(row)
        actions = list(
            AuditEvent.objects.filter(resource_id=row.pk, resource_type="orders.cancellationrequest").values_list(
                "action", flat=True
            )
        )
        self.assertIn("cancellation_requested", actions)
        self.assertIn("cancellation_assigned", actions)
        self.assertIn("cancellation_approved", actions)
        self.assertNotIn("cancellation_rejected", actions)

    def test_guards_freeze_events_decisions_and_the_adjustment_history(self):
        order, row = self.pending()
        self.approve(row)
        decision = CancellationDecision.objects.get(request=row)
        statement = "UPDATE orders_cancellationdecision SET reason='altered' WHERE request_id=%s"
        with self.assertRaises(DatabaseError), transaction.atomic(), connection.cursor() as cursor:
            cursor.execute(statement, [decision.pk.hex])
        with self.assertRaises(DatabaseError), transaction.atomic(), connection.cursor() as cursor:
            cursor.execute("UPDATE orders_invoiceadjustment SET after_total='1.00'")
        with self.assertRaises(DatabaseError), transaction.atomic(), connection.cursor() as cursor:
            cursor.execute("UPDATE orders_aftercareevent SET action='rewritten' WHERE version=1")
        with self.assertRaises(DatabaseError), transaction.atomic(), connection.cursor() as cursor:
            cursor.execute("DELETE FROM orders_aftercareevent WHERE action='cancellation_approved'")
        self.assertEqual(CancellationDecision.objects.get(request=row).reason, decision.reason)

    def test_native_guards_refuse_duplicate_pending_requests_and_retained_decisions(self):
        order, row = self.pending("cod", received=False)
        with self.assertRaises(DatabaseError) as refused, transaction.atomic(), connection.cursor() as cursor:
            cursor.execute(
                "INSERT INTO orders_cancellationrequest"
                " (id,state,requester_context,requester_account_id,reason,version,event_id,order_id,created_at)"
                " SELECT %s,state,requester_context,requester_account_id,reason,version,event_id,order_id,created_at"
                " FROM orders_cancellationrequest WHERE id=%s",
                [uuid.uuid4().hex, row.pk.hex],
            )
        self.assertEqual(refused.exception.args[0], 1644)
        self.assertEqual(CancellationRequest.objects.filter(order=order).count(), 1)
        self.approve(row)
        with self.assertRaises(DatabaseError), transaction.atomic(), connection.cursor() as cursor:
            cursor.execute(
                "INSERT INTO orders_cancellationdecision (request_id,context,action,reason,actor_id,account_id,event_id,created_at)"
                " SELECT request_id,context,action,reason,actor_id,account_id,event_id,created_at"
                " FROM orders_cancellationdecision WHERE request_id=%s",
                [row.pk.hex],
            )
        self.assertEqual(CancellationDecision.objects.count(), 1)


@override_settings(OWNER_MFA_REQUIRED=False)
class AmendmentTests(AftercareFixture, TestCase):
    def lines(self, order):
        return list(OrderLine.objects.filter(order=order))

    def test_proposal_seals_the_amendment_lines_and_freezes_acceptance(self):
        order = self.reserved(self.accept("advance"))
        line = self.lines(order)[0]
        outcome = self.propose(order, [(line, "0.500")])
        row = Amendment.objects.get(pk=outcome["amendment"])
        self.assertEqual((row.state, row.version, row.actor_id), ("pending", 1, self.seller.account.pk))
        self.assertEqual(format(row.after_total, ".2f"), "6.25")
        proposed = AmendmentLine.objects.get(amendment=row)
        self.assertEqual(
            (proposed.line_id, format(proposed.proposed_quantity, ".3f"), format(proposed.proposed_unit_price, ".2f")),
            (line.pk, "0.500", "12.50"),
        )
        event = AftercareEvent.objects.get(pk=row.event_id)
        self.assertEqual((event.action, event.context, event.account_id), ("amendment_proposed", "seller", self.seller.account.pk))
        self.assertEqual((line.quantity, line.unit_price), (Decimal("1.000"), Decimal("12.50")))
        self.assertEqual(projection.accepted_total(SellerOrder.objects.get(pk=order.pk)), Decimal("12.50"))

    def test_every_increase_zero_quantity_and_unknown_line_is_refused(self):
        order = self.accept("cod")
        line = self.lines(order)[0]
        cases = [
            ([(line, "1.000")], "amendment", ["amendment_increase_refused"]),
            ([(line, "2.000")], "amendment", ["amendment_increase_refused"]),
            ([(line, "0.500", "13.00")], "amendment", ["amendment_increase_refused"]),
            ([(line, "0.000")], "amendment", ["amendment_zero_quantity"]),
            ([(line, "0.1234")], "amendment", ["amendment_invalid_increment"]),
            ([(line, "0.124")], "amendment", ["amendment_invalid_increment"]),
            ([], "lines", ["length"]),
        ]
        for rows, field, codes in cases:
            with self.assertRaises(ValidationError) as refused:
                self.propose(order, rows)
            self.assertEqual(refused.exception.detail[field], codes)
        for rows, field, code in (
            ([{"line": str(uuid.uuid4()), "quantity": "0.500", "unit_price": "12.50"}], "lines.0.line", "accepted_line_required"),
            ([{"line": str(line.pk), "quantity": "0.500"}], "lines.0.unit_price", "exact_money_string"),
        ):
            with self.subTest(field=field), self.assertRaises(ValidationError) as refused:
                amendments.mutate(
                    self.seller, order.pk, "propose",
                    {"command_id": uuid.uuid4(), "version": self.head(order), "lines": rows, "reason": "Invalid line probe"},
                )
            self.assertEqual(refused.exception.detail[field], [code])
        with self.assertRaises(ValidationError) as refused:
            self.propose(order, [(line, "0.500"), (line, "0.375")])
        self.assertEqual(refused.exception.detail["lines.1.line"], ["duplicate"])
        self.assertFalse(Amendment.objects.exists())

    def test_wholesale_proposals_below_the_current_minimum_are_refused(self):
        from apps.organizations.models import BusinessProfile
        from apps.verification.models import ReviewCase

        profile = BusinessProfile.objects.create(
            account=self.buyer.account, kind="business", display_name="Synthetic business buyer"
        )
        ReviewCase.objects.create(profile=profile, status="approved", snapshot={"display_name": "Reviewed buyer"})
        self.add(tier="wholesale", quantity="2.000")
        orders.submit(self.buyer, self.packet())
        order = SellerOrder.objects.latest("accepted_at")
        line = self.lines(order)[0]
        self.assertEqual(line.tier, "wholesale")
        with self.assertRaises(ValidationError) as refused:
            self.propose(order, [(line, "0.500")])
        self.assertEqual(refused.exception.detail["amendment"], ["amendment_below_wholesale_minimum"])
        self.assertEqual(self.propose(order, [(line, "1.000")])["state"], "pending")

    def test_proposal_replay_is_idempotent_and_a_changed_packet_is_refused(self):
        order = self.accept("cod")
        line = self.lines(order)[0]
        packet = {
            "command_id": uuid.uuid4(),
            "version": 0,
            "lines": [{"line": str(line.pk), "quantity": "0.500", "unit_price": "12.50"}],
            "reason": "Synthetic accepted-price amendment",
        }
        first = amendments.mutate(self.seller, order.pk, "propose", packet)
        self.assertEqual(amendments.mutate(self.seller, order.pk, "propose", packet), first)
        self.assertEqual(Amendment.objects.count(), 1)
        with self.assertRaises(Conflict):
            amendments.mutate(self.seller, order.pk, "propose", {**packet, "reason": "Another proposal reason"})
        with self.assertRaises(PermissionDenied):
            amendments.mutate(self.root, order.pk, "propose", packet)

    def test_only_one_pending_proposal_and_the_current_version_may_exist(self):
        order = self.accept("cod")
        line = self.lines(order)[0]
        row = Amendment.objects.get(pk=self.propose(order, [(line, "0.500")])["amendment"])
        with self.assertRaises(ValidationError) as refused:
            self.propose(order, [(line, "0.400")])
        self.assertEqual(refused.exception.detail["amendment"], ["amendment_proposal_pending"])
        with self.assertRaises(ValidationError):
            self.propose(order, [(line, "0.400")], version=self.head(order) + 5)
        self.reject_amendment(row)
        self.assertEqual(self.propose(order, [(line, "0.375")])["state"], "pending")
        self.assertEqual(Amendment.objects.count(), 2)

    def test_withdrawal_belongs_to_the_proposer_alone(self):
        order = self.accept("cod")
        row = Amendment.objects.get(pk=self.propose(order, [(self.lines(order)[0], "0.500")])["amendment"])
        with self.assertRaises(PermissionDenied):
            amendments.mutate(
                self.buyer, order.pk, "withdraw",
                {"command_id": uuid.uuid4(), "version": self.head(order), "amendment": str(row.pk), "reason": "Non-proposer withdrawal"},
            )
        self.assertEqual(Amendment.objects.get(pk=row.pk).state, "pending")
        outcome = amendments.mutate(
            self.seller,
            order.pk,
            "withdraw",
            {"command_id": uuid.uuid4(), "version": self.head(order), "amendment": str(row.pk), "reason": "Synthetic withdrawal"},
        )
        row.refresh_from_db()
        self.assertEqual((row.state, row.version, outcome["state"]), ("withdrawn", 2, "withdrawn"))
        with self.assertRaises(Http404):
            amendments.mutate(
                self.seller,
                order.pk,
                "withdraw",
                {"command_id": uuid.uuid4(), "version": self.head(order), "amendment": str(row.pk), "reason": "Second withdrawal"},
            )

    def test_approval_projects_effective_lines_and_never_rewrites_acceptance(self):
        order = self.reserved(self.accept("advance"))
        line = self.lines(order)[0]
        row = Amendment.objects.get(pk=self.propose(order, [(line, "0.500", "11.00")])["amendment"])
        outcome = self.approve_amendment(row)
        order = SellerOrder.objects.get(pk=order.pk)
        self.assertEqual(outcome["accepted_total"], "5.50")
        effective = projection.effective_lines(order)
        self.assertEqual(
            (format(effective[0]["quantity"], ".3f"), format(effective[0]["unit_price"], ".2f")), ("0.500", "11.00")
        )
        self.assertEqual(projection.accepted_total(order), Decimal("5.50"))
        line.refresh_from_db()
        self.assertEqual((line.quantity, line.unit_price), (Decimal("1.000"), Decimal("12.50")))
        row.refresh_from_db()
        self.assertEqual((row.state, row.version), ("approved", 3))
        self.assertEqual(AmendmentDecision.objects.get(amendment=row).action, "approved")

    def test_approval_partially_releases_the_held_allocation_exactly_once(self):
        order = self.reserved(self.accept("advance"))
        before = Bucket.objects.get()
        row = Amendment.objects.get(pk=self.propose(order, [(self.lines(order)[0], "0.500")])["amendment"])
        outcome = self.approve_amendment(row)
        reduction = AllocationReduction.objects.get()
        self.assertEqual(format(reduction.quantity, ".3f"), "0.500")
        self.assertEqual(reduction.allocation_id, Allocation.objects.get().pk)
        self.assertEqual(Allocation.objects.get().state, "held")
        self.assertEqual(format(Bucket.objects.get().held, ".3f"), "0.500")
        self.assertEqual(Bucket.objects.get().physical, before.physical)
        self.assertEqual(Operation.objects.filter(action="reduce").count(), 1)
        self.assertEqual(Movement.objects.filter(operation__action="reduce").count(), 1)
        self.assertEqual(outcome["release"], str(reduction.operation_id))

    def test_approval_writes_one_adjustment_and_dues_the_exact_overpayment(self):
        order = self.reserved(self.accept("advance"))
        row = Amendment.objects.get(pk=self.propose(order, [(self.lines(order)[0], "0.500")])["amendment"])
        outcome = self.approve_amendment(row)
        adjustment = InvoiceAdjustment.objects.get(order=order)
        self.assertEqual(adjustment.cause, "amendment")
        self.assertEqual(format(adjustment.before_total, ".2f"), "12.50")
        self.assertEqual(format(adjustment.after_total, ".2f"), "6.25")
        self.assertEqual(
            (adjustment.before_lines[0]["quantity"], adjustment.after_lines[0]["quantity"]), ("1.000", "0.500")
        )
        due = RefundDue.objects.get(pk=outcome["refund_due"])
        self.assertEqual((due.cause, format(due.amount, ".2f")), ("amendment", "6.25"))
        figures = projection.money_figures(order, pay.confirmed(order))
        self.assertEqual((figures["excess"], figures["remaining"], figures["refund_due"]), ("6.25", "0.00", "6.25"))

    def test_replaying_the_approval_produces_no_second_release_refund_or_adjustment(self):
        order = self.reserved(self.accept("advance"))
        row = Amendment.objects.get(pk=self.propose(order, [(self.lines(order)[0], "0.500")])["amendment"])
        self.amend(row, "assign", assigned_to=self.root.user.pk, reason="Assigned synthetic review")
        row.refresh_from_db()
        packet = {
            "command_id": uuid.uuid4(),
            "version": self.head(order),
            "amendment_version": row.version,
            "action": "approve",
            "reason": "Independent synthetic amendment approval",
        }
        first = amendments.decide(self.root, row.pk, packet)
        self.assertEqual(amendments.decide(self.root, row.pk, packet), first)
        self.assertEqual(InvoiceAdjustment.objects.count(), 1)
        self.assertEqual(AllocationReduction.objects.count(), 1)
        self.assertEqual(RefundDue.objects.count(), 1)
        self.assertEqual(format(Bucket.objects.get().held, ".3f"), "0.500")
        with self.assertRaises(Conflict):
            self.amend(row, "reject")

    def test_cod_and_unreserved_amendments_have_no_stock_effect(self):
        order = self.accept("cod")
        row = Amendment.objects.get(pk=self.propose(order, [(self.lines(order)[0], "0.500")])["amendment"])
        outcome = self.approve_amendment(row)
        self.assertIsNone(outcome["release"])
        self.assertFalse(AllocationReduction.objects.exists())
        self.assertFalse(Operation.objects.filter(action="reduce").exists())
        self.assertIsNone(outcome["refund_due"])
        self.assertEqual(InvoiceAdjustment.objects.get(order=order).after_total, Decimal("6.25"))

    def test_amendment_chain_uses_the_latest_approved_effective_values(self):
        order = self.accept("advance")
        line = self.lines(order)[0]
        first = Amendment.objects.get(pk=self.propose(order, [(line, "0.500")])["amendment"])
        self.approve_amendment(first)
        with self.assertRaises(ValidationError) as refused:
            self.propose(order, [(line, "0.625")])
        self.assertEqual(refused.exception.detail["amendment"], ["amendment_increase_refused"])
        second = Amendment.objects.get(pk=self.propose(order, [(line, "0.250")])["amendment"])
        self.approve_amendment(second)
        order = SellerOrder.objects.get(pk=order.pk)
        self.assertEqual(projection.approved_amendment(order).pk, second.pk)
        self.assertEqual(format(projection.accepted_total(order), ".2f"), "3.13")
        self.assertEqual(InvoiceAdjustment.objects.filter(order=order).count(), 2)

    def test_approval_requires_independent_assignment_and_refuses_the_proposer(self):
        order = self.accept("advance")
        row = Amendment.objects.get(pk=self.propose(order, [(self.lines(order)[0], "0.500")])["amendment"])
        with self.assertRaises(PermissionDenied):
            self.amend(row, "approve")
        with self.assertRaises(Http404):
            self.amend(row, "approve", actor=self.seller)
        with self.assertRaises(PermissionDenied):
            self.amend(row, "assign", assigned_to=self.seller.user.pk)
        outcome = self.amend(row, "assign", assigned_to=self.root.user.pk, reason="Assigned synthetic review")
        self.assertEqual(outcome["state"], "pending")
        self.assertEqual(Amendment.objects.get(pk=row.pk).assigned_to_id, self.root.user.pk)

    def test_rejection_leaves_demand_money_and_stock_unchanged(self):
        order = self.reserved(self.accept("advance"))
        held = Bucket.objects.get().held
        row = Amendment.objects.get(pk=self.propose(order, [(self.lines(order)[0], "0.500")])["amendment"])
        self.reject_amendment(row)
        row.refresh_from_db()
        self.assertEqual(row.state, "rejected")
        self.assertFalse(InvoiceAdjustment.objects.exists())
        self.assertFalse(AllocationReduction.objects.exists())
        self.assertEqual(Bucket.objects.get().held, held)
        self.assertEqual(projection.accepted_total(SellerOrder.objects.get(pk=order.pk)), Decimal("12.50"))
        self.assertEqual(projection.eligibility(SellerOrder.objects.get(pk=order.pk))["amend"], True)

    def test_an_approved_amendment_forces_a_deliberate_repreparation(self):
        order = self.accept("cod")
        self.prepare(order)
        preparation = delivery.Preparation.objects.get(order=order)
        row = Amendment.objects.get(pk=self.propose(order, [(self.lines(order)[0], "0.500")])["amendment"])
        self.approve_amendment(row)
        with self.assertRaises(Conflict):
            self.send(order)
        self.assertFalse(delivery.Shipment.objects.filter(order=order).exists())
        self.assertTrue(delivery.PreparationLine.objects.filter(preparation=preparation).exists())

    def test_dispatch_before_the_amendment_decision_refuses_it(self):
        order = self.accept("cod")
        row = Amendment.objects.get(pk=self.propose(order, [(self.lines(order)[0], "0.500")])["amendment"])
        self.prepare(order)
        self.send(order)
        with self.assertRaises(ValidationError) as refused:
            self.approve_amendment(row)
        self.assertEqual(refused.exception.detail["amendment"], ["amendment_ineligible_dispatched"])
        self.assertEqual(Amendment.objects.get(pk=row.pk).state, "pending")

    def test_guards_freeze_proposal_values_lines_and_decisions(self):
        order = self.reserved(self.accept("advance"))
        row = Amendment.objects.get(pk=self.propose(order, [(self.lines(order)[0], "0.500")])["amendment"])
        proposed = AmendmentLine.objects.get(amendment=row)
        with self.assertRaises(DatabaseError), transaction.atomic(), connection.cursor() as cursor:
            cursor.execute("UPDATE orders_amendmentline SET proposed_quantity='0.900' WHERE id=%s", [proposed.pk.hex])
        with self.assertRaises(DatabaseError), transaction.atomic(), connection.cursor() as cursor:
            cursor.execute("UPDATE orders_amendment SET after_total='1.00' WHERE id=%s", [row.pk.hex])
        with self.assertRaises(DatabaseError), transaction.atomic(), connection.cursor() as cursor:
            cursor.execute("DELETE FROM orders_amendmentline WHERE id=%s", [proposed.pk.hex])
        self.approve_amendment(row)
        with self.assertRaises(DatabaseError), transaction.atomic(), connection.cursor() as cursor:
            cursor.execute(
                "INSERT INTO orders_amendment (id,order_id,state,actor_id,after_total,version,reason,event_id,created_at)"
                " VALUES (%s,%s,'pending',%s,'1.00',1,'Native guard probe',%s,UTC_TIMESTAMP(6))",
                [uuid.uuid4().hex, order.pk.hex, self.seller.account.pk.hex, uuid.uuid4().hex],
            )
        with self.assertRaises(DatabaseError), transaction.atomic(), connection.cursor() as cursor:
            cursor.execute("UPDATE orders_amendmentdecision SET action='rejected'")
        self.assertEqual(AmendmentDecision.objects.get(amendment=row).action, "approved")


@override_settings(OWNER_MFA_REQUIRED=False)
class GoodsRefundTests(AftercareFixture, TestCase):
    def overpaid(self, amount="15.00"):
        order = self.accept("cod")
        self.receipt(order, amount)
        return order

    def test_seller_may_only_due_the_current_excess_and_the_due_is_sealed(self):
        order = self.overpaid()
        outcome = self.due(order, "2.50")
        due = RefundDue.objects.get(pk=outcome["refund_due"])
        self.assertEqual((due.cause, format(due.amount, ".2f"), due.currency, due.version), ("excess", "2.50", "AFN", 1))
        self.assertEqual(RefundSeal.objects.get(due=due).due_id, due.pk)
        event = PaymentEvent.objects.get(pk=due.event_id)
        self.assertEqual((event.action, event.account_id), ("refund_due_created", self.seller.account.pk))
        self.assertEqual(pay.confirmed(SellerOrder.objects.get(pk=order.pk)), Decimal("15.00"))
        with self.assertRaises(ValidationError) as refused:
            self.due(order, "1.00")
        self.assertEqual(refused.exception.detail["amount"], ["excess_bound"])

    def test_a_cancelled_order_refuses_new_dues_but_keeps_earlier_ones(self):
        order = self.reserved(self.accept("advance"))
        row = CancellationRequest.objects.get(pk=self.cancel(order)["request"])
        due = RefundDue.objects.get(pk=self.approve(row)["refund_due"])
        with self.assertRaises(ValidationError) as refused:
            self.due(SellerOrder.objects.get(pk=order.pk), "1.00")
        self.assertEqual(refused.exception.detail["refund"], ["order_cancelled"])
        self.assertEqual(RefundDue.objects.get(pk=due.pk).amount, Decimal("12.50"))

    def test_report_requires_the_exact_due_amount_and_actual_money_facts(self):
        order = self.overpaid()
        due = RefundDue.objects.get(pk=self.due(order, "2.50")["refund_due"])
        with self.assertRaises(ValidationError) as refused:
            self.report(order, due, amount="2.00")
        self.assertEqual(refused.exception.detail["amount"], ["exact_due_amount"])
        with self.assertRaises(ValidationError):
            self.report(order, due, sent_at=timezone.now() + timedelta(hours=1))
        with self.assertRaises(ValidationError):
            self.report(order, due, sent_at=timezone.now().replace(tzinfo=None))
        with self.assertRaises(ValidationError):
            self.report(order, due, reference="")
        with self.assertRaises(ValidationError):
            self.report(order, due, description="")
        self.assertFalse(RefundReport.objects.exists())
        report = RefundReport.objects.get(pk=self.report(order, due)["report"])
        self.assertEqual((format(report.amount, ".2f"), report.actor_id), ("2.50", self.seller.account.pk))

    def test_one_pending_report_per_due_and_replacement_history(self):
        order = self.overpaid()
        due = RefundDue.objects.get(pk=self.due(order, "2.50")["refund_due"])
        first = RefundReport.objects.get(pk=self.report(order, due, reference="SYNTHETIC-FIRST")["report"])
        with self.assertRaises(Conflict):
            self.report(order, due, reference="SYNTHETIC-SECOND")
        self.refund(due, "assign", assigned_to=self.root.user.pk, reason="Assigned synthetic review")
        self.refund(due, "reject")
        second = RefundReport.objects.get(pk=self.report(order, due, reference="SYNTHETIC-THIRD")["report"])
        self.assertEqual(second.previous_id, first.pk)
        self.assertEqual(RefundReport.objects.filter(due=due).count(), 2)
        self.assertEqual(RefundDecision.objects.get(report=first).action, "rejected")

    def test_withdrawal_belongs_to_the_reporting_seller_and_is_retained(self):
        order = self.overpaid()
        due = RefundDue.objects.get(pk=self.due(order, "2.50")["refund_due"])
        report = self.report(order, due)["report"]
        outcome = refunds.mutate(
            self.seller,
            order.pk,
            "refund_withdraw",
            {
                "command_id": uuid.uuid4(),
                "version": self.finance(order),
                "report": report,
                "reason": "Synthetic refund withdrawal",
            },
        )
        self.assertEqual(outcome["state"], "withdrawn")
        decision = RefundDecision.objects.get(report_id=report)
        self.assertEqual((decision.action, decision.context), ("withdrawn", "seller"))
        with self.assertRaises(Conflict):
            refunds.mutate(
                self.seller,
                order.pk,
                "refund_withdraw",
                {"command_id": uuid.uuid4(), "version": self.finance(order), "report": report, "reason": "Second withdrawal"},
            )
        replacement = RefundReport.objects.get(pk=self.report(order, due)["report"])
        self.assertEqual(str(replacement.previous_id), report)

    def test_confirmation_requires_an_independent_assigned_reviewer(self):
        order = self.overpaid()
        due = RefundDue.objects.get(pk=self.due(order, "2.50")["refund_due"])
        self.report(order, due)
        with self.assertRaises(PermissionDenied):
            self.refund(due, "confirm")
        with self.assertRaises(PermissionDenied):
            self.refund(due, "assign", assigned_to=self.seller.user.pk)
        with self.assertRaises(Http404):
            self.refund(due, "confirm", actor=self.seller)
        outcome = self.confirm_refund(due)
        self.assertEqual(outcome["state"], "confirmed")

    def test_confirmation_never_moves_money_and_only_reduces_the_refund_due(self):
        order = self.overpaid()
        due = RefundDue.objects.get(pk=self.due(order, "2.50")["refund_due"])
        self.report(order, due)
        before = list(Receipt.objects.values_list("id", "amount", "event_id"))
        self.confirm_refund(due)
        order = SellerOrder.objects.get(pk=order.pk)
        self.assertEqual(list(Receipt.objects.values_list("id", "amount", "event_id")), before)
        self.assertEqual(pay.confirmed(order), Decimal("15.00"))
        self.assertEqual(refunds.refunded_total(order), Decimal("2.50"))
        self.assertEqual(refunds.due_total(order), Decimal("2.50"))
        figures = projection.money_figures(order, pay.confirmed(order))
        self.assertEqual((figures["received"], figures["refunded"], figures["refund_due"]), ("15.00", "2.50", "0.00"))
        self.assertFalse(Bucket.objects.filter(held__gt=0).exists())

    def test_a_second_confirmation_on_the_same_due_is_refused(self):
        order = self.overpaid()
        due = RefundDue.objects.get(pk=self.due(order, "2.50")["refund_due"])
        self.report(order, due)
        self.confirm_refund(due)
        with self.assertRaises(Conflict):
            self.refund(due, "confirm")
        self.assertEqual(RefundDecision.objects.filter(action="confirmed").count(), 1)

    def test_confirmed_refunds_can_never_exceed_confirmed_received_money(self):
        order = self.overpaid("13.00")
        due = RefundDue.objects.get(pk=self.due(order, "0.50")["refund_due"])
        self.report(order, due)
        self.confirm_refund(due)
        row = CancellationRequest.objects.get(pk=self.cancel(order)["request"])
        outcome = self.approve(row)
        remainder = RefundDue.objects.get(pk=outcome["refund_due"])
        self.assertEqual(format(remainder.amount, ".2f"), "12.50")
        self.report(order, remainder)
        self.confirm_refund(remainder)
        self.assertEqual(refunds.refunded_total(order), pay.confirmed(order))
        with self.assertRaises(ValidationError):
            self.due(order, "0.10")

    def test_replayed_refund_commands_repeat_results_without_new_rows(self):
        order = self.overpaid()
        due = RefundDue.objects.get(pk=self.due(order, "2.50")["refund_due"])
        packet = {
            "command_id": uuid.uuid4(),
            "version": self.finance(order),
            "due": str(due.pk),
            "amount": "2.50",
            "sent_at": timezone.now() - timedelta(minutes=2),
            "reference": "SYNTHETIC-REPLAY",
            "description": "Synthetic private refund proof",
        }
        first = refunds.mutate(self.seller, order.pk, "report", packet)
        self.assertEqual(refunds.mutate(self.seller, order.pk, "report", packet), first)
        self.assertEqual(RefundReport.objects.count(), 1)
        with self.assertRaises(Conflict):
            refunds.mutate(self.seller, order.pk, "report", {**packet, "reference": "SYNTHETIC-CHANGED"})
        self.refund(due, "assign", assigned_to=self.root.user.pk, reason="Assigned synthetic review")
        due.refresh_from_db()
        decision = {
            "command_id": uuid.uuid4(),
            "version": self.finance(order),
            "due_version": due.version,
            "action": "confirm",
            "reason": "Independent synthetic refund confirmation",
        }
        applied = refunds.decide(self.root, due.pk, decision)
        self.assertEqual(refunds.decide(self.root, due.pk, decision), applied)
        self.assertEqual(RefundDecision.objects.filter(action="confirmed").count(), 1)

    def test_guards_seal_dues_reports_and_decisions(self):
        order = self.overpaid()
        due = RefundDue.objects.get(pk=self.due(order, "2.50")["refund_due"])
        report = RefundReport.objects.get(pk=self.report(order, due)["report"])
        self.confirm_refund(due)
        for statement, arguments in (
            ("UPDATE payments_refunddue SET amount='9.00' WHERE id=%s", [due.pk.hex]),
            ("DELETE FROM payments_refundseal WHERE due_id=%s", [due.pk.hex]),
            ("UPDATE payments_refundreport SET amount='1.00' WHERE id=%s", [report.pk.hex]),
            ("UPDATE payments_refundreport SET reference='altered' WHERE id=%s", [report.pk.hex]),
            ("UPDATE payments_refunddecision SET reason='altered' WHERE report_id=%s", [report.pk.hex]),
            ("DELETE FROM payments_refunddecision WHERE report_id=%s", [report.pk.hex]),
        ):
            with self.assertRaises(DatabaseError), transaction.atomic(), connection.cursor() as cursor:
                cursor.execute(statement, arguments)
        with self.assertRaises(DatabaseError), transaction.atomic(), connection.cursor() as cursor:
            cursor.execute(
                "INSERT INTO payments_refunddecision (report_id,context,action,reason,actor_id,event_id,created_at)"
                " VALUES (%s,'seller','confirmed','Native guard probe',%s,%s,UTC_TIMESTAMP(6))",
                [report.pk.hex, self.seller.user.pk, PaymentEvent.objects.order_by("-version").first().pk.hex],
            )
        self.assertEqual(RefundDecision.objects.filter(report=report).count(), 1)


@override_settings(OWNER_MFA_REQUIRED=False)
class DeliveryRefundTests(AftercareFixture, TestCase):
    def paid(self, charge="5.00"):
        order = self.accept("cod")
        self.prepare(order, charge)
        self.command(
            order,
            "claim",
            self.buyer,
            charge=str(delivery_queries.current_charge(order).pk),
            amount=charge,
            currency="AFN",
            paid_at=timezone.now() - timedelta(minutes=1),
            description="Synthetic actual provider receipt",
        )
        case = delivery.ReviewCase.objects.get(order=order, kind="payment")
        self.review(case, "assign", assigned_to=self.root.user.pk)
        self.review(case, "approve")
        return order

    def provider_report(self, order, amount="2.00", actor=None, **extra):
        provider = delivery.Arrangement.objects.get(order=order).provider_id
        return self.command(
            order,
            "refund",
            actor or self.seller,
            **{
                "provider": str(provider),
                "amount": amount,
                "currency": "AFN",
                "sent_at": timezone.now() - timedelta(minutes=2),
                "reference": "SYNTHETIC-PROVIDER-REFUND",
                "description": "Synthetic provider refund proof",
                **extra,
            },
        )

    def test_provider_refund_is_recorded_separately_and_bounded_by_receipts(self):
        order = self.paid()
        outcome = self.provider_report(order, "2.00")
        item = delivery.DeliveryRefund.objects.get(pk=outcome["refund"])
        self.assertEqual(
            (format(item.amount, ".2f"), item.currency, item.provider_id),
            ("2.00", "AFN", delivery.Arrangement.objects.get(order=order).provider_id),
        )
        self.assertEqual(delivery.ReviewCase.objects.get(order=order, kind="refund").state, "open")
        self.assertEqual(delivery_queries.confirmed_refunds(order), ZERO)
        with self.assertRaises(ValidationError) as refused:
            self.provider_report(order, "9.00")
        self.assertEqual(refused.exception.detail["amount"], ["provider_receipt_bound"])

    def test_confirmation_is_independent_and_the_reporter_cannot_confirm(self):
        order = self.paid()
        item = delivery.DeliveryRefund.objects.get(pk=self.provider_report(order, "2.00")["refund"])
        case = delivery.ReviewCase.objects.get(order=order, kind="refund")
        with self.assertRaises(PermissionDenied):
            self.review(case, "assign", assigned_to=self.seller.user.pk)
        self.review(case, "assign", assigned_to=self.root.user.pk)
        self.review(case, "approve")
        decision = delivery.DeliveryRefundDecision.objects.get(refund=item)
        self.assertEqual((decision.action, decision.event.actor_id), ("confirmed", self.root.user.pk))
        self.assertEqual(delivery_queries.confirmed_refunds(order), Decimal("2.00"))

    def test_wrong_currency_unknown_provider_and_future_time_are_refused(self):
        order = self.paid()
        with self.assertRaises(ValidationError):
            self.provider_report(order, currency="USD")
        with self.assertRaises(ValidationError):
            self.provider_report(order, provider=str(uuid.uuid4()))
        with self.assertRaises(ValidationError):
            self.provider_report(order, sent_at=timezone.now() + timedelta(hours=1))

    def test_delivery_refunds_never_change_goods_money_or_stock(self):
        order = self.paid()
        before = (pay.confirmed(order), Allocation.objects.count(), Bucket.objects.get().physical)
        item = delivery.DeliveryRefund.objects.get(pk=self.provider_report(order, "2.00")["refund"])
        case = delivery.ReviewCase.objects.get(order=order, kind="refund")
        self.review(case, "assign", assigned_to=self.root.user.pk)
        self.review(case, "approve")
        self.assertEqual((pay.confirmed(order), Allocation.objects.count(), Bucket.objects.get().physical), before)
        self.assertEqual(delivery.DeliveryRefundDecision.objects.get(refund=item).action, "confirmed")
        self.assertFalse(RefundDue.objects.exists())
        self.assertFalse(RefundSeal.objects.exists())
        self.assertFalse(InvoiceAdjustment.objects.exists())

    def test_a_second_decision_for_the_same_refund_is_refused(self):
        order = self.paid()
        item = delivery.DeliveryRefund.objects.get(pk=self.provider_report(order, "2.00")["refund"])
        case = delivery.ReviewCase.objects.get(order=order, kind="refund")
        self.review(case, "assign", assigned_to=self.root.user.pk)
        self.review(case, "approve")
        with self.assertRaises(Conflict):
            self.review(case, "approve")
        self.assertEqual(delivery.DeliveryRefundDecision.objects.filter(refund=item).count(), 1)

    def test_native_refund_metadata_requires_current_assignment_and_refuses_generic_writes(self):
        order = self.paid()
        item = delivery.DeliveryRefund.objects.get(pk=self.provider_report(order)["refund"])
        path = "/admin/fulfilment/deliveryrefund/"
        self.assertEqual(self.root_client.get(path).status_code, 200)
        self.assertEqual(self.staff_client.get(path).status_code, 403)
        self.staff.user.groups.add(self.native_group("Delivery refund review"))
        self.assertEqual(list(self.staff_client.get(path).context["cl"].result_list), [])
        case = delivery.ReviewCase.objects.get(refund=item)
        self.review(case, "assign", assigned_to=self.staff.user.pk)
        self.assertEqual([row.pk for row in self.staff_client.get(path).context["cl"].result_list], [item.pk])
        self.assertContains(self.staff_client.get(f"{path}{item.pk}/change/"), "Open guarded refund review")
        for suffix in ("change", "delete"):
            self.assertEqual(self.staff_client.post(
                f"{path}{item.pk}/{suffix}/", {"amount": "9.00", "post": "yes"},
                HTTP_X_CSRFTOKEN=self.staff_client.cookies["csrftoken"].value,
            ).status_code, 403)
        self.staff.user.groups.clear()
        self.assertEqual(self.staff_client.get(path).status_code, 403)
        self.assertEqual(delivery.DeliveryRefund.objects.get(pk=item.pk).amount, Decimal("2.00"))

    def test_guards_freeze_provider_refunds_and_their_decisions(self):
        order = self.paid()
        item = delivery.DeliveryRefund.objects.get(pk=self.provider_report(order, "2.00")["refund"])
        for statement, arguments in (
            ("UPDATE fulfilment_deliveryrefund SET amount='9.00' WHERE id=%s", [item.pk.hex]),
            ("UPDATE fulfilment_deliveryrefund SET provider_id=%s WHERE id=%s", [item.provider_id.hex, item.pk.hex]),
            ("DELETE FROM fulfilment_deliveryrefund WHERE id=%s", [item.pk.hex]),
        ):
            with self.assertRaises(DatabaseError), transaction.atomic(), connection.cursor() as cursor:
                cursor.execute(statement, arguments)
        case = delivery.ReviewCase.objects.get(order=order, kind="refund")
        self.review(case, "assign", assigned_to=self.root.user.pk)
        self.review(case, "approve")
        with self.assertRaises(DatabaseError), transaction.atomic(), connection.cursor() as cursor:
            cursor.execute("UPDATE fulfilment_deliveryrefunddecision SET action='rejected'")
        self.assertEqual(delivery.DeliveryRefundDecision.objects.get().action, "confirmed")


@override_settings(OWNER_MFA_REQUIRED=False)
class AftercareNotificationTests(AftercareFixture, TestCase):
    def fanout(self):
        from apps.notifications import aftercare_events

        aftercare_events.sweep_notices()
        return Notice.objects.filter(event__kind="aftercare")

    def activity(self, order):
        """Request aftercare and fan out with an already-due email intent."""
        from apps.notifications import aftercare_events

        with patch(
            "apps.notifications.aftercare_events.email_due",
            return_value=timezone.now() - timedelta(minutes=1),
        ):
            outcome = self.cancel(order)
            aftercare_events.sweep_notices()
        return outcome

    def test_a_request_publishes_one_aftercare_event_and_notices_the_other_party(self):
        order = self.accept("advance")
        outcome = self.activity(order)
        row = CancellationRequest.objects.get(pk=outcome["request"])
        event = Event.objects.get(kind="aftercare", aftercare_event_id=row.event_id)
        self.assertEqual(AftercareNoticeCursor.objects.get(event=event).sender_id, self.buyer.user.pk)
        self.assertEqual(Job.objects.filter(kind="aftercare_sweep").count(), 1)
        rows = self.fanout()
        self.assertEqual([x.account_id for x in rows], [self.seller.account.pk])
        self.assertEqual(rows[0].aftercare_order_id, order.pk)
        self.assertEqual(rows[0].event_id, event.pk)
        self.assertEqual(self.fanout().count(), 1)

    def test_a_terminal_decision_notifies_both_parties_with_no_sender(self):
        order = self.accept("advance")
        row = CancellationRequest.objects.get(pk=self.activity(order)["request"])
        self.reject(row)
        from apps.notifications import aftercare_events

        aftercare_events.sweep_notices()
        approved = Notice.objects.filter(event__aftercare_event__action="cancellation_rejected")
        self.assertEqual(
            sorted(approved.values_list("account_id", flat=True)),
            sorted([order.buyer_id, self.seller.account.pk]),
        )
        cursor = AftercareNoticeCursor.objects.get(event__aftercare_event__action="cancellation_rejected")
        self.assertIsNone(cursor.sender_id)
        self.assertTrue(cursor.complete)

    def test_one_branded_email_per_episode_with_no_private_figures(self):
        from apps.notifications import aftercare_events

        order = self.accept("advance")
        self.activity(order)
        row = AftercareEmail.objects.get(account=self.seller.account, order=order)
        self.assertEqual(row.status, "queued")
        aftercare_events.sweep()
        row.refresh_from_db()
        self.assertEqual(row.status, "captured")
        self.assertEqual(len(mail.outbox), 1)
        body = str(mail.outbox[0].alternatives[0][0]) + mail.outbox[0].body
        for secret in ("12.50", str(order.invoice.number), self.buyer.user.email):
            self.assertNotIn(secret, body)
        self.assertIn(f"/account/seller/aftercare/{order.pk}", body)
        self.assertIn('dir="rtl"', body)
        aftercare_events.sweep()
        self.assertEqual(len(mail.outbox), 1)

    def test_preference_locale_and_optout_control_the_email_but_never_the_notice(self):
        from apps.notifications import aftercare_events, services as notices

        order = self.accept("advance")
        notices.set_preference(
            self.seller, {"message_email": True, "aftercare_email": False, "locale": "ps", "version": 0}
        )
        self.activity(order)
        self.assertFalse(AftercareEmail.objects.exists())
        self.assertTrue(Notice.objects.filter(event__kind="aftercare").exists())
        notices.set_preference(
            self.seller, {"message_email": True, "aftercare_email": True, "locale": "ps", "version": 1}
        )
        second = self.accept("advance")
        self.activity(second)
        queued = AftercareEmail.objects.get(account=self.seller.account, order=second)
        aftercare_events.sweep()
        queued.refresh_from_db()
        self.assertEqual(queued.status, "captured")
        self.assertIn('lang="ps"', str(mail.outbox[-1].alternatives[0][0]))

    def test_a_read_notice_cancels_the_queued_email(self):
        from apps.notifications import aftercare_events

        order = self.accept("advance")
        self.activity(order)
        row = AftercareEmail.objects.get(account=self.seller.account)
        Notice.objects.filter(event__kind="aftercare").update(read_at=timezone.now())
        token = aftercare_events.claim(row.pk)
        self.assertIsNotNone(token)
        self.assertIsNone(aftercare_events.prepare(row.pk, token))
        row.refresh_from_db()
        self.assertEqual((row.status, row.attempts), ("cancelled", 0))
        self.assertEqual(AftercareEmailAttempt.objects.get(email=row).code, "no_longer_eligible")

    def test_an_identity_change_cancels_the_queued_email_before_dispatch(self):
        from apps.notifications import aftercare_events

        order = self.accept("advance")
        self.activity(order)
        row = AftercareEmail.objects.get(account=self.seller.account)
        User.objects.filter(pk=self.seller.user.pk).update(email="moved-" + str(uuid.uuid4())[:8] + "@example.test")
        token = aftercare_events.claim(row.pk)
        self.assertIsNotNone(token)
        self.assertIsNone(aftercare_events.prepare(row.pk, token))
        row.refresh_from_db()
        self.assertEqual(row.status, "cancelled")
        self.assertEqual(len(mail.outbox), 0)

    def test_an_opted_out_preference_cancels_the_queued_email(self):
        from apps.notifications import aftercare_events, services as notices

        order = self.accept("advance")
        self.activity(order)
        row = AftercareEmail.objects.get(account=self.seller.account)
        notices.set_preference(
            self.seller, {"message_email": True, "aftercare_email": False, "locale": "fa-AF", "version": 0}
        )
        token = aftercare_events.claim(row.pk)
        self.assertIsNotNone(token)
        self.assertIsNone(aftercare_events.prepare(row.pk, token))
        row.refresh_from_db()
        self.assertEqual(row.status, "cancelled")

    def test_an_unverified_recipient_is_skipped_and_later_activity_notifies_again(self):
        order = self.accept("advance")
        outsider = self.connected("buyer", "aftercare-outsider")[0]
        with patch("apps.notifications.aftercare_events.email_due", return_value=timezone.now()):
            outcome = self.cancel(order)
        row = CancellationRequest.objects.get(pk=outcome["request"])
        User.objects.filter(pk=self.seller.user.pk).update(email_verified=False)
        self.assertEqual(len(self.fanout()), 0)
        User.objects.filter(pk=self.seller.user.pk).update(email_verified=True)
        self.reject(row)
        self.assertIn(
            self.seller.account.pk, [x.account_id for x in self.fanout() if x.event.aftercare_event_id]
        )
        self.assertEqual(Notice.objects.filter(account=outsider.account).count(), 0)

    def test_rendered_copy_covers_all_four_locales_with_the_shared_brand(self):
        from apps.notifications.aftercare_events import COPY, rendered

        order = self.accept("advance")
        for locale in ("en", "fa-AF", "ps", "ar"):
            subject, plain, html = rendered(self.buyer.account, order, locale)
            self.assertIn(COPY[locale][0], subject + plain)
            self.assertIn(f"/{locale}/account/buyer/cancellations/{order.pk}", plain)
            self.assertIn('dir="ltr"' if locale == "en" else 'dir="rtl"', html)
        self.assertIn("cid:rezayi-brand", rendered(self.buyer.account, order, "unknown")[2])


@override_settings(OWNER_MFA_REQUIRED=False)
class ShortageCancellationTests(AftercareFixture, TestCase):
    def shortage(self):
        from apps.inventory import services as stock
        from apps.inventory.models import Position

        order = self.accept("advance")
        self.plan(order)
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
        self.receipt(order)
        case = PaymentReviewCase.objects.get(order=order, kind="shortage")
        return order, case

    def staff_decision_group(self):
        return self.native_group("Cancellation review")

    def test_staff_opens_one_cancellation_from_a_shortage_case_and_holds_the_order(self):
        order, case = self.shortage()
        outcome = cancellations.open_from_case(
            self.root,
            case.pk,
            {"command_id": uuid.uuid4(), "version": self.head(order), "reason": "Synthetic shortage cancellation"},
        )
        row = CancellationRequest.objects.get(pk=outcome["request"])
        self.assertEqual((row.state, row.requester_context), ("pending", "staff"))
        self.assertIsNone(row.requester_account_id)
        self.assertEqual(row.requester_user_id, self.root.user.pk)
        self.assertEqual(row.payment_case_id, case.pk)
        self.assertTrue(delivery.Blocker.objects.filter(order=order, kind="cancellation").exists())
        self.assertEqual(AftercareEvent.objects.get(pk=row.event_id).action, "cancellation_opened")

    def test_the_opening_reviewer_can_never_decide_the_opened_cancellation(self):
        order, case = self.shortage()
        outcome = cancellations.open_from_case(
            self.root,
            case.pk,
            {"command_id": uuid.uuid4(), "version": self.head(order), "reason": "Synthetic shortage cancellation"},
        )
        row = CancellationRequest.objects.get(pk=outcome["request"])
        with self.assertRaises(PermissionDenied):
            self.approve(row)
        reviewer = self.connected("staff", "aftercare-decider", group=self.staff_decision_group())[0]
        self.decide(row, "assign", actor=self.root, assigned_to=reviewer.user.pk)
        outcome = self.decide(row, "approve", actor=reviewer)
        row.refresh_from_db()
        self.assertEqual((row.state, outcome["state"]), ("approved", "approved"))
        self.assertEqual(CancellationDecision.objects.get(request=row).context, "staff")

    def test_opening_is_replay_safe_versioned_and_refused_without_a_shortage_case(self):
        order, case = self.shortage()
        packet = {
            "command_id": uuid.uuid4(),
            "version": self.head(order),
            "reason": "Synthetic shortage cancellation",
        }
        first = cancellations.open_from_case(self.root, case.pk, packet)
        self.assertEqual(cancellations.open_from_case(self.root, case.pk, packet), first)
        with self.assertRaises(Conflict):
            cancellations.open_from_case(self.root, case.pk, {**packet, "reason": "Changed shortage reason"})
        with self.assertRaises(ValidationError):
            cancellations.open_from_case(
                self.root, case.pk, {"command_id": uuid.uuid4(), "version": 0, "reason": "Stale head version"}
            )
        with self.assertRaises(Http404):
            cancellations.open_from_case(
                self.root,
                uuid.uuid4().hex,
                {"command_id": uuid.uuid4(), "version": self.head(order), "reason": "Unknown shortage case"},
            )
        self.assertEqual(CancellationRequest.objects.filter(order=order).count(), 1)

    def test_a_cancelled_order_stops_overdue_and_reservation_work(self):
        order, case = self.shortage()
        row = CancellationRequest.objects.get(
            pk=cancellations.open_from_case(
                self.root, case.pk, {"command_id": uuid.uuid4(), "version": self.head(order), "reason": "Synthetic shortage cancellation"}
            )["request"]
        )
        reviewer = self.connected("staff", "aftercare-closer", group=self.staff_decision_group())[0]
        self.decide(row, "assign", actor=self.root, assigned_to=reviewer.user.pk)
        self.decide(row, "approve", actor=reviewer)
        from apps.payments import jobs

        from apps.payments.models import Reminder

        version = self.finance(order)
        events = list(PaymentEvent.objects.filter(order=order).values_list("pk", flat=True))
        cases = list(PaymentReviewCase.objects.filter(order=order).values())
        before = self.inventory_state()
        checked_after = timezone.now()
        jobs.check_order(order.pk)
        checked = Finance.objects.get(order=order)
        self.assertEqual(checked.version, version)
        self.assertGreaterEqual(checked.checked_at, checked_after)
        self.assertGreaterEqual(checked.next_check_at, checked_after + timedelta(hours=24))
        self.assertEqual(list(PaymentEvent.objects.filter(order=order).values_list("pk", flat=True)), events)
        self.assertEqual(list(PaymentReviewCase.objects.filter(order=order).values()), cases)
        self.assertFalse(Reminder.objects.filter(order=order).exists())
        self.assertIsNone(allocation.execute(order.pk))
        self.assertEqual(self.inventory_state(), before)


@override_settings(OWNER_MFA_REQUIRED=False)
class AftercareApiTests(AftercareFixture, TestCase):
    def payload(self, order, **extra):
        return {
            "command_id": str(uuid.uuid4()),
            "version": self.head(order),
            "reason": "Synthetic cancellation request",
            **extra,
        }

    def test_buyer_may_request_and_withdraw_only_through_the_marketplace_api(self):
        order = self.accept("advance")
        body = self.payload(order)
        created = self.post(self.buyer_client, f"orders/buyer/orders/{order.pk}/cancellations/", body)
        self.assertEqual(created.status_code, 201)
        outcome = created.json()["outcome"]
        self.assertEqual((outcome["state"], created.json()["current"]["aftercare"]["cancel"]), ("pending", False))
        row = CancellationRequest.objects.get(pk=outcome["request"])
        withdrawn = self.post(
            self.buyer_client,
            f"orders/buyer/cancellations/{row.pk}/withdraw/",
            {**self.payload(order), "request": str(row.pk)},
        )
        self.assertEqual(withdrawn.status_code, 200)
        self.assertEqual(withdrawn.json()["outcome"]["state"], "withdrawn")

    def test_foreign_orders_malformed_packets_and_bad_versions_are_refused(self):
        order = self.accept("advance")
        foreign = self.post(self.other_client, f"orders/buyer/orders/{order.pk}/cancellations/", self.payload(order))
        self.assertEqual(foreign.status_code, 404)
        self.assertEqual(
            self.post(self.buyer_client, f"orders/buyer/orders/{order.pk}/cancellations/", {"reason": "no id"}).status_code,
            400,
        )
        stale = self.post(
            self.buyer_client,
            f"orders/buyer/orders/{order.pk}/cancellations/",
            {**self.payload(order), "version": self.head(order) + 4},
        )
        self.assertEqual(stale.status_code, 400)
        self.assertEqual(CancellationRequest.objects.filter(order=order).count(), 0)
        self.assertFalse(Aftercare.objects.filter(order=order).exists())
        self.assertFalse(AftercareCommand.objects.filter(order=order).exists())

    def test_seller_proposes_an_amendment_and_a_buyer_cannot(self):
        order = self.accept("advance")
        line = OrderLine.objects.get(order=order)
        body = {
            "command_id": str(uuid.uuid4()),
            "version": self.head(order),
            "lines": [{"line": str(line.pk), "quantity": "0.500", "unit_price": format(line.unit_price, ".2f")}],
            "reason": "Synthetic accepted-price amendment",
        }
        created = self.post(self.seller_client, f"orders/seller/orders/{order.pk}/amendments/", body)
        self.assertEqual(created.status_code, 201)
        row = Amendment.objects.get(pk=created.json()["outcome"]["amendment"])
        self.assertEqual(created.json()["current"]["amendments"][0]["lines"][0]["quantity"], "0.500")
        withdrawn = self.post(
            self.seller_client,
            f"orders/seller/amendments/{row.pk}/withdraw/",
            {**self.payload(order), "amendment": str(row.pk), "reason": "Synthetic amendment withdrawal"},
        )
        self.assertEqual(withdrawn.json()["outcome"]["state"], "withdrawn")
        buyer = self.post(self.buyer_client, f"orders/seller/orders/{order.pk}/amendments/", body)
        self.assertIn(buyer.status_code, (403, 404))

    def test_aftercare_reads_are_scoped_bounded_and_serialized(self):
        order = self.accept("advance")
        self.cancel(order)
        page = self.post(self.buyer_client, "orders/buyer/aftercare/", {}, method="get")
        self.assertEqual(page.status_code, 200)
        self.assertEqual(page.json()["count"], 1)
        rows = page.json()["results"][0]
        self.assertEqual(
            set(rows), {"id", "version", "capabilities", "effective_lines", "number", "invoice", "currency",
                        "goods_total", "accepted_total", "payment_method", "seller", "seller_name", "buyer_name",
                        "payment", "aftercare", "cancellations", "amendments", "adjustments"}
        )
        other = self.post(self.other_client, f"orders/buyer/aftercare/{order.pk}/", {}, method="get")
        self.assertEqual(other.status_code, 404)
        listing = self.post(self.buyer_client, "orders/buyer/cancellations/", {}, method="get")
        self.assertEqual(listing.json()["results"][0]["state"], "pending")
        staff = self.post(self.staff_client, "orders/staff/aftercare/", {}, method="get")
        self.assertIn(staff.status_code, (403, 404))

    def test_command_lookup_is_readonly_and_explicit_post_fences_only_the_command(self):
        order = self.accept("advance")
        key = uuid.uuid4()
        outcome = self.cancel(order, key=key)
        found = self.post(self.buyer_client, f"orders/buyer/orders/{order.pk}/aftercare-commands/{key}/", {}, method="get")
        self.assertEqual((found.status_code, found.json()["state"]), (200, "applied"))
        self.assertEqual(found.json()["result"], outcome)
        unknown = uuid.uuid4()
        missing = self.post(self.buyer_client, f"orders/buyer/orders/{order.pk}/aftercare-commands/{unknown}/", {}, method="get")
        self.assertEqual((missing.status_code, missing.json()["result"]), (200, None))
        before = self.domain_state()
        path = f"orders/buyer/orders/{order.pk}/aftercare-commands/{unknown}/reconcile/"
        refused = self.post(self.buyer_client, path, {}, method="get")
        self.assertEqual(refused.status_code, 405)
        self.assertEqual(self.domain_state(), before)
        settled = self.post(self.buyer_client, path, {})
        self.assertEqual((settled.status_code, settled.json()["state"]), (200, "rejected"))
        self.assertEqual(CancellationRequest.objects.filter(order=order).count(), 1)
        self.assertEqual(AftercareCommand.objects.filter(order=order, action="absence_fence").count(), 1)

    def test_seller_refund_due_and_report_endpoints_seal_the_records(self):
        order = self.accept("cod")
        self.receipt(order, "15.00")
        due = self.post(
            self.seller_client,
            f"payments/seller/orders/{order.pk}/refund-dues/",
            {"command_id": str(uuid.uuid4()), "version": self.finance(order), "amount": "2.50", "reason": "Synthetic excess refund obligation"},
        )
        self.assertEqual(due.status_code, 201)
        identifier = due.json()["outcome"]["refund_due"]
        reported = self.post(
            self.seller_client,
            f"payments/seller/orders/{order.pk}/refund-reports/",
            {
                "command_id": str(uuid.uuid4()),
                "version": self.finance(order),
                "due": identifier,
                "amount": "2.50",
                "sent_at": (timezone.now() - timedelta(minutes=2)).isoformat(),
                "reference": "SYNTHETIC-API-REFUND",
                "description": "Synthetic private refund proof",
            },
        )
        self.assertEqual(reported.status_code, 201)
        report = reported.json()["outcome"]["report"]
        withdrawn = self.post(
            self.seller_client,
            f"payments/seller/refund-reports/{report}/withdraw/",
            {"command_id": str(uuid.uuid4()), "version": self.finance(order), "report": report, "reason": "Synthetic refund withdrawal"},
        )
        self.assertEqual(withdrawn.json()["outcome"]["state"], "withdrawn")
        self.assertEqual(RefundDecision.objects.get(report_id=report).action, "withdrawn")

    def test_aftercare_endpoints_never_expose_contacts_tokens_or_private_keys(self):
        order = self.accept("advance")
        self.cancel(order)
        page = self.post(self.seller_client, "orders/seller/aftercare/", {}, method="get").json()["results"][0]
        text = str(page)
        for secret in (self.buyer.user.email, "private_local", "NEVER-PUBLIC-CONTACT", str(self.buyer.account.pk) + "-token"):
            self.assertNotIn(secret, text)
        self.assertNotIn("phone", text.lower())


@override_settings(OWNER_MFA_REQUIRED=False)
class AftercareAdminTests(AftercareFixture, TestCase):
    def workspace(self, row):
        return f"/admin/orders/cancellationrequest/{row.pk}/review/"

    def test_root_workspace_is_private_readonly_and_lists_the_current_version(self):
        order = self.accept("advance")
        row = CancellationRequest.objects.get(pk=self.cancel(order)["request"])
        response = self.root_client.get(self.workspace(row))
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response["Cache-Control"].startswith("private, no-store"))
        self.assertContains(response, row.reason)
        self.assertNotContains(response, self.buyer.user.email)
        self.assertEqual(
            list(response.context["form"].fields),
            ["command_id", "version", "case_version", "action", "assigned_to", "reason"],
        )

    def test_admin_assignment_and_approval_use_the_same_sealed_service_path(self):
        order = self.accept("advance")
        row = CancellationRequest.objects.get(pk=self.cancel(order)["request"])
        assign = self.root_client.post(
            self.workspace(row),
            {
                "command_id": str(uuid.uuid4()),
                "action": "assign",
                "version": str(self.head(order)),
                "case_version": str(row.version),
                "reason": "Assigned through the native workspace",
                "assigned_to": str(self.root.user.pk),
            },
            HTTP_X_CSRFTOKEN=self.root_client.cookies["csrftoken"].value,
        )
        self.assertEqual(assign.status_code, 302)
        row.refresh_from_db()
        approved = self.root_client.post(
            self.workspace(row),
            {
                "command_id": str(uuid.uuid4()),
                "action": "approve",
                "version": str(self.head(order)),
                "case_version": str(row.version),
                "reason": "Approved through the native workspace",
            },
            HTTP_X_CSRFTOKEN=self.root_client.cookies["csrftoken"].value,
        )
        self.assertEqual(approved.status_code, 302)
        row.refresh_from_db()
        self.assertEqual(row.state, "approved")
        self.assertEqual(InvoiceAdjustment.objects.filter(order=order).count(), 1)
        self.assertEqual(
            list(
                AuditEvent.objects.filter(
                    resource_id=row.pk, resource_type="orders.cancellationrequest", action="aftercare_cancellation_workspace"
                ).values_list("context", flat=True)
            ),
            ["owner", "owner"],
        )

    def test_staff_without_aftercare_grants_see_and_reach_nothing(self):
        order = self.accept("advance")
        row = CancellationRequest.objects.get(pk=self.cancel(order)["request"])
        self.assertEqual(self.staff_client.get("/admin/orders/cancellationrequest/").status_code, 403)
        self.assertEqual(self.staff_client.get(self.workspace(row)).status_code, 404)
        self.assertEqual(self.staff_client.get(f"/admin/orders/amendment/{row.pk}/review/").status_code, 404)

    def test_assigned_staff_see_only_their_own_queue_and_cannot_edit_history(self):
        self.staff.user.groups.add(self.native_group("Cancellation review"))
        order = self.accept("advance")
        row = CancellationRequest.objects.get(pk=self.cancel(order)["request"])
        self.assertEqual(self.staff_client.get("/admin/orders/cancellationrequest/").status_code, 200)
        self.assertEqual(list(self.staff_client.get("/admin/orders/cancellationrequest/").context["cl"].result_list), [])
        self.decide(row, "assign", actor=self.root, assigned_to=self.staff.user.pk)
        rows = self.staff_client.get("/admin/orders/cancellationrequest/").context["cl"].result_list
        self.assertEqual([x.pk for x in rows], [row.pk])
        denied = self.staff_client.post(
            f"/admin/orders/cancellationrequest/{row.pk}/change/",
            {"state": "approved", "reason": "Direct edit attempt", "order": str(order.pk), "version": "9"},
            HTTP_X_CSRFTOKEN=self.staff_client.cookies["csrftoken"].value,
        )
        self.assertEqual(denied.status_code, 403)
        deleted = self.staff_client.post(
            f"/admin/orders/cancellationrequest/{row.pk}/delete/",
            {"post": "yes"},
            HTTP_X_CSRFTOKEN=self.staff_client.cookies["csrftoken"].value,
        )
        self.assertEqual(deleted.status_code, 403)
        self.assertEqual(CancellationRequest.objects.get(pk=row.pk).state, "pending")
        self.assertFalse(CancellationDecision.objects.filter(request=row).exists())

    def test_assignment_staff_can_assign_an_unassigned_linked_hold_but_cannot_decide(self):
        assignment = self.connected("staff", "aftercare-assignment-only", group=self.native_group("Aftercare assignment"))[0]
        reviewer = self.connected("staff", "aftercare-independent-review", group=self.native_group("Cancellation review"))[0]
        order = self.accept("cod")
        row = CancellationRequest.objects.get(pk=self.cancel(order)["request"])
        self.decide(row, "assign", actor=assignment, assigned_to=reviewer.user.pk)
        row.refresh_from_db()
        hold = delivery.ReviewCase.objects.get(blocker=row.blocker)
        self.assertEqual((row.assigned_to_id, hold.assigned_to_id), (reviewer.user.pk, reviewer.user.pk))
        with self.assertRaises(PermissionDenied):
            self.decide(row, "approve", actor=assignment)
        self.decide(row, "reject", actor=reviewer)
        self.assertEqual(delivery.ReviewCase.objects.get(pk=hold.pk).state, "resolved")
        self.assertEqual(CancellationDecision.objects.get(request=row).action, "rejected")

    def test_role_setup_command_defines_groups_without_assigning_any_user(self):
        from django.contrib.auth.models import Group

        self.assertFalse(Group.objects.filter(name__startswith="Rezayi: ").exists())
        call_command("setup_aftercare_groups")
        names = sorted(Group.objects.filter(name__startswith="Rezayi: ").values_list("name", flat=True))
        self.assertEqual(len(names), 7)
        self.assertEqual(
            set(
                Permission.objects.filter(
                    group__name__in=names, content_type__app_label="orders"
                ).values_list("codename", flat=True)
            ),
            {"read_aftercare", "assign_aftercare", "decide_cancellation", "decide_amendment"},
        )
        self.assertEqual(
            set(
                Permission.objects.filter(group__name__in=names, content_type__app_label="fulfilment").values_list(
                    "codename", flat=True
                )
            ),
            {
                "read_fulfilment",
                "assign_fulfilment",
                "manage_delivery_holds",
                "record_delivery_refund",
                "confirm_delivery_refund",
                "read_delivery_evidence",
            },
        )
        self.assertEqual(list(User.objects.filter(groups__name__in=names)), [])
        call_command("setup_aftercare_groups")
        self.assertEqual(sorted(Group.objects.filter(name__startswith="Rezayi: ").values_list("name", flat=True)), names)

@override_settings(OWNER_MFA_REQUIRED=False)
class AftercareConcurrencyTests(AftercareFixture, TransactionTestCase):
    def parallel(self, functions):
        gate = Barrier(len(functions))

        def run(function):
            connections.close_all()
            try:
                gate.wait(timeout=15)
                return function()
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=len(functions)) as pool:
            futures = [pool.submit(run, function) for function in functions]
            return [future.result(timeout=60) for future in futures]

    def competing(self, function):
        """Only a documented stale packet is an acceptable losing command."""
        try:
            return function()
        except (Conflict, ValidationError) as error:
            return error

    def test_the_same_cancellation_command_from_two_workers_creates_one_request(self):
        order = self.accept("advance")
        packet = {"command_id": uuid.uuid4(), "version": 0, "reason": "Synthetic cancellation request"}

        def submit():
            return cancellations.mutate(self.buyer, order.pk, "request", packet)

        results = self.parallel([submit, submit])
        self.assertEqual(results[0], results[1])
        self.assertEqual(results[0]["request"], str(CancellationRequest.objects.get(order=order).pk))
        self.assertEqual(AftercareCommand.objects.filter(order=order).count(), 1)
        self.assertEqual(AftercareEvent.objects.filter(order=order).count(), 1)
        self.assertEqual(delivery.Blocker.objects.filter(order=order).count(), 1)

    def test_pending_cancellation_always_wins_against_concurrent_dispatch(self):
        from apps.fulfilment import services

        order = self.accept("cod")
        self.prepare(order)
        row = CancellationRequest.objects.get(pk=self.cancel(order)["request"])
        self.assign(row)
        packet = self.dispatch_packet(order)
        before = self.inventory_state()
        outcomes = self.parallel([
            lambda: self.decide(row, "approve"),
            lambda: self.competing(lambda: services.mutate(self.seller, order.pk, "dispatch", packet)),
        ])
        self.assertEqual(outcomes[0]["state"], "approved")
        if isinstance(outcomes[1], dict):
            self.assertEqual((outcomes[1]["state"], outcomes[1]["code"]), ("blocked", "cancellation_hold"))
        else:
            self.assertIsInstance(outcomes[1], (Conflict, ValidationError))
        self.assertFalse(delivery.Shipment.objects.filter(order=order).exists())
        self.assertFalse(delivery.Completion.objects.filter(order=order).exists())
        self.assertEqual(CancellationDecision.objects.filter(request=row, action="approved").count(), 1)
        self.assertEqual(InvoiceAdjustment.objects.filter(order=order).count(), 1)
        self.assertEqual(self.inventory_state(), before)

    def test_concurrent_excess_due_and_cancellation_partition_received_money(self):
        order = self.accept("cod")
        self.receipt(order, "15.00")
        row = CancellationRequest.objects.get(pk=self.cancel(order)["request"])
        self.assign(row)
        outcomes = self.parallel([
            lambda: self.competing(lambda: self.due(order, "2.50")),
            lambda: self.decide(row, "approve"),
        ])
        self.assertEqual(outcomes[1]["state"], "approved")
        self.assertEqual(sum(x.amount for x in RefundDue.objects.filter(order=order)), Decimal("15.00"))
        self.assertEqual(RefundDue.objects.filter(order=order, cause="cancellation").count(), 1)
        self.assertEqual(RefundSeal.objects.count(), RefundDue.objects.count())
        self.assertEqual(RefundReport.objects.count(), 0)
        self.assertEqual(pay.confirmed(order), Decimal("15.00"))

    def test_same_amendment_approval_race_replays_one_reduction_and_adjustment(self):
        order = self.reserved(self.accept("advance"))
        row = Amendment.objects.get(pk=self.propose(order, [(OrderLine.objects.get(order=order), "0.500")])["amendment"])
        self.amend(row, "assign", assigned_to=self.root.user.pk)
        row.refresh_from_db()
        packet = {
            "command_id": uuid.uuid4(), "version": self.head(order), "amendment_version": row.version,
            "action": "approve", "reason": "Concurrent independent amendment approval",
        }
        def submit():
            return amendments.decide(self.root, row.pk, packet)

        results = self.parallel([submit, submit])
        self.assertEqual(results[0], results[1])
        self.assertEqual(AllocationReduction.objects.count(), 1)
        self.assertEqual(InvoiceAdjustment.objects.count(), 1)
        self.assertEqual(RefundDue.objects.get().amount, Decimal("6.25"))
        self.assertEqual(Bucket.objects.get().held, Decimal("0.500"))

    def test_same_refund_confirmation_race_retains_one_confirmation(self):
        order = self.accept("cod")
        self.receipt(order, "15.00")
        due = RefundDue.objects.get(pk=self.due(order, "2.50")["refund_due"])
        self.report(order, due)
        self.refund(due, "assign", assigned_to=self.root.user.pk)
        due.refresh_from_db()
        packet = {
            "command_id": uuid.uuid4(), "version": self.finance(order), "due_version": due.version,
            "action": "confirm", "reason": "Concurrent independent refund confirmation",
        }
        def submit():
            return refunds.decide(self.root, due.pk, packet)

        results = self.parallel([submit, submit])
        self.assertEqual(results[0], results[1])
        self.assertEqual(RefundDecision.objects.filter(action="confirmed").count(), 1)
        self.assertEqual(refunds.refunded_total(order), Decimal("2.50"))
        self.assertEqual(pay.confirmed(order), Decimal("15.00"))

    def test_withdrawal_and_approval_race_retains_only_one_terminal_outcome(self):
        order = self.reserved(self.accept("advance"))
        row = CancellationRequest.objects.get(pk=self.cancel(order)["request"])
        self.assign(row)
        row.refresh_from_db()
        version = self.head(order)
        withdrawal = {"command_id": uuid.uuid4(), "version": version, "request": str(row.pk), "reason": "Concurrent withdrawal"}
        approval = {
            "command_id": uuid.uuid4(), "version": version, "request_version": row.version,
            "action": "approve", "reason": "Concurrent independent approval",
        }
        outcomes = self.parallel([
            lambda: self.competing(lambda: cancellations.mutate(self.buyer, order.pk, "withdraw", withdrawal)),
            lambda: self.competing(lambda: cancellations.decide(self.root, row.pk, approval)),
        ])
        self.assertEqual(sum(isinstance(result, dict) for result in outcomes), 1)
        self.assertEqual(sum(isinstance(result, ValidationError) for result in outcomes), 1)
        row.refresh_from_db()
        self.assertIn(row.state, ("approved", "withdrawn"))
        approved = row.state == "approved"
        self.assertEqual(CancellationDecision.objects.filter(request=row).count(), int(approved))
        self.assertEqual(InvoiceAdjustment.objects.filter(order=order).count(), int(approved))
        self.assertEqual(RefundDue.objects.filter(order=order).count(), int(approved))
        self.assertEqual(Operation.objects.filter(action="release").count(), int(approved))
        self.assertEqual(Bucket.objects.get().held, Decimal("0.000") if approved else Decimal("1.000"))
        self.assertEqual(delivery.BlockerClosure.objects.filter(blocker_id=row.blocker_id).count(), int(approved))


@override_settings(OWNER_MFA_REQUIRED=False)
class AftercareReadAuthorityTests(AftercareFixture, TestCase):
    def test_empty_reads_never_initialize_finance_aftercare_or_delivery(self):
        order = self.accept("cod")
        before = self.domain_state()
        for context, client in (("buyer", self.buyer_client), ("seller", self.seller_client)):
            for path in (f"orders/{context}/aftercare/", f"orders/{context}/cancellations/", f"orders/{context}/aftercare/{order.pk}/"):
                with self.subTest(path=path):
                    response = self.post(client, path, {}, method="get")
                    self.assertEqual(response.status_code, 200)
                    if path.endswith(f"/{order.pk}/"):
                        self.assertEqual(response.json()["version"], 0)
                        self.assertEqual(response.json()["capabilities"], ["cancel", "amend"] if context == "seller" else ["cancel"])
                        self.assertEqual(response.json()["effective_lines"][0]["quantity"], "1.000")
        self.assertEqual(self.domain_state(), before)
        self.assertFalse(Aftercare.objects.exists())
        self.assertFalse(Finance.objects.exists())
        self.assertFalse(delivery.State.objects.exists())

    def test_pending_history_reads_and_head_preserve_all_domain_rows(self):
        order = self.accept("cod")
        row = CancellationRequest.objects.get(pk=self.cancel(order)["request"])
        before = self.domain_state()
        for method in ("get", "head"):
            for path in (f"orders/buyer/aftercare/{order.pk}/", f"orders/buyer/cancellations/{row.pk}/"):
                with self.subTest(method=method, path=path):
                    response = self.post(self.buyer_client, path, {}, method=method)
                    self.assertEqual(response.status_code, 200)
                    self.assertIn("no-store", response["Cache-Control"])
        self.assertEqual(self.domain_state(), before)

    def test_unknown_command_get_and_head_never_create_an_absence_fence(self):
        order = self.accept("cod")
        key = uuid.uuid4()
        before = self.domain_state()
        path = f"orders/buyer/orders/{order.pk}/aftercare-commands/{key}/"
        response = self.post(self.buyer_client, path, {}, method="get")
        self.assertEqual(response.json(), {"state": "unknown", "result": None})
        self.assertEqual(self.post(self.buyer_client, path, {}, method="head").status_code, 200)
        self.assertEqual(self.domain_state(), before)

    def test_foreign_request_details_are_hidden_without_domain_effects(self):
        order = self.accept("cod")
        row = CancellationRequest.objects.get(pk=self.cancel(order)["request"])
        before = self.domain_state()
        response = self.post(self.other_client, f"orders/buyer/cancellations/{row.pk}/", {}, method="get")
        self.assertEqual(response.status_code, 404)
        self.assertNotIn(row.reason, str(response.content))
        self.assertEqual(self.domain_state(), before)

    def test_marketplace_read_routes_refuse_mutating_http_methods(self):
        order = self.accept("cod")
        row = CancellationRequest.objects.get(pk=self.cancel(order)["request"])
        before = self.domain_state()
        for method in ("post", "put", "patch", "delete"):
            for path in ("orders/buyer/aftercare/", f"orders/buyer/cancellations/{row.pk}/"):
                with self.subTest(method=method, path=path):
                    response = self.post(self.buyer_client, path, {"state": "approved"}, method=method)
                    self.assertEqual(response.status_code, 405)
        self.assertEqual(self.domain_state(), before)

    def test_staff_and_owner_have_no_marketplace_aftercare_adapter(self):
        order = self.accept("cod")
        before = self.domain_state()
        for context, client in (("staff", self.staff_client), ("owner", self.root_client)):
            response = self.post(client, f"orders/{context}/aftercare/{order.pk}/", {}, method="get")
            self.assertEqual(response.status_code, 404)
        self.assertEqual(self.domain_state(), before)

    def test_buyer_cannot_submit_a_staff_cancellation_decision_over_rest(self):
        order = self.accept("cod")
        row = CancellationRequest.objects.get(pk=self.cancel(order)["request"])
        before = self.domain_state()
        response = self.post(
            self.buyer_client, f"orders/buyer/cancellations/{row.pk}/approve/",
            {"command_id": str(uuid.uuid4()), "version": self.head(order), "action": "approve"},
        )
        self.assertEqual(response.status_code, 404)
        self.assertEqual(self.domain_state(), before)

    def test_cancellation_and_absence_fencing_require_csrf(self):
        order = self.accept("cod")
        before = self.domain_state()
        for path, body in (
            (f"orders/buyer/orders/{order.pk}/cancellations/", {"command_id": str(uuid.uuid4()), "version": 0, "reason": "CSRF probe"}),
            (f"orders/buyer/orders/{order.pk}/aftercare-commands/{uuid.uuid4()}/reconcile/", {}),
        ):
            response = self.buyer_client.post("/api/v1/" + path, body, format="json")
            self.assertEqual(response.status_code, 403)
        self.assertEqual(self.domain_state(), before)

    def test_unknown_and_duplicate_query_fields_are_refused_without_mutation(self):
        order = self.accept("cod")
        self.cancel(order)
        before = self.domain_state()
        for suffix in ("?page=0", "?page=1&page=2", "?state=approved", "?limit=1000"):
            with self.subTest(suffix=suffix):
                response = self.buyer_client.get("/api/v1/orders/buyer/aftercare/" + suffix)
                self.assertEqual(response.status_code, 400)
        self.assertEqual(self.domain_state(), before)

    def test_command_lookup_is_bound_to_actor_even_for_the_same_order(self):
        order = self.accept("cod")
        key = uuid.uuid4()
        self.cancel(order, key=key)
        before = self.domain_state()
        response = self.post(
            self.seller_client, f"orders/seller/orders/{order.pk}/aftercare-commands/{key}/", {}, method="get",
        )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.domain_state(), before)


@override_settings(OWNER_MFA_REQUIRED=False)
class AftercareWithdrawalTests(AftercareFixture, TestCase):
    def company_order(self):
        from apps.catalogue.models import Variant

        self.profile = self.company("aftercare-company")
        self.variant = Variant.objects.get(product=self.product)
        orders.set_terms(self.seller, self.profile.pk, {
            "version": 0, "enabled": True, "destinations": [{"country": "AF", "all_cities": True, "cities": []}],
            "methods": ["advance", "cod"], "reason": "Synthetic company checkout terms",
        })
        self.seed_stock(self.variant)
        return self.accept("cod")

    def member(self, order):
        from apps.organizations.models import Membership

        actor, client = self.connected("seller", "aftercare-member")
        membership = Membership.objects.create(
            company=order.seller, account=actor.account, bundles=["orders_negotiation", "payments_refunds"],
        )
        return actor, client, membership

    def test_buyer_cannot_withdraw_the_sellers_cancellation(self):
        order = self.accept("cod")
        row = CancellationRequest.objects.get(pk=self.cancel(order, actor=self.seller)["request"])
        before = self.domain_state()
        with self.assertRaises(Http404):
            self.withdraw(order, row, actor=self.buyer)
        self.assertEqual(self.domain_state(), before)
        self.assertEqual(self.withdraw(order, row, actor=self.seller)["state"], "withdrawn")

    def test_company_owner_cannot_withdraw_another_members_cancellation(self):
        order = self.company_order()
        actor, _, _ = self.member(order)
        row = CancellationRequest.objects.get(pk=self.cancel(order, actor=actor)["request"])
        before = self.domain_state()
        self.assertFalse(aftercare_queries.cancellation_detail(self.seller, row.pk)["can_withdraw"])
        self.assertTrue(aftercare_queries.cancellation_detail(actor, row.pk)["can_withdraw"])
        with self.assertRaises(Http404):
            self.withdraw(order, row, actor=self.seller)
        self.assertEqual(self.domain_state(), before)
        self.assertEqual(self.withdraw(order, row, actor=actor)["state"], "withdrawn")

    def test_company_owner_cannot_withdraw_another_members_amendment(self):
        order = self.company_order()
        actor, _, _ = self.member(order)
        row = Amendment.objects.get(pk=self.propose(order, [(OrderLine.objects.get(order=order), "0.500")], actor=actor)["amendment"])
        packet = {"command_id": uuid.uuid4(), "version": self.head(order), "amendment": str(row.pk), "reason": "Owner is not proposer"}
        before = self.domain_state()
        with self.assertRaises(Http404):
            amendments.mutate(self.seller, order.pk, "withdraw", packet)
        self.assertEqual(self.domain_state(), before)
        self.assertEqual(amendments.mutate(actor, order.pk, "withdraw", packet)["state"], "withdrawn")

    def test_company_owner_cannot_withdraw_another_members_refund_report(self):
        order = self.company_order()
        actor, _, _ = self.member(order)
        self.receipt(order, "15.00")
        due = RefundDue.objects.get(pk=self.due(order, "2.50")["refund_due"])
        report = self.report(order, due, actor=actor)["report"]
        packet = {"command_id": uuid.uuid4(), "version": self.finance(order), "report": report, "reason": "Owner is not reporter"}
        before = self.domain_state()
        with self.assertRaises(Http404):
            refunds.mutate(self.seller, order.pk, "refund_withdraw", packet)
        self.assertEqual(self.domain_state(), before)
        self.assertEqual(refunds.mutate(actor, order.pk, "refund_withdraw", packet)["state"], "withdrawn")

    def test_revoked_company_membership_denies_withdrawal_and_preserves_hold(self):
        from apps.organizations.models import Membership

        order = self.company_order()
        actor, _, membership = self.member(order)
        row = CancellationRequest.objects.get(pk=self.cancel(order, actor=actor)["request"])
        Membership.objects.filter(pk=membership.pk).update(active=False)
        before = self.domain_state()
        with self.assertRaises(Http404):
            self.withdraw(order, row, actor=actor)
        self.assertEqual(self.domain_state(), before)
        self.assertTrue(delivery_queries.active_blockers(order).filter(pk=row.blocker_id).exists())

    def test_cancellation_withdrawal_replays_after_terminal_state_without_new_history(self):
        order = self.accept("cod")
        row = CancellationRequest.objects.get(pk=self.cancel(order)["request"])
        packet = {"command_id": uuid.uuid4(), "version": self.head(order), "request": str(row.pk), "reason": "Retained withdrawal"}
        first = cancellations.mutate(self.buyer, order.pk, "withdraw", packet)
        before = self.domain_state()
        self.assertEqual(cancellations.mutate(self.buyer, order.pk, "withdraw", packet), first)
        with self.assertRaises(Conflict):
            cancellations.mutate(self.buyer, order.pk, "withdraw", {**packet, "reason": "Changed withdrawal"})
        self.assertEqual(self.domain_state(), before)

    def test_amendment_withdrawal_seals_its_own_action_and_replays(self):
        order = self.accept("cod")
        row = Amendment.objects.get(pk=self.propose(order, [(OrderLine.objects.get(order=order), "0.500")])["amendment"])
        packet = {"command_id": uuid.uuid4(), "version": self.head(order), "amendment": str(row.pk), "reason": "Retained amendment withdrawal"}
        first = amendments.mutate(self.seller, order.pk, "withdraw", packet)
        command = AftercareCommand.objects.get(pk=packet["command_id"])
        self.assertEqual((command.action, command.event.action), ("amendment_withdraw", "amendment_withdrawn"))
        before = self.domain_state()
        self.assertEqual(amendments.mutate(self.seller, order.pk, "withdraw", packet), first)
        self.assertEqual(self.domain_state(), before)
        self.assertFalse(AmendmentDecision.objects.exists())
        self.assertFalse(InvoiceAdjustment.objects.exists())

    def test_stale_withdrawal_cannot_erase_a_new_assignment(self):
        order = self.accept("cod")
        row = CancellationRequest.objects.get(pk=self.cancel(order)["request"])
        version = self.head(order)
        self.assign(row)
        before = self.domain_state()
        with self.assertRaises(ValidationError) as refused:
            cancellations.mutate(self.buyer, order.pk, "withdraw", {
                "command_id": uuid.uuid4(), "version": version, "request": str(row.pk), "reason": "Stale withdrawal",
            })
        self.assertEqual(refused.exception.detail["cancellation"], ["cancellation_stale_version"])
        self.assertEqual(self.domain_state(), before)


@override_settings(OWNER_MFA_REQUIRED=False)
class CumulativeAmendmentTests(AftercareFixture, TestCase):
    def two_lines(self):
        from apps.organizations.models import BusinessProfile
        from apps.verification.models import ReviewCase

        profile = BusinessProfile.objects.create(account=self.buyer.account, kind="business", display_name="Synthetic trade buyer")
        ReviewCase.objects.create(profile=profile, status="approved", snapshot={"display_name": "Reviewed trade buyer"})
        self.add(tier="retail", quantity="1.000")
        self.add(tier="wholesale", quantity="2.000")
        orders.submit(self.buyer, self.packet("cod"))
        order = SellerOrder.objects.latest("accepted_at")
        return order, OrderLine.objects.get(order=order, tier="retail"), OrderLine.objects.get(order=order, tier="wholesale")

    def chain(self):
        order, retail, wholesale = self.two_lines()
        first = Amendment.objects.get(pk=self.propose(order, [(retail, "0.500")])["amendment"])
        self.approve_amendment(first)
        second = Amendment.objects.get(pk=self.propose(order, [(wholesale, "1.000")])["amendment"])
        self.approve_amendment(second)
        return order, retail, wholesale, first, second

    def test_sparse_second_amendment_preserves_the_first_lines_reduction(self):
        order, retail, wholesale, first, second = self.chain()
        effective = {item["line"].pk: (item["quantity"], item["unit_price"]) for item in projection.effective_lines(order)}
        self.assertEqual(effective, {
            retail.pk: (Decimal("0.500"), Decimal("12.50")),
            wholesale.pk: (Decimal("1.000"), Decimal("10.00")),
        })
        self.assertEqual((first.lines.count(), second.lines.count()), (1, 1))
        self.assertEqual(projection.accepted_total(order), Decimal("16.25"))
        retail.refresh_from_db()
        wholesale.refresh_from_db()
        self.assertEqual((retail.quantity, wholesale.quantity, order.goods_total), (Decimal("1.000"), Decimal("2.000"), Decimal("32.50")))

    def test_successive_adjustments_form_an_exact_before_after_chain(self):
        order, _, _, first, second = self.chain()
        previous = InvoiceAdjustment.objects.get(amendment=first)
        current = InvoiceAdjustment.objects.get(amendment=second)
        self.assertEqual(previous.after_lines, current.before_lines)
        self.assertEqual((previous.before_total, previous.after_total, current.before_total, current.after_total), (
            Decimal("32.50"), Decimal("26.25"), Decimal("26.25"), Decimal("16.25"),
        ))
        self.assertEqual((previous.invoice_id, current.invoice_id), (order.invoice.pk, order.invoice.pk))

    def test_cumulative_demand_aggregates_retail_and_wholesale_by_uuid(self):
        from apps.fulfilment.selection import demand, plan

        order, _, _, _, _ = self.chain()
        self.assertEqual(demand(order), {self.variant.pk: Decimal("1.500")})
        rows = plan(order, [{"variant": str(self.variant.pk), "batch": None, "quantity": "1.500"}])
        self.assertEqual([(bucket.position_id, quantity) for bucket, quantity in rows], [(self.variant.pk, Decimal("1.500"))])
        with self.assertRaises(ValidationError):
            plan(order, [{"variant": str(self.variant.pk), "batch": None, "quantity": "2.000"}])

    def test_cancel_after_sparse_amendments_snapshots_all_effective_lines(self):
        order, _, _, _, second = self.chain()
        latest = InvoiceAdjustment.objects.get(amendment=second)
        row = CancellationRequest.objects.get(pk=self.cancel(order)["request"])
        self.approve(row)
        adjustment = InvoiceAdjustment.objects.get(cancellation=row)
        self.assertEqual(adjustment.before_lines, latest.after_lines)
        self.assertEqual((adjustment.before_total, adjustment.after_total, adjustment.after_lines), (Decimal("16.25"), ZERO, []))
        self.assertEqual(projection.accepted_total(order), ZERO)
        self.assertEqual(OrderLine.objects.filter(order=order).count(), 2)

    def test_annotated_and_unannotated_projection_agree_after_a_chain(self):
        order, _, _, _, _ = self.chain()
        self.receipt(order, "20.00")
        annotated = projection.annotate(SellerOrder.objects.filter(pk=order.pk)).get()
        expected = {"received": "20.00", "refunded": "0.00", "refund_due": "0.00", "remaining": "0.00", "excess": "3.75"}
        self.assertEqual(projection.money_figures(order, pay.confirmed(order)), expected)
        self.assertEqual(projection.money_figures(annotated, pay.confirmed(annotated)), expected)
        self.assertEqual(projection.accepted_total(annotated), Decimal("16.25"))

    def test_later_pending_and_rejected_changes_never_overlay_approved_values(self):
        order, retail, _, _, _ = self.chain()
        row = Amendment.objects.get(pk=self.propose(order, [(retail, "0.250", "11.00")])["amendment"])
        before = projection.before_lines_snapshot(order)
        self.assertEqual(projection.accepted_total(order), Decimal("16.25"))
        self.reject_amendment(row)
        self.assertEqual(projection.before_lines_snapshot(order), before)
        self.assertEqual(projection.accepted_total(order), Decimal("16.25"))
        self.assertEqual(InvoiceAdjustment.objects.filter(order=order).count(), 2)

    def test_sequential_reserved_reductions_release_only_the_new_difference(self):
        order = self.reserved(self.accept("advance"))
        line = OrderLine.objects.get(order=order)
        first = Amendment.objects.get(pk=self.propose(order, [(line, "0.500")])["amendment"])
        self.approve_amendment(first)
        second = Amendment.objects.get(pk=self.propose(order, [(line, "0.250")])["amendment"])
        self.approve_amendment(second)
        self.assertEqual(sorted(AllocationReduction.objects.values_list("quantity", flat=True)), [Decimal("0.250"), Decimal("0.500")])
        self.assertEqual((Bucket.objects.get().physical, Bucket.objects.get().held), (Decimal("100.000"), Decimal("0.250")))
        self.assertEqual(AllocationLine.objects.get().quantity, Decimal("1.000"))
        movements = Movement.objects.filter(operation__action="reduce")
        self.assertEqual(sum(movements.values_list("held_delta", flat=True)), Decimal("-0.750"))
        self.assertEqual(StockTransition.objects.filter(movement__in=movements, pending=False).count(), 2)

    def test_successive_amendments_due_only_the_incremental_overpayment(self):
        order = self.reserved(self.accept("advance"))
        line = OrderLine.objects.get(order=order)
        first = Amendment.objects.get(pk=self.propose(order, [(line, "0.500")])["amendment"])
        self.approve_amendment(first)
        second = Amendment.objects.get(pk=self.propose(order, [(line, "0.250")])["amendment"])
        outcome = self.approve_amendment(second)
        self.assertEqual(RefundDue.objects.get(pk=outcome["refund_due"]).amount, Decimal("3.12"))
        self.assertEqual(refunds.due_total(order), Decimal("9.37"))
        self.assertEqual(projection.money_figures(order, pay.confirmed(order))["refund_due"], "9.37")

    def test_valid_fractional_increment_and_half_up_rounding_are_exact(self):
        order = self.accept("cod")
        line = OrderLine.objects.get(order=order)
        self.assertEqual(self.variant.quantity_increment, Decimal("0.125"))
        row = Amendment.objects.get(pk=self.propose(order, [(line, "0.125")])["amendment"])
        self.assertEqual(row.after_total, Decimal("1.56"))
        self.reject_amendment(row)
        replacement = Amendment.objects.get(pk=self.propose(order, [(line, "0.250")])["amendment"])
        self.approve_amendment(replacement)
        self.assertEqual(projection.accepted_total(order), Decimal("3.13"))
        self.assertEqual(InvoiceAdjustment.objects.get().after_lines[0]["goods_amount"], "3.13")

    def test_unit_prices_reject_floats_exponents_overprecision_and_zero(self):
        order = self.accept("cod")
        line = OrderLine.objects.get(order=order)
        before = self.domain_state()
        for price in (12.0, Decimal("12.00"), "1.2e1", "12.001", "NaN", "Infinity", "0.00", "-1.00"):
            with self.subTest(price=price), self.assertRaises(ValidationError):
                self.propose(order, [(line, "0.500", price)])
        self.assertEqual(self.domain_state(), before)


@override_settings(OWNER_MFA_REQUIRED=False)
class RefundLifecycleInvariantTests(AftercareFixture, TestCase):
    def pending_refund(self):
        order = self.accept("cod")
        self.receipt(order, "15.00")
        due = RefundDue.objects.get(pk=self.due(order, "2.50")["refund_due"])
        return order, due

    def test_refund_report_keeps_an_offset_timestamp_as_the_same_instant(self):
        order, due = self.pending_refund()
        instant = (timezone.now() - timedelta(minutes=3)).astimezone(datetime_timezone(timedelta(hours=4, minutes=30)))
        outcome = self.report(order, due, sent_at=instant)
        report = RefundReport.objects.get(pk=outcome["report"])
        self.assertEqual(report.sent_at, instant.astimezone(datetime_timezone.utc))
        self.assertTrue(timezone.is_aware(report.sent_at))
        self.assertEqual(report.amount, Decimal("2.50"))
        self.assertEqual(refunds.refunded_total(order), ZERO)

    def test_refund_api_rejects_naive_time_instead_of_inventing_a_timezone(self):
        order, due = self.pending_refund()
        before = self.domain_state()
        response = self.post(self.seller_client, f"payments/seller/orders/{order.pk}/refund-reports/", {
            "command_id": str(uuid.uuid4()), "version": self.finance(order), "due": str(due.pk), "amount": "2.50",
            "sent_at": (timezone.now() - timedelta(minutes=2)).replace(tzinfo=None).isoformat(),
            "reference": "SYNTHETIC-NAIVE-TIME", "description": "Timezone must be explicit",
        })
        self.assertEqual(response.status_code, 400)
        self.assertIn({"path": "sent_at", "code": "aware_required"}, response.json()["error"]["violations"])
        self.assertEqual(self.domain_state(), before)

    def test_refund_money_representation_is_not_coerced_or_rounded(self):
        order, due = self.pending_refund()
        before = self.domain_state()
        for amount in (2.5, "2.5", "2.500", "2.50e0", "NaN", "-2.50", "0.00"):
            with self.subTest(amount=amount), self.assertRaises(ValidationError):
                self.report(order, due, amount=amount)
        self.assertEqual(self.domain_state(), before)

    def test_confirmation_without_actual_report_never_marks_money_refunded(self):
        order, due = self.pending_refund()
        self.refund(due, "assign", assigned_to=self.root.user.pk)
        before = self.domain_state()
        with self.assertRaises(Conflict):
            self.refund(due, "confirm")
        self.assertEqual(self.domain_state(), before)
        self.assertEqual(refunds.refunded_total(order), ZERO)
        self.assertEqual(projection.money_figures(order, pay.confirmed(order))["refund_due"], "2.50")

    def test_rejection_retains_due_and_replacement_confirmation_counts_only_once(self):
        order, due = self.pending_refund()
        first = RefundReport.objects.get(pk=self.report(order, due)["report"])
        self.refund(due, "assign", assigned_to=self.root.user.pk)
        self.refund(due, "reject")
        self.assertEqual((refunds.refunded_total(order), refunds.due_total(order)), (ZERO, Decimal("2.50")))
        second = RefundReport.objects.get(pk=self.report(order, due, previous=str(first.pk), reference="SYNTHETIC-CORRECTED")["report"])
        reviewer, _ = self.connected("owner", "independent-replacement-refund-reviewer")
        self.refund(due, "assign", assigned_to=reviewer.user.pk)
        self.refund(due, "confirm", actor=reviewer)
        self.assertEqual(second.previous_id, first.pk)
        self.assertEqual(RefundDecision.objects.get(report=first).action, "rejected")
        self.assertEqual(RefundDecision.objects.get(report=second).action, "confirmed")
        self.assertEqual((refunds.refunded_total(order), pay.confirmed(order)), (Decimal("2.50"), Decimal("15.00")))

    def test_replacement_cannot_branch_from_a_nonlatest_report(self):
        order, due = self.pending_refund()
        first = self.report(order, due)["report"]
        refunds.mutate(self.seller, order.pk, "refund_withdraw", {
            "command_id": uuid.uuid4(), "version": self.finance(order), "report": first, "reason": "First withdrawal",
        })
        second = self.report(order, due, previous=first)["report"]
        refunds.mutate(self.seller, order.pk, "refund_withdraw", {
            "command_id": uuid.uuid4(), "version": self.finance(order), "report": second, "reason": "Second withdrawal",
        })
        before = self.domain_state()
        with self.assertRaises(ValidationError) as refused:
            self.report(order, due, previous=first)
        self.assertEqual(refused.exception.detail["previous"], ["latest_report"])
        self.assertEqual(self.domain_state(), before)

    def test_due_version_and_finance_version_independently_fence_confirmation(self):
        order, due = self.pending_refund()
        self.report(order, due)
        self.refund(due, "assign", assigned_to=self.root.user.pk)
        due.refresh_from_db()
        current = {"command_id": uuid.uuid4(), "version": self.finance(order), "due_version": due.version, "action": "confirm", "reason": "Stale confirmation probe"}
        before = self.domain_state()
        for overrides in ({"version": current["version"] - 1}, {"due_version": due.version - 1}):
            with self.subTest(overrides=overrides), self.assertRaises(Conflict):
                refunds.decide(self.root, due.pk, {**current, **overrides})
        self.assertEqual(self.domain_state(), before)
        self.assertEqual(refunds.decide(self.root, due.pk, current)["state"], "confirmed")
        self.assertEqual(RefundDue.objects.get(pk=due.pk).version, due.version + 1)

    def test_completed_order_allows_excess_refund_without_reopening_completion(self):
        order = self.completed("15.00")
        completion = list(delivery.Completion.objects.filter(order=order).values())
        stock = self.inventory_state()
        invoice = list(Invoice.objects.filter(order=order).values())
        due = RefundDue.objects.get(pk=self.due(order, "2.50")["refund_due"])
        self.report(order, due)
        self.confirm_refund(due)
        self.assertEqual(delivery_queries.dimensions(order)["completion"], "completed")
        self.assertEqual(list(delivery.Completion.objects.filter(order=order).values()), completion)
        self.assertEqual(list(Invoice.objects.filter(order=order).values()), invoice)
        self.assertEqual(self.inventory_state(), stock)
        self.assertEqual(projection.money_figures(order, pay.confirmed(order)), {
            "received": "15.00", "refunded": "2.50", "refund_due": "0.00", "remaining": "0.00", "excess": "2.50",
        })


@override_settings(OWNER_MFA_REQUIRED=False)
class AftercareNativeInvariantTests(AftercareFixture, TestCase):
    def guard_rejects(self, statement, arguments):
        with self.assertRaises(DatabaseError) as refused, transaction.atomic(), connection.cursor() as cursor:
            cursor.execute(statement, arguments)
        # MariaDB SIGNAL, not an unknown column, syntax error, duplicate key or FK failure.
        self.assertEqual(refused.exception.args[0], 1644)

    def test_aftercare_head_cannot_advance_without_a_witnessing_event(self):
        order = self.accept("cod")
        self.cancel(order)
        before = self.domain_state()
        self.guard_rejects("UPDATE orders_aftercare SET version=version+1 WHERE order_id=%s", [order.pk.hex])
        self.assertEqual(self.domain_state(), before)

    def test_pending_request_cannot_be_withdrawn_by_raw_status_edit(self):
        order = self.accept("cod")
        row = CancellationRequest.objects.get(pk=self.cancel(order)["request"])
        before = self.domain_state()
        self.guard_rejects(
            "UPDATE orders_cancellationrequest SET state='withdrawn',version=version+1 WHERE id=%s", [row.pk.hex],
        )
        self.assertEqual(self.domain_state(), before)

    def test_command_replay_result_and_identity_are_database_immutable(self):
        order = self.accept("cod")
        key = uuid.uuid4()
        self.cancel(order, key=key)
        before = self.domain_state()
        for statement, arguments in (
            ("UPDATE orders_aftercarecommand SET result=JSON_OBJECT('state','approved') WHERE id=%s", [key.hex]),
            ("UPDATE orders_aftercarecommand SET actor_id=%s WHERE id=%s", [self.root.user.pk.hex, key.hex]),
            ("DELETE FROM orders_aftercarecommand WHERE id=%s", [key.hex]),
        ):
            with self.subTest(statement=statement):
                self.guard_rejects(statement, arguments)
        self.assertEqual(self.domain_state(), before)

    def test_native_cancellation_decision_requires_a_real_decision_event(self):
        order = self.accept("cod")
        row = CancellationRequest.objects.get(pk=self.cancel(order)["request"])
        self.assign(row)
        before = self.domain_state()
        self.guard_rejects(
            "INSERT INTO orders_cancellationdecision (request_id,event_id,actor_id,account_id,context,action,reason,created_at)"
            " VALUES (%s,%s,%s,NULL,'owner','approved','Forged decision using request event',UTC_TIMESTAMP(6))",
            [row.pk.hex, row.event_id.hex, self.root.user.pk.hex],
        )
        self.assertEqual(self.domain_state(), before)
        self.assertFalse(CancellationDecision.objects.exists())

    def test_native_amendment_decision_requires_a_real_decision_event(self):
        order = self.accept("cod")
        row = Amendment.objects.get(pk=self.propose(order, [(OrderLine.objects.get(order=order), "0.500")])["amendment"])
        self.amend(row, "assign", assigned_to=self.root.user.pk)
        before = self.domain_state()
        self.guard_rejects(
            "INSERT INTO orders_amendmentdecision (amendment_id,event_id,actor_id,account_id,context,action,reason,created_at)"
            " VALUES (%s,%s,%s,NULL,'owner','approved','Forged decision using proposal event',UTC_TIMESTAMP(6))",
            [row.pk.hex, row.event_id.hex, self.root.user.pk.hex],
        )
        self.assertEqual(self.domain_state(), before)
        self.assertFalse(AmendmentDecision.objects.exists())

    def test_root_cannot_use_generic_admin_edit_or_delete_to_bypass_review(self):
        order = self.accept("cod")
        row = CancellationRequest.objects.get(pk=self.cancel(order)["request"])
        amendment = Amendment.objects.get(pk=self.propose(order, [(OrderLine.objects.get(order=order), "0.500")])["amendment"])
        before = self.domain_state()
        for model, identifier in (("cancellationrequest", row.pk), ("amendment", amendment.pk)):
            for action in ("change", "delete"):
                with self.subTest(model=model, action=action):
                    response = self.root_client.post(
                        f"/admin/orders/{model}/{identifier}/{action}/", {"state": "approved", "post": "yes"},
                        HTTP_X_CSRFTOKEN=self.root_client.cookies["csrftoken"].value,
                    )
                    self.assertEqual(response.status_code, 403)
        self.assertEqual(self.domain_state(), before)

    def test_native_workspace_requires_csrf_and_both_current_versions(self):
        order = self.accept("cod")
        row = CancellationRequest.objects.get(pk=self.cancel(order)["request"])
        self.assign(row)
        row.refresh_from_db()
        path = f"/admin/orders/cancellationrequest/{row.pk}/review/"
        packet = {
            "command_id": str(uuid.uuid4()), "version": str(self.head(order)), "case_version": str(row.version),
            "action": "approve", "reason": "Version-bound native approval",
        }
        before = self.domain_state()
        self.assertEqual(self.root_client.post(path, packet).status_code, 403)
        for overrides in ({"version": "0"}, {"case_version": "1"}):
            response = self.root_client.post(
                path, {**packet, **overrides}, HTTP_X_CSRFTOKEN=self.root_client.cookies["csrftoken"].value,
            )
            self.assertEqual(response.status_code, 400)
        self.assertEqual(self.domain_state(), before)
        self.assertFalse(AftercareCommand.objects.filter(pk=packet["command_id"]).exists())

    def test_native_group_revocation_takes_effect_on_an_existing_assigned_grant(self):
        group = self.native_group("Amendment review")
        actor, client = self.connected("staff", "aftercare-revoked-reviewer", group=group)
        order = self.accept("cod")
        row = Amendment.objects.get(pk=self.propose(order, [(OrderLine.objects.get(order=order), "0.500")])["amendment"])
        self.amend(row, "assign", assigned_to=actor.user.pk)
        path = f"/admin/orders/amendment/{row.pk}/review/"
        self.assertEqual(client.get(path).status_code, 200)
        actor.user.groups.remove(group)
        before = self.domain_state()
        self.assertEqual(client.get(path).status_code, 404)
        with self.assertRaises(Http404):
            self.amend(row, "approve", actor=actor)
        self.assertEqual(self.domain_state(), before)
        self.assertEqual(Amendment.objects.get(pk=row.pk).state, "pending")


@override_settings(OWNER_MFA_REQUIRED=False)
class AftercareFulfilmentLifecycleTests(AftercareFixture, TestCase):
    def test_withdrawn_request_needs_independent_hold_closure_before_dispatch(self):
        order = self.accept("cod")
        self.prepare(order)
        row = CancellationRequest.objects.get(pk=self.cancel(order)["request"])
        self.withdraw(order, row)
        self.assertEqual(self.send(order)["code"], "cancellation_hold")
        case = delivery.ReviewCase.objects.get(blocker_id=row.blocker_id)
        self.review(case, "assign", assigned_to=self.root.user.pk)
        self.review(case, "clear", disposition="withdrawn")
        self.send(order)
        self.assertEqual(delivery.Shipment.objects.filter(order=order).count(), 1)
        self.assertEqual(delivery.BlockerClosure.objects.filter(blocker_id=row.blocker_id).count(), 1)
        self.assertEqual(Bucket.objects.get().physical, Decimal("99.000"))
        self.assertEqual(CancellationRequest.objects.get(pk=row.pk).state, "withdrawn")
        self.assertFalse(InvoiceAdjustment.objects.exists())

    def test_cancelled_order_refuses_new_goods_receipts_and_plans_but_retains_refund_path(self):
        order = self.reserved(self.accept("advance"))
        row = CancellationRequest.objects.get(pk=self.cancel(order)["request"])
        due = RefundDue.objects.get(pk=self.approve(row)["refund_due"])
        before = self.domain_state()
        stock = self.inventory_state()
        for action in (lambda: self.receipt(order, "1.00"), lambda: self.plan(order)):
            with self.assertRaises(Conflict):
                action()
        self.assertEqual(self.domain_state(), before)
        self.assertEqual(self.inventory_state(), stock)
        self.report(order, due)
        self.confirm_refund(due)
        self.assertEqual(refunds.refunded_total(order), Decimal("12.50"))
        self.assertEqual(pay.confirmed(order), Decimal("12.50"))
        self.assertEqual(self.inventory_state(), stock)

    def test_reprepared_amended_order_completes_against_effective_goods_total(self):
        order = self.accept("cod")
        self.prepare(order)
        original = delivery.Preparation.objects.get(order=order)
        row = Amendment.objects.get(pk=self.propose(order, [(OrderLine.objects.get(order=order), "0.500")])["amendment"])
        self.approve_amendment(row)
        with self.assertRaises(Conflict):
            self.send(order)
        outcome = self.command(order, "prepare", **{
            "arrangement": str(original.arrangement_id), "recipient": str(original.recipient_id),
            "lines": [{"variant": str(self.variant.pk), "batch": None, "quantity": "0.500"}],
            "reason": "Explicit re-preparation of amended demand",
        })
        from apps.fulfilment import services

        packet = self.dispatch_packet(order, preparation=outcome["preparation"])
        services.mutate(self.seller, order.pk, "dispatch", packet)
        self.command(order, "deliver", self.buyer, occurred_at=timezone.now(), reason="Delivered amended whole order")
        self.receipt(order, "6.25")
        self.assertEqual(Bucket.objects.get().physical, Decimal("99.500"))
        self.assertEqual(delivery.Completion.objects.filter(order=order).count(), 1)
        self.assertEqual(delivery_queries.dimensions(order)["goods_remaining"], "0.00")
        self.assertEqual(delivery_queries.dimensions(order)["completion"], "completed")
        self.assertEqual(OrderLine.objects.get(order=order).quantity, Decimal("1.000"))
        self.assertEqual(delivery.Preparation.objects.filter(order=order).count(), 2)

    def test_emptied_bucket_still_reprepares_and_dispatches(self):
        from apps.fulfilment import services as delivery_services
        from apps.inventory import services as stock

        lines = FulfilmentBatchTests.batch_stock(self)
        order = self.accept("advance")
        self.prepare(order, lines=lines)
        allocation.execute(order.pk)
        held = Allocation.objects.get()
        self.assertEqual(held.state, "held")
        row = Amendment.objects.get(pk=self.propose(order, [(OrderLine.objects.get(order=order), "0.375")])["amendment"])
        self.approve_amendment(row)
        reductions = AllocationReduction.objects.filter(allocation=held)
        self.assertEqual(sum(x.quantity for x in reductions), Decimal("0.625"))
        remaining = stock.remaining_lines(held)
        self.assertEqual(sum(quantity for _, quantity in remaining), Decimal("0.375"))
        self.assertTrue(all(quantity > Decimal("0.000") for _, quantity in remaining))
        original = delivery.Preparation.objects.filter(order=order).order_by("created_at", "pk").first()
        outcome = self.command(
            order,
            "prepare",
            arrangement=str(original.arrangement_id),
            recipient=str(original.recipient_id),
            reason="Explicit re-preparation after an emptied-bucket reduction",
        )
        preparation = delivery.Preparation.objects.get(pk=outcome["preparation"])
        prepared = {line.bucket_id: line.quantity for line in preparation.lines.all()}
        self.assertEqual(sum(prepared.values()), Decimal("0.375"))
        self.assertTrue(all(quantity > Decimal("0.000") for quantity in prepared.values()))
        self.assertEqual(
            prepared, {row.bucket_id: quantity for row, quantity in remaining},
        )
        delivery_services.mutate(self.seller, order.pk, "dispatch", self.dispatch_packet(order, preparation=outcome["preparation"]))
        self.assertEqual(delivery.Shipment.objects.filter(order=order).count(), 1)
        self.assertEqual(Allocation.objects.get().state, "consumed")
        buckets = Bucket.objects.filter(position_id=self.variant.pk)
        self.assertEqual(sum(buckets.values_list("held", flat=True)), Decimal("0.000"))
        self.assertEqual(sum(buckets.values_list("physical", flat=True)), Decimal("0.625"))

    def test_cancellation_hold_blocks_completion_even_when_delivery_and_money_are_settled(self):
        from apps.fulfilment.completion import reconcile_locked

        order = self.accept("cod")
        self.prepare(order)
        self.send(order)
        self.command(order, "blocker", self.root, kind="cancellation", reason="Unresolved operational cancellation hold")
        self.command(order, "deliver", self.buyer, occurred_at=timezone.now(), reason="Actual delivery while hold is reviewed")
        self.receipt(order, "12.50")
        with transaction.atomic():
            self.assertIsNone(reconcile_locked(order))
        self.assertFalse(delivery.Completion.objects.filter(order=order).exists())
        self.assertEqual(delivery_queries.dimensions(order)["completion"], "incomplete")
        independent, _ = self.connected("owner", "independent-operational-hold-reviewer")
        case = delivery.ReviewCase.objects.get(order=order, kind="blocker")
        self.review(case, "assign", assigned_to=independent.user.pk)
        self.review(case, "clear", actor=independent, disposition="decided")
        self.assertEqual(delivery.Completion.objects.filter(order=order).count(), 1)
        self.assertEqual(Bucket.objects.get().physical, Decimal("99.000"))

