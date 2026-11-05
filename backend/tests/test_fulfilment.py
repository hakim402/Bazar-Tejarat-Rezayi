"""Owned native regressions for exact whole dispatch and independent delivery money."""

import uuid
from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch
from django.db import transaction, DatabaseError
from django.test import TestCase, TransactionTestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from apps.organizations.access import Conflict
from rest_framework.exceptions import PermissionDenied
from apps.orders import services as orders
from apps.orders.models import SellerOrder
from apps.inventory.models import Bucket, Movement, StockTransition
from apps.payments import services as payments
from apps.payments.models import Finance
from apps.fulfilment import models as m, services, queries, transitions, documents
from tests.test_commerce import CommerceFixture


class FulfilmentFixture(CommerceFixture):
    def accept(self, method="cod"):
        self.add()
        orders.submit(self.buyer, self.packet(method))
        return SellerOrder.objects.latest("accepted_at")

    def command(self, order, action, actor=None, **data):
        actor = actor or self.seller
        return services.mutate(
            actor,
            order.pk,
            action,
            {
                "command_id": uuid.uuid4(),
                "version": m.State.objects.filter(order=order).values_list("version", flat=True).first() or 0,
                "goods_version": Finance.objects.filter(order=order).values_list("version", flat=True).first() or 0,
                **data,
            },
        )

    def goods(self, order, amount="12.50"):
        return payments.mutate(
            self.seller,
            order.pk,
            "receipt",
            {
                "command_id": uuid.uuid4(),
                "version": Finance.objects.filter(order=order).values_list("version", flat=True).first() or 0,
                "amount": amount,
                "currency": "AFN",
                "paid_at": timezone.now() - timedelta(minutes=1),
                "description": "Synthetic actual goods receipt",
            },
        )

    def prepare(self, order, charge="0.00", *, goods_amount="12.50", finalize=True, lines=None):
        self.command(
            order,
            "recipient",
            self.buyer,
            recipient_revision=0,
            name="Synthetic recipient",
            phone="000-TEST",
            address="Synthetic private address",
            instructions="Synthetic only",
            reason="Initial recipient",
        )
        arrangement = self.command(
            order,
            "arrange",
            arranger="seller",
            provider="Synthetic manual provider",
            self_delivery=False,
            instructions="Manual whole delivery",
        )
        stock_lines = lines or [{"variant": str(self.variant.pk), "batch": None, "quantity": "1.000"}]
        if order.payment_method == "advance":
            payments.mutate(
                self.seller,
                order.pk,
                "plan",
                {
                    "command_id": uuid.uuid4(),
                    "version": Finance.objects.get(order=order).version,
                    "intent_version": 0,
                    "reason": "Whole original allocation",
                    "lines": stock_lines,
                },
            )
            self.goods(order, goods_amount)
        recipient = m.Recipient.objects.get(order=order)
        fields = {
            "arrangement": arrangement["arrangement"],
            "recipient": str(recipient.pk),
            "reason": "Whole accepted demand",
        }
        if order.payment_method == "cod":
            fields["lines"] = stock_lines
        prepared = self.command(order, "prepare", **fields)
        self.command(
            order,
            "charge",
            provider=arrangement["provider"],
            amount=charge,
            currency="AFN",
            reason="Separate actual provider charge",
        )
        case = m.ReviewCase.objects.get(order=order, kind="charge")
        if finalize:
            self.review(case, "assign", assigned_to=self.root.user.pk)
            self.review(case, "approve")
        return prepared["preparation"]

    def review(self, case, action, actor=None, **data):
        case.refresh_from_db()
        return self.command(
            case.order,
            "case_" + action,
            actor or self.root,
            case=case.pk,
            case_version=case.version,
            reason="Independent synthetic provider review",
            **data,
        )

    def dispatch_packet(self, order, preparation=None):
        preparation = preparation or str(m.Preparation.objects.get(order=order).pk)
        state = m.State.objects.get(order=order)
        body = transitions.packet(
            self.seller, order, state, {"preparation": preparation, "reason": "Exact whole dispatch"}
        )[0]
        return {"command_id": uuid.uuid4(), **body}

    def send(self, order):
        return services.mutate(self.seller, order.pk, "dispatch", self.dispatch_packet(order))


@override_settings(OWNER_MFA_REQUIRED=False)
class FulfilmentTests(FulfilmentFixture, TestCase):
    def test_reads_do_not_initialize_state_or_finance_and_omit_unrelated_recipient(self):
        order = self.accept()
        data = queries.detail(self.buyer, order.pk)
        self.assertEqual((data["stage"], data["charge"], data["completion"]), ("not_dispatched", None, "incomplete"))
        profiles = "/api/v1/fulfilment/seller/profiles/"
        own = self.seller_client.get(profiles, {"seller": str(order.seller_id)})
        self.assertEqual(own.status_code, 200)
        self.assertEqual([row["id"] for row in own.json()["results"]], [str(order.seller_id)])
        self.assertEqual(self.seller_client.get(profiles, {"seller": str(uuid.uuid4())}).json()["count"], 0)
        self.assertEqual(self.buyer_client.get(profiles).status_code, 403)
        self.assertFalse(m.State.objects.exists())
        self.assertFalse(Finance.objects.exists())
        self.assertEqual(self.other_client.get(f"/api/v1/fulfilment/buyer/orders/{order.pk}/").status_code, 404)

    def test_detail_fact_and_event_pagination_share_the_fifty_record_boundary(self):
        order = self.accept()
        self.prepare(order)
        self.send(order)
        before = list(Bucket.objects.values_list("physical", "held"))
        for index in range(51):
            self.command(
                order,
                "tracking",
                occurred_at=timezone.now(),
                reference=f"SYNTHETIC-TRACK-{index:02}",
                reason="Synthetic actual tracking history",
            )
        first = queries.detail(self.seller, order.pk, page=1)
        second = queries.detail(self.seller, order.pk, page=2)
        self.assertEqual((len(first["tracking"]), len(second["tracking"])), (50, 1))
        self.assertEqual(first["tracking"][0]["reference"], "SYNTHETIC-TRACK-50")
        self.assertEqual(second["tracking"][0]["reference"], "SYNTHETIC-TRACK-00")
        self.assertGreater(first["history_count"], 50)
        self.assertEqual(len(first["history"]), 50)
        self.assertEqual(list(Bucket.objects.values_list("physical", "held")), before)
        self.assertEqual(m.Shipment.objects.filter(order=order).count(), 1)

    def test_cod_dispatch_exact_once_replay_and_native_balance_witness(self):
        order = self.accept()
        self.prepare(order)
        packet = self.dispatch_packet(order)
        before = Bucket.objects.get().physical
        first = services.mutate(self.seller, order.pk, "dispatch", packet)
        self.assertEqual(services.mutate(self.seller, order.pk, "dispatch", packet), first)
        self.assertEqual(Bucket.objects.get().physical, before - 1)
        self.assertEqual(
            (
                m.Shipment.objects.count(),
                StockTransition.objects.filter(movement__operation_id=first["operation"], pending=False).count(),
            ),
            (1, 1),
        )
        with self.assertRaises(Conflict):
            self.send(order)
        self.assertEqual(Bucket.objects.get().physical, before - 1)

    def test_advance_consumes_original_hold_once(self):
        order = self.accept("advance")
        self.prepare(order)
        self.assertEqual(Bucket.objects.get().held, 1)
        self.send(order)
        bucket = Bucket.objects.get()
        self.assertEqual((bucket.physical, bucket.held), (Decimal("99.000"), Decimal(0)))
        self.assertEqual(m.Shipment.objects.get().preparation.allocation.state, "consumed")

    def test_recipient_supersession_invalidates_review_and_requires_repreparation(self):
        order = self.accept()
        self.prepare(order)
        packet = self.dispatch_packet(order)
        self.command(
            order,
            "recipient",
            self.buyer,
            recipient_revision=1,
            name="Second synthetic recipient",
            phone="000-TEST-2",
            address="Changed synthetic private address",
            reason="Buyer revision before dispatch",
        )
        self.assertEqual(queries.detail(self.buyer, order.pk)["stage"], "needs_preparation")
        with self.assertRaises(Conflict):
            services.mutate(self.seller, order.pk, "dispatch", packet)
        self.assertFalse(m.Shipment.objects.exists())
        self.assertEqual(Bucket.objects.get().physical, 100)

    def test_dispatch_crash_rolls_back_actual_stock_witness_shipment_and_command(self):
        order = self.accept()
        self.prepare(order)
        packet = self.dispatch_packet(order)
        before = Movement.objects.count()
        with patch(
            "apps.fulfilment.transitions.before_dispatch_commit", side_effect=OSError("Synthetic precommit failure")
        ):
            with self.assertRaises(OSError):
                services.mutate(self.seller, order.pk, "dispatch", packet)
        self.assertEqual((Bucket.objects.get().physical, Movement.objects.count()), (Decimal(100), before))
        self.assertFalse(m.Command.objects.filter(pk=packet["command_id"]).exists())
        self.assertFalse(m.Shipment.objects.exists())
        services.mutate(self.seller, order.pk, "dispatch", packet)
        self.assertEqual(m.Shipment.objects.count(), 1)

    def test_delivery_requires_dispatch_rejects_future_and_retains_actual_source(self):
        order = self.accept()
        with self.assertRaises(Exception) as error:
            self.command(order, "deliver", self.buyer, occurred_at=timezone.now(), reason="No shipment")
        self.assertEqual(getattr(error.exception, "status_code", 404), 404)
        self.prepare(order)
        self.send(order)
        from rest_framework.exceptions import ValidationError

        with self.assertRaises(ValidationError):
            self.command(
                order,
                "deliver",
                self.buyer,
                occurred_at=timezone.now() + timedelta(days=1),
                reason="Impossible future delivery",
            )
        from tests.test_identity import ORIGIN

        rejected = self.buyer_client.post(
            f"/api/v1/fulfilment/buyer/orders/{order.pk}/deliver/",
            {
                "command_id": str(uuid.uuid4()),
                "version": m.State.objects.get(order=order).version,
                "goods_version": Finance.objects.get(order=order).version,
                "occurred_at": timezone.now().replace(tzinfo=None).isoformat(),
                "reason": "An API timestamp must include its timezone",
            },
            format="json",
            HTTP_ORIGIN=ORIGIN,
            HTTP_X_CSRFTOKEN=self.buyer_client.cookies["csrftoken"].value,
        )
        self.assertEqual(rejected.status_code, 400)
        self.assertIn("occurred_at", rejected.data["error"]["fields"])
        self.assertIn({"path": "occurred_at", "code": "aware_required"}, rejected.data["error"]["violations"])
        self.command(
            order, "deliver", self.seller, occurred_at=timezone.now(), reason="Seller reports actual whole delivery"
        )
        self.assertEqual(queries.detail(self.buyer, order.pk)["delivery"]["source"], "seller")
        self.assertEqual(queries.dimensions(order)["goods_confirmed"], "0.00")
        self.assertFalse(m.Completion.objects.exists())

    def test_claim_never_settles_independent_exact_receipt_completes_once(self):
        order = self.accept()
        self.prepare(order, "5.00")
        self.send(order)
        self.command(order, "deliver", self.buyer, occurred_at=timezone.now(), reason="Buyer received whole shipment")
        self.goods(order)
        self.command(
            order,
            "claim",
            self.buyer,
            charge=str(queries.current_charge(order).pk),
            amount="5.00",
            currency="AFN",
            paid_at=timezone.now() - timedelta(minutes=1),
            description="Synthetic actual provider receipt",
        )
        self.assertEqual(queries.delivery_total(order), 0)
        self.assertFalse(m.Completion.objects.exists())
        case = m.ReviewCase.objects.get(kind="payment")
        self.review(case, "assign", assigned_to=self.root.user.pk)
        self.review(case, "approve")
        self.assertEqual(queries.dimensions(order)["completion"], "completed")
        self.assertEqual(m.Completion.objects.count(), 1)
        from apps.fulfilment.completion import reconcile_locked

        with transaction.atomic():
            reconcile_locked(order)
        self.assertEqual(m.Completion.objects.count(), 1)

    def test_zero_charge_requires_finalization_but_no_claim_or_receipt(self):
        order = self.accept()
        self.prepare(order)
        self.send(order)
        self.goods(order)
        self.command(order, "deliver", self.buyer, occurred_at=timezone.now(), reason="Received whole shipment")
        self.assertEqual(queries.dimensions(order)["completion"], "completed")
        with self.assertRaises(Conflict):
            self.command(
                order,
                "claim",
                self.buyer,
                charge=str(queries.current_charge(order).pk),
                amount="1.00",
                currency="AFN",
                paid_at=timezone.now(),
                description="Not needed for zero charge",
            )
        self.assertFalse(m.Receipt.objects.exists())

    def test_new_late_dispute_queues_review_after_previous_exception_was_resolved(self):
        other_root, _ = self.connected("owner", "repeat-hold-reviewer")
        order = self.accept()
        self.prepare(order)
        self.send(order)
        self.goods(order)
        self.command(order, "deliver", self.buyer, occurred_at=timezone.now(), reason="Actual whole delivery")
        original = m.Completion.objects.select_related("event").get(order=order)
        self.command(order, "blocker", self.root, kind="dispute", reason="First later operational dispute")
        first = m.ReviewCase.objects.get(order=order, kind="exception")
        hold = m.ReviewCase.objects.get(order=order, kind="blocker")
        self.review(hold, "assign", assigned_to=other_root.user.pk)
        self.review(hold, "clear", actor=other_root, disposition="withdrawn")
        self.review(first, "assign", assigned_to=other_root.user.pk)
        self.review(first, "resolve", actor=other_root)
        self.assertEqual(queries.dimensions(order)["completion"], "completed")
        self.command(order, "blocker", self.root, kind="dispute", reason="New independently retained later dispute")
        second = m.ReviewCase.objects.get(order=order, kind="exception", state="open")
        self.assertNotEqual(first.pk, second.pk)
        first.refresh_from_db()
        self.assertEqual(first.state, "resolved")
        self.review(second, "assign", assigned_to=other_root.user.pk)
        self.review(second, "refer", actor=other_root)
        from apps.fulfilment.completion import reconcile_locked
        from apps.accounts.models import AuditEvent

        for _ in range(3):
            reconcile_locked(order)
        self.assertEqual(m.ReviewCase.objects.filter(order=order, kind="exception").count(), 2)
        self.assertEqual(
            AuditEvent.objects.filter(
                action="fulfilment_exception_queued", resource_id__in=[first.pk, second.pk]
            ).count(),
            2,
        )
        current = m.Completion.objects.select_related("event").get(order=order)
        self.assertEqual((current.pk, current.event.created_at), (original.pk, original.event.created_at))
        self.assertEqual(queries.dimensions(order)["completion"], "completed_with_exception")
        self.assertEqual((Bucket.objects.get().physical, Bucket.objects.get().held), (Decimal(99), Decimal(0)))
        self.assertEqual(m.Shipment.objects.filter(order=order).count(), 1)

    def test_repeated_late_provider_correction_preserves_old_review_and_queues_the_new_cause(self):
        other_root, _ = self.connected("owner", "repeat-provider-reviewer")
        order = self.accept()
        self.prepare(order, "5.00")
        self.send(order)
        self.goods(order)
        self.command(order, "deliver", self.buyer, occurred_at=timezone.now(), reason="Actual whole delivery")
        self.command(
            order,
            "claim",
            self.buyer,
            charge=str(queries.current_charge(order).pk),
            amount="5.00",
            currency="AFN",
            paid_at=timezone.now() - timedelta(minutes=1),
            description="Synthetic actual provider receipt",
        )
        claim = m.ReviewCase.objects.get(order=order, kind="payment")
        self.review(claim, "assign", assigned_to=self.root.user.pk)
        self.review(claim, "approve")
        receipt = m.Receipt.objects.get(order=order)
        original = m.Completion.objects.select_related("event").get(order=order)
        goods_version = Finance.objects.get(order=order).version

        def correct(amount):
            effective = queries.effective_receipts(m.Receipt.objects.filter(pk=receipt.pk)).get()
            self.command(
                order,
                "correction",
                self.buyer,
                receipt=receipt.pk,
                receipt_version=effective.effective_version,
                amount=amount,
                paid_at=effective.effective_time,
                description="Synthetic corrected actual provider funds",
                reason="Independent current provider correction",
            )
            case = m.ReviewCase.objects.get(order=order, kind="correction", state="open")
            self.review(case, "assign", assigned_to=self.root.user.pk)
            self.review(case, "approve")

        correct("0.00")
        first = m.ReviewCase.objects.get(order=order, kind="exception")
        correct("5.00")
        self.review(first, "assign", assigned_to=other_root.user.pk)
        self.review(first, "resolve", actor=other_root)
        self.assertEqual(queries.dimensions(order)["completion"], "completed")
        correct("0.00")
        second = m.ReviewCase.objects.get(order=order, kind="exception", state="open")
        self.assertNotEqual(first.pk, second.pk)
        self.assertEqual(Finance.objects.get(order=order).version, goods_version)
        from apps.fulfilment.completion import reconcile_locked
        from apps.accounts.models import AuditEvent

        for _ in range(3):
            reconcile_locked(order)
        self.assertEqual(m.ReviewCase.objects.filter(order=order, kind="exception").count(), 2)
        self.assertEqual(
            AuditEvent.objects.filter(
                action="fulfilment_exception_queued", resource_id__in=[first.pk, second.pk]
            ).count(),
            2,
        )
        current = m.Completion.objects.select_related("event").get(order=order)
        self.assertEqual((current.pk, current.event.created_at), (original.pk, original.event.created_at))
        self.assertEqual(queries.delivery_total(order), Decimal(0))
        self.assertEqual(queries.dimensions(order)["goods_confirmed"], "12.50")
        self.assertEqual(queries.dimensions(order)["completion"], "completed_with_exception")
        self.assertEqual((Bucket.objects.get().physical, Bucket.objects.get().held), (Decimal(99), Decimal(0)))

    def test_existing_completion_remains_after_later_operational_hold(self):
        order = self.accept()
        self.prepare(order)
        self.send(order)
        self.goods(order)
        self.command(order, "deliver", self.buyer, occurred_at=timezone.now(), reason="Actual whole delivery")
        original = m.Completion.objects.get().pk
        self.command(order, "blocker", self.root, kind="dispute", reason="Later unresolved operational dispute")
        self.assertEqual(queries.dimensions(order)["completion"], "completed_with_exception")
        self.assertEqual(m.Completion.objects.get().pk, original)
        self.assertTrue(m.ReviewCase.objects.filter(kind="exception").exists())
        self.assertEqual(queries.page(self.root, state="blocked")["count"], 1)
        self.assertEqual(Bucket.objects.get().physical, 99)

    def test_cancellation_hold_persists_failed_attempt_without_stock_effect(self):
        order = self.accept()
        self.prepare(order)
        self.command(order, "blocker", self.root, kind="cancellation", reason="Pending cancellation operational hold")
        result = self.send(order)
        self.assertEqual(result["code"], "cancellation_hold")
        self.assertFalse(m.Shipment.objects.exists())
        self.assertEqual(Bucket.objects.get().physical, 100)
        self.assertEqual(m.DispatchAttempt.objects.count(), 1)

    def test_absence_fence_rejects_delayed_original_command(self):
        order = self.accept()
        self.prepare(order)
        packet = self.dispatch_packet(order)
        self.assertEqual(services.lookup(self.seller, order.pk, packet["command_id"], fence=True)["state"], "rejected")
        with self.assertRaises(Conflict):
            services.mutate(self.seller, order.pk, "dispatch", packet)
        self.assertFalse(m.Shipment.objects.exists())

    def test_root_without_staff_account_has_native_coverage_and_no_generic_writes(self):
        from apps.accounts.admin import owner_site
        from apps.accounts.models import Account

        self.assertFalse(Account.objects.filter(user=self.root.user).exists())
        order = self.accept()
        response = self.root_client.get(reverse("admin:fulfilment_state_workflow", args=[order.pk]))
        self.assertEqual(response.status_code, 200, response.content[:500])
        for model in owner_site._registry:
            if model._meta.app_label != "fulfilment":
                continue
            with self.subTest(model=model._meta.model_name):
                self.assertEqual(
                    self.root_client.get(
                        reverse("admin:fulfilment_" + model._meta.model_name + "_changelist")
                    ).status_code,
                    200,
                )
        self.assertFalse(m.State.objects.exists())
        self.prepare(order)
        self.send(order)
        response = self.root_client.get(reverse("admin:fulfilment_state_workflow", args=[order.pk]))
        choices = dict(response.context["form"].fields["action"].choices)
        self.assertFalse({"arrange", "prepare", "charge", "dispatch"} & choices.keys())
        self.assertIn("deliver", choices)
        self.command(order, "deliver", self.buyer, occurred_at=timezone.now(), reason="Actual whole delivery")
        response = self.root_client.get(reverse("admin:fulfilment_state_workflow", args=[order.pk]))
        self.assertNotIn("deliver", dict(response.context["form"].fields["action"].choices))

    def test_native_movement_without_real_bucket_transition_is_rejected(self):
        from django.db import connection

        bucket = Bucket.objects.get()
        movement = Movement.objects.first()
        with self.assertRaises(DatabaseError) as error, transaction.atomic(), connection.cursor() as cursor:
            cursor.execute(
                "INSERT INTO inventory_movement (id,operation_id,bucket_id,physical_delta,held_delta,physical_after,held_after,created_at) SELECT %s,operation_id,bucket_id,physical_delta,held_delta,physical_after,held_after,created_at FROM inventory_movement WHERE id=%s",
                [uuid.uuid4().hex, movement.pk.hex],
            )
        self.assertEqual(error.exception.args[0], 1644)
        self.assertEqual(Bucket.objects.get().physical, bucket.physical)

    def test_handover_four_languages_protected_private_no_invoice_mutation(self):
        order = self.accept()
        self.prepare(order)
        self.send(order)
        original = order.snapshot.copy()
        for locale in ["fa-AF", "ps", "ar", "en"]:
            data = documents.snapshot(self.seller, order.pk, locale)
            self.assertIn(b"Synthetic private address", documents.html_bytes(data, locale))
            self.assertIn(b"data:font/ttf;base64,", documents.html_bytes(data, locale))
            path = f"/api/v1/fulfilment/seller/orders/{order.pk}/handover/"
            response = self.seller_client.get(path, {"locale": locale, "format": "pdf"}, HTTP_ACCEPT="application/pdf")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response["Content-Type"], "application/pdf")
            self.assertTrue(response.content.startswith(b"%PDF"))
            self.assertIn("no-store", response["Cache-Control"])
            head = self.seller_client.head(path, {"locale": locale, "format": "html"}, HTTP_ACCEPT="text/html")
            self.assertEqual((head.status_code, head.content), (200, b""))
            self.assertGreater(int(head["Content-Length"]), 0)
        invalid = self.seller_client.get(path, {"format": "xml"}, HTTP_ACCEPT="application/pdf")
        self.assertEqual(invalid.status_code, 400)
        self.assertTrue(invalid["Content-Type"].startswith("application/json"))
        order.refresh_from_db()
        self.assertEqual(order.snapshot, original)


@override_settings(OWNER_MFA_REQUIRED=False)
class FulfilmentRules(FulfilmentFixture, TestCase):
    def test_positive_partial_advance_requires_current_seller_concession(self):
        order = self.accept("advance")
        self.prepare(order, goods_amount="5.00")
        first = self.send(order)
        self.assertEqual(first["code"], "positive_funds_and_partial_permission")
        self.assertEqual(Bucket.objects.get().held, 1)
        self.command(order, "partial", reason="Seller expressly allows this positive partial balance")
        self.assertEqual(self.send(order)["state"], "dispatched")
        self.assertEqual(Bucket.objects.get().held, 0)

    def test_changed_financial_version_invalidates_partial_concession(self):
        order = self.accept("advance")
        self.prepare(order, goods_amount="5.00")
        self.command(order, "partial", reason="Seller concession for original current balance")
        self.goods(order, "1.00")
        self.assertEqual(self.send(order)["code"], "positive_funds_and_partial_permission")
        self.assertEqual(Bucket.objects.get().held, 1)
        self.assertFalse(m.Shipment.objects.exists())

    def test_zero_corrected_advance_retains_money_history_and_original_hold(self):
        from apps.payments import models as p

        order = self.accept("advance")
        self.prepare(order)
        receipt = p.Receipt.objects.get(order=order)
        payments.mutate(
            self.seller,
            order.pk,
            "correction",
            {
                "command_id": uuid.uuid4(),
                "version": Finance.objects.get(order=order).version,
                "receipt": receipt.pk,
                "receipt_version": 1,
                "amount": "0.00",
                "paid_at": receipt.paid_at,
                "description": "Synthetic corrected zero amount",
                "reason": "Independent correction is necessary",
            },
        )
        case = p.ReviewCase.objects.get(order=order, kind="correction")
        for action in ["assign", "approve"]:
            case.refresh_from_db()
            payments.decide(
                self.root,
                case.pk,
                {
                    "command_id": uuid.uuid4(),
                    "version": Finance.objects.get(order=order).version,
                    "case_version": case.version,
                    "action": action,
                    "assigned_to": self.root.user.pk,
                    "reason": "Independent actual correction",
                },
            )
        self.assertEqual(self.send(order)["code"], "positive_funds_and_partial_permission")
        self.assertEqual((Bucket.objects.get().physical, Bucket.objects.get().held), (Decimal(100), Decimal(1)))
        self.assertEqual(p.Receipt.objects.count(), 1)

    def test_proposed_or_rejected_delivery_amount_is_never_finalized_zero(self):
        order = self.accept()
        self.prepare(order, finalize=False)
        self.assertIsNone(queries.dimensions(order)["charge"])
        with self.assertRaises(Conflict):
            self.dispatch_packet(order)
        case = m.ReviewCase.objects.get(kind="charge")
        self.review(case, "assign", assigned_to=self.root.user.pk)
        self.review(case, "reject")
        self.assertIsNone(queries.dimensions(order)["charge"])
        self.assertFalse(m.Shipment.objects.exists())

    def test_shortage_retry_keeps_failed_outcome_and_requires_deliberate_new_packet(self):
        from apps.inventory import services as stock
        from apps.inventory.models import Position, Shortage

        order = self.accept()
        self.prepare(order)
        packet = self.dispatch_packet(order)
        stock.manual(
            self.seller,
            self.profile.pk,
            self.variant.pk,
            {
                "token": uuid.uuid4(),
                "version": Position.objects.get(pk=self.variant.pk).version,
                "quantity": "-100.000",
                "reason": "Another operation takes current stock",
            },
            adjustment=True,
        )
        first = services.mutate(self.seller, order.pk, "dispatch", packet)
        self.assertEqual(first["code"], "stock_shortage")
        self.assertEqual(Shortage.objects.count(), 1)
        self.assertFalse(m.Shipment.objects.exists())
        self.seed_stock(self.variant, "1.000")
        self.assertEqual(services.mutate(self.seller, order.pk, "dispatch", packet), first)
        self.assertEqual(self.send(order)["state"], "dispatched")
        self.assertEqual(Bucket.objects.get().physical, 0)
        self.assertEqual(m.DispatchAttempt.objects.count(), 1)

    def test_provider_affiliation_blocks_root_approval_but_another_independent_root_can_review(self):
        order = self.accept()
        self.prepare(order)
        arrangement = self.command(
            order,
            "arrange",
            self.root,
            arranger="rezayi",
            provider="Synthetic Rezayi-arranged manual provider",
            instructions="Manual only",
        )
        self.command(
            order,
            "charge",
            self.root,
            provider=arrangement["provider"],
            amount="0.00",
            currency="AFN",
            reason="Independent finalization required",
        )
        case = m.ReviewCase.objects.get(proposal_id=m.ChargeProposal.objects.order_by("-event__version").first().pk)
        with self.assertRaises(PermissionDenied):
            self.review(case, "assign", assigned_to=self.root.user.pk)
        reviewer, _ = self.connected("owner", "delivery-independent-root")
        self.review(case, "assign", assigned_to=reviewer.user.pk)
        self.review(case, "approve", actor=reviewer)
        recipient = m.Recipient.objects.get(order=order)
        self.command(
            order,
            "prepare",
            self.root,
            recipient=recipient.pk,
            arrangement=arrangement["arrangement"],
            reason="Root prepares assigned manual logistics",
            lines=[{"variant": str(self.variant.pk), "batch": None, "quantity": "1.000"}],
        )
        current = m.Preparation.objects.filter(order=order).order_by("-event__version").first()
        packet = transitions.packet(
            self.root,
            order,
            m.State.objects.get(order=order),
            {"preparation": current.pk, "reason": "Root exact whole physical dispatch"},
        )[0]
        result = services.mutate(self.root, order.pk, "dispatch", {"command_id": uuid.uuid4(), **packet})
        self.assertIsNone(m.Shipment.objects.get(pk=result["shipment"]).operation.account_id)

    def test_delivery_correction_preserves_original_completion_and_original_receipt(self):
        order = self.accept()
        self.prepare(order, "5.00")
        self.send(order)
        self.goods(order)
        self.command(order, "deliver", self.buyer, occurred_at=timezone.now(), reason="Actual whole delivery")
        self.command(
            order,
            "claim",
            self.buyer,
            charge=queries.current_charge(order).pk,
            amount="5.00",
            currency="AFN",
            paid_at=timezone.now() - timedelta(minutes=1),
            description="Synthetic provider actual receipt",
        )
        case = m.ReviewCase.objects.get(kind="payment")
        self.review(case, "assign", assigned_to=self.root.user.pk)
        self.review(case, "approve")
        receipt = m.Receipt.objects.get()
        completion = m.Completion.objects.get().pk
        self.command(
            order,
            "correction",
            self.buyer,
            receipt=receipt.pk,
            receipt_version=1,
            amount="0.00",
            paid_at=receipt.claim.paid_at,
            description="Corrected actual provider amount",
            reason="Independent downward correction",
        )
        case = m.ReviewCase.objects.get(kind="correction")
        self.review(case, "assign", assigned_to=self.root.user.pk)
        self.review(case, "approve")
        self.assertEqual((queries.delivery_total(order), receipt.claim.amount), (Decimal(0), Decimal(5)))
        self.assertEqual(m.Completion.objects.get().pk, completion)
        self.assertEqual(queries.dimensions(order)["completion"], "completed_with_exception")
        self.assertEqual(Bucket.objects.get().physical, 99)

    def test_independent_assignment_and_actual_resource_permissions_refresh_immediately(self):
        from django.contrib.auth.models import Permission
        from django.http import Http404

        self.group.permissions.add(
            *Permission.objects.filter(
                content_type__app_label="fulfilment",
                codename__in=["read_fulfilment", "manage_logistics", "read_recipients"],
            )
        )
        order = self.accept()
        self.prepare(order)
        self.command(order, "case_open", self.root, reason="Open explicit logistics assignment")
        case = m.ReviewCase.objects.get(kind="logistics")
        self.review(case, "assign", assigned_to=self.staff.user.pk)
        self.assertIsNotNone(queries.detail(self.staff, order.pk)["recipient"])
        self.group.permissions.remove(
            Permission.objects.get(content_type__app_label="fulfilment", codename="read_recipients")
        )
        self.assertIsNone(queries.detail(self.staff, order.pk)["recipient"])
        self.review(case, "assign", assigned_to=self.root.user.pk)
        with self.assertRaises(Http404):
            queries.detail(self.staff, order.pk)

    def test_private_delivery_image_binding_head_cross_order_and_replay(self):
        from apps.fulfilment import media
        from tests.test_catalogue import image_file

        order = self.accept()
        self.prepare(order, "5.00")
        key = uuid.uuid4()
        image = media.upload(self.buyer, order.pk, key, "claim", image_file())
        self.assertEqual(media.upload(self.buyer, order.pk, key, "claim", image_file()), image)
        response = self.buyer_client.head(f"/api/v1/fulfilment/buyer/evidence/{image['id']}/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("no-store", response["Cache-Control"])
        self.assertEqual(self.other_client.get(f"/api/v1/fulfilment/buyer/evidence/{image['id']}/").status_code, 404)
        self.command(
            order,
            "claim",
            self.buyer,
            charge=queries.current_charge(order).pk,
            amount="5.00",
            currency="AFN",
            paid_at=timezone.now() - timedelta(minutes=1),
            description="Actual synthetic provider payment",
            evidence=[image["id"]],
        )
        self.assertEqual(m.EvidenceBinding.objects.count(), 1)
        with self.assertRaises(Exception) as error:
            self.command(
                order,
                "claim",
                self.buyer,
                charge=queries.current_charge(order).pk,
                amount="5.00",
                currency="AFN",
                paid_at=timezone.now() - timedelta(minutes=1),
                description="Cannot reuse bound evidence",
                evidence=[image["id"]],
            )
        self.assertEqual(getattr(error.exception, "status_code", 404), 404)
        self.assertEqual(m.Claim.objects.count(), 1)

    def test_partial_excess_and_rejected_provider_submissions_stay_separate_from_goods(self):
        order = self.accept()
        self.prepare(order, "5.00")
        self.send(order)
        self.goods(order)
        self.command(order, "deliver", self.buyer, occurred_at=timezone.now(), reason="Actual whole delivery")
        for amount, action, expected in [
            ("2.00", "approve", Decimal(2)),
            ("7.00", "reject", Decimal(2)),
            ("5.00", "approve", Decimal(7)),
        ]:
            result = self.command(
                order,
                "claim",
                self.buyer,
                charge=queries.current_charge(order).pk,
                amount=amount,
                currency="AFN",
                paid_at=timezone.now() - timedelta(minutes=1),
                description="Synthetic separate actual provider submission",
            )
            case = m.ReviewCase.objects.get(claim_id=result["claim"])
            self.review(case, "assign", assigned_to=self.root.user.pk)
            self.assertEqual(
                queries.delivery_total(order), expected if action == "reject" else expected - Decimal(amount)
            )
            self.review(case, action)
            self.assertEqual(queries.delivery_total(order), expected)
            self.assertEqual(m.Completion.objects.filter(order=order).exists(), expected >= Decimal(5))
        facts = queries.dimensions(order)
        self.assertEqual((facts["delivery_remaining"], facts["delivery_excess"]), ("0.00", "2.00"))
        self.assertEqual((order.goods_total, Bucket.objects.get().physical), (Decimal("12.50"), Decimal(99)))
        self.assertEqual(m.Receipt.objects.filter(order=order).count(), 2)

    def test_arrangement_changes_do_not_silently_relabel_the_finalized_payee(self):
        order = self.accept()
        self.prepare(order, "5.00")
        original = queries.current_charge(order)
        self.command(order, "arrange", arranger="seller", provider="Different synthetic carrier", self_delivery=False)
        detail = queries.detail(self.buyer, order.pk)
        self.assertEqual(detail["provider"], "Different synthetic carrier")
        self.assertEqual(detail["charge_provider"], original.provider.name)
        self.assertEqual(detail["charge_id"], str(original.pk))
        with self.assertRaises(Conflict):
            self.send(order)
        self.assertFalse(m.Shipment.objects.exists())
        self.assertEqual(Bucket.objects.get().physical, 100)

    def test_withdrawn_claim_and_wrong_currency_never_change_provider_receipts(self):
        from rest_framework.exceptions import ValidationError

        order = self.accept()
        self.prepare(order, "5.00")
        data = {
            "charge": queries.current_charge(order).pk,
            "amount": "5.00",
            "currency": "USD",
            "paid_at": timezone.now() - timedelta(minutes=1),
            "description": "Synthetic actual receipt",
        }
        with self.assertRaises(ValidationError):
            self.command(order, "claim", self.buyer, **data)
        claim = self.command(order, "claim", self.buyer, **{**data, "currency": "AFN"})["claim"]
        self.command(order, "withdraw", self.buyer, claim=claim, reason="Withdraw this exact unconfirmed submission")
        case = m.ReviewCase.objects.get(kind="payment")
        self.review(case, "assign", assigned_to=self.root.user.pk)
        with self.assertRaises(Conflict):
            self.review(case, "approve")
        self.assertEqual(queries.delivery_total(order), 0)
        self.assertFalse(m.Receipt.objects.exists())


@override_settings(OWNER_MFA_REQUIRED=False)
class FulfilmentRaces(FulfilmentFixture, TransactionTestCase):
    def race(self, calls):
        from concurrent.futures import ThreadPoolExecutor
        from threading import Barrier
        from django.db import connections

        barrier = Barrier(len(calls))

        def execute(call):
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
            return list(pool.map(execute, calls))

    def test_same_dispatch_packet_two_connections_has_one_real_stock_effect(self):
        order = self.accept()
        self.prepare(order)
        packet = self.dispatch_packet(order)
        results = self.race([lambda: services.mutate(self.seller, order.pk, "dispatch", packet)] * 2)
        self.assertEqual([row[0] for row in results], ["ok", "ok"])
        self.assertEqual(results[0][1], results[1][1])
        self.assertEqual(m.Shipment.objects.count(), 1)
        self.assertEqual(Bucket.objects.get().physical, 99)

    def test_different_commands_same_order_have_one_winner(self):
        order = self.accept()
        self.prepare(order)
        packets = [self.dispatch_packet(order), self.dispatch_packet(order)]
        results = self.race(
            [lambda packet=packet: services.mutate(self.seller, order.pk, "dispatch", packet) for packet in packets]
        )
        self.assertEqual(sorted(row[0] for row in results), ["conflict", "ok"])
        self.assertEqual((m.Shipment.objects.count(), Bucket.objects.get().physical), (1, Decimal(99)))

    def test_competing_orders_last_stock_have_one_dispatch_and_retained_shortage(self):
        from apps.inventory import services as stock
        from apps.inventory.models import Position

        first = self.accept()
        self.prepare(first)
        second = self.accept()
        self.prepare(second)
        stock.manual(
            self.seller,
            self.profile.pk,
            self.variant.pk,
            {
                "token": uuid.uuid4(),
                "version": Position.objects.get(pk=self.variant.pk).version,
                "quantity": "-99.000",
                "reason": "Only final unit remains for competing orders",
            },
            adjustment=True,
        )
        packets = [self.dispatch_packet(first), self.dispatch_packet(second)]
        results = self.race(
            [
                lambda order=order, packet=packet: services.mutate(self.seller, order.pk, "dispatch", packet)
                for order, packet in zip([first, second], packets, strict=True)
            ]
        )
        self.assertEqual([row[0] for row in results], ["ok", "ok"])
        self.assertEqual(sorted(row[1]["state"] for row in results), ["blocked", "dispatched"])
        self.assertEqual(
            (m.Shipment.objects.count(), m.DispatchAttempt.objects.count(), Bucket.objects.get().physical),
            (1, 1, Decimal(0)),
        )

    def test_recipient_revision_racing_dispatch_never_publishes_stale_recipient(self):
        order = self.accept()
        self.prepare(order)
        packet = self.dispatch_packet(order)
        data = {
            "command_id": uuid.uuid4(),
            "version": packet["version"],
            "goods_version": packet["goods_version"],
            "recipient_revision": 1,
            "name": "Concurrent synthetic recipient",
            "phone": "000-RACE",
            "address": "Concurrent private synthetic address",
            "reason": "Buyer revises before dispatch",
        }
        results = self.race(
            [
                lambda: services.mutate(self.buyer, order.pk, "recipient", data),
                lambda: services.mutate(self.seller, order.pk, "dispatch", packet),
            ]
        )
        self.assertEqual(sorted(row[0] for row in results), ["conflict", "ok"])
        if m.Shipment.objects.exists():
            self.assertEqual(m.Recipient.objects.get(order=order).revision, 1)
        else:
            self.assertEqual(Bucket.objects.get().physical, 100)

    def test_cancellation_and_dispatch_serialize_without_undoing_a_real_shipment(self):
        order = self.accept()
        self.prepare(order)
        packet = self.dispatch_packet(order)
        hold = {
            "command_id": uuid.uuid4(),
            "version": packet["version"],
            "goods_version": packet["goods_version"],
            "kind": "cancellation",
            "reason": "Concurrent pending operational cancellation",
        }
        results = self.race(
            [
                lambda: services.mutate(self.root, order.pk, "blocker", hold),
                lambda: services.mutate(self.seller, order.pk, "dispatch", packet),
            ]
        )
        self.assertEqual(sorted(row[0] for row in results), ["conflict", "ok"])
        shipped = m.Shipment.objects.filter(order=order).exists()
        if shipped:
            self.command(order, "blocker", self.root, kind="cancellation", reason="Retained hold after actual dispatch")
        else:
            self.assertEqual(self.send(order)["code"], "cancellation_hold")
        self.assertEqual(m.Blocker.objects.filter(order=order).count(), 1)
        self.assertEqual(Bucket.objects.get().physical, Decimal(99 if shipped else 100))
        self.assertEqual(m.Shipment.objects.filter(order=order).count(), int(shipped))

    def test_new_charge_approval_and_old_dispatch_packet_cannot_both_publish(self):
        order = self.accept()
        self.prepare(order)
        self.command(
            order,
            "charge",
            provider=m.Arrangement.objects.get(order=order).provider_id,
            amount="3.00",
            currency="AFN",
            reason="Changed provider charge needs independent decision",
        )
        case = m.ReviewCase.objects.filter(order=order, kind="charge", state="open").get()
        self.review(case, "assign", assigned_to=self.root.user.pk)
        packet = self.dispatch_packet(order)
        decision = {
            "command_id": uuid.uuid4(),
            "version": packet["version"],
            "goods_version": packet["goods_version"],
            "case": case.pk,
            "case_version": case.version,
            "reason": "Independent concurrent final delivery charge",
        }
        case.refresh_from_db()
        decision["case_version"] = case.version
        results = self.race(
            [
                lambda: services.mutate(self.root, order.pk, "case_approve", decision),
                lambda: services.mutate(self.seller, order.pk, "dispatch", packet),
            ]
        )
        self.assertEqual(sorted(row[0] for row in results), ["conflict", "ok"])
        shipment = m.Shipment.objects.filter(order=order).first()
        if shipment:
            self.assertEqual(shipment.charge.amount, Decimal(0))
            with self.assertRaises(Conflict):
                self.review(case, "approve")
        else:
            self.assertEqual(queries.current_charge(order).amount, Decimal(3))
            self.assertEqual(Bucket.objects.get().physical, 100)

    def test_dispute_and_last_goods_receipt_keep_current_completion_truth(self):
        order = self.accept()
        self.prepare(order)
        self.send(order)
        self.command(
            order,
            "deliver",
            self.buyer,
            occurred_at=timezone.now(),
            reason="Whole actual delivery before final goods funds",
        )
        state = m.State.objects.get(order=order)
        hold = {
            "command_id": uuid.uuid4(),
            "version": state.version,
            "goods_version": Finance.objects.get(order=order).version,
            "kind": "dispute",
            "reason": "Concurrent unresolved operational dispute",
        }
        results = self.race(
            [
                lambda: services.mutate(self.root, order.pk, "blocker", hold),
                lambda: self.goods(order),
            ]
        )
        if results[0][0] == "conflict":
            self.command(
                order, "blocker", self.root, kind="dispute", reason="Retain the dispute after the concurrent receipt"
            )
        self.assertEqual(results[1][0], "ok")
        self.assertEqual(m.Blocker.objects.filter(order=order).count(), 1)
        self.assertLessEqual(m.Completion.objects.filter(order=order).count(), 1)
        expected = "completed_with_exception" if m.Completion.objects.filter(order=order).exists() else "incomplete"
        self.assertEqual(queries.dimensions(order)["completion"], expected)
        self.assertEqual(Bucket.objects.get().physical, 99)

    def test_original_reservation_recovery_racing_dispatch_never_reserves_twice(self):
        from apps.payments.allocation import execute
        from apps.inventory.models import Allocation

        order = self.accept("advance")
        self.prepare(order)
        allocation = Allocation.objects.get()
        packet = self.dispatch_packet(order)
        results = self.race(
            [
                lambda: execute(order.pk),
                lambda: services.mutate(self.seller, order.pk, "dispatch", packet),
            ]
        )
        self.assertEqual([row[0] for row in results], ["ok", "ok"])
        self.assertIsNone(results[0][1])
        self.assertEqual(Allocation.objects.get().pk, allocation.pk)
        self.assertEqual(
            (m.Shipment.objects.count(), Bucket.objects.get().physical, Bucket.objects.get().held),
            (1, Decimal(99), Decimal(0)),
        )

    def test_goods_correction_racing_delivery_retains_at_most_one_historical_completion(self):
        from apps.payments import models as p

        order = self.accept()
        self.prepare(order)
        self.send(order)
        self.goods(order)
        receipt = p.Receipt.objects.get(order=order)
        payments.mutate(
            self.seller,
            order.pk,
            "correction",
            {
                "command_id": uuid.uuid4(),
                "version": Finance.objects.get(order=order).version,
                "receipt": receipt.pk,
                "receipt_version": 1,
                "amount": "0.00",
                "paid_at": receipt.paid_at,
                "description": "Corrected actual goods funds",
                "reason": "Independent downward correction before or after delivery",
            },
        )
        case = p.ReviewCase.objects.get(order=order, kind="correction")
        payments.decide(
            self.root,
            case.pk,
            {
                "command_id": uuid.uuid4(),
                "version": Finance.objects.get(order=order).version,
                "case_version": case.version,
                "action": "assign",
                "assigned_to": self.root.user.pk,
                "reason": "Independent correction assignment",
            },
        )
        case.refresh_from_db()
        decision = {
            "command_id": uuid.uuid4(),
            "version": Finance.objects.get(order=order).version,
            "case_version": case.version,
            "action": "approve",
            "reason": "Independent concurrent downward goods correction",
        }
        state = m.State.objects.get(order=order)
        delivery = {
            "command_id": uuid.uuid4(),
            "version": state.version,
            "goods_version": decision["version"],
            "occurred_at": timezone.now(),
            "reason": "Whole actual delivery concurrent with correction",
        }
        results = self.race(
            [
                lambda: payments.decide(self.root, case.pk, decision),
                lambda: services.mutate(self.buyer, order.pk, "deliver", delivery),
            ]
        )
        self.assertEqual(results[0][0], "ok")
        if results[1][0] == "conflict":
            self.command(
                order,
                "deliver",
                self.buyer,
                occurred_at=timezone.now(),
                reason="Retain actual delivery with freshly reviewed goods version",
            )
        self.assertEqual(m.Delivery.objects.filter(order=order).count(), 1)
        self.assertLessEqual(m.Completion.objects.filter(order=order).count(), 1)
        expected = "completed_with_exception" if m.Completion.objects.filter(order=order).exists() else "incomplete"
        self.assertEqual(queries.dimensions(order)["completion"], expected)
        self.assertEqual((Bucket.objects.get().physical, Bucket.objects.get().held), (Decimal(99), Decimal(0)))

    def test_busy_business_rotates_bounded_recovery_and_fanout_without_waiting(self):
        from concurrent.futures import ThreadPoolExecutor
        from django.db import connections
        from apps.organizations.models import BusinessProfile
        from apps.fulfilment.completion import recover
        from apps.fulfilment.jobs import fanout

        order = self.accept()
        self.prepare(order)
        cursor = m.NoticeCursor.objects.filter(event__order=order).first()
        old_state = m.State.objects.get(order=order).next_check_at
        old_cursor = cursor.next_check_at

        def run():
            connections.close_all()
            try:
                return recover(order.pk), fanout(cursor.pk)
            finally:
                connections.close_all()

        with transaction.atomic():
            BusinessProfile.objects.select_for_update().get(pk=order.seller_id)
            with ThreadPoolExecutor(max_workers=1) as pool:
                self.assertEqual(pool.submit(run).result(timeout=5), (False, None))
        cursor.refresh_from_db()
        self.assertGreater(m.State.objects.get(order=order).next_check_at, old_state)
        self.assertGreater(cursor.next_check_at, old_cursor)
        self.assertFalse(cursor.done)
        self.assertIsNone(cursor.after)


@override_settings(OWNER_MFA_REQUIRED=False)
class FulfilmentBatchTests(FulfilmentFixture, TestCase):
    def batch_stock(self, expiry=None):
        from apps.inventory import services as stock
        from apps.inventory.models import Position, Batch

        import copy
        from apps.catalogue import services as catalogue
        from apps.catalogue.media import upload
        from apps.catalogue.models import Product, Variant
        from tests.test_catalogue import image_file

        created = catalogue.create(self.seller, {"seller": self.profile.pk, "currency": "AFN", "pricing_mode": "fixed"})
        product = Product.objects.get(pk=created["id"])
        image = upload(self.seller, product.pk, product.version, image_file())
        product.refresh_from_db()
        body = copy.deepcopy(self.body)
        body["images"] = [{"id": image["id"], "alt": "Synthetic batch fulfilment goods", "variant": None}]
        body["variants"][0].update(sku="P13-BATCH")
        body["variants"][0].pop("id", None)
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
                    "reason": "Reviewed synthetic batch stock",
                },
            )
        self.product = product
        self.variant = Variant.objects.get(product=product)
        stock.configure(
            self.seller,
            self.profile.pk,
            self.variant.pk,
            {
                "token": uuid.uuid4(),
                "version": 0,
                "tracking": "batch",
                "expiry_required": bool(expiry),
                "threshold": None,
                "reason": "Switch empty synthetic position to batch",
            },
        )
        lines = []
        for code, quantity in [("P13-FIRST", "0.625"), ("P13-SECOND", "0.375")]:
            stock.manual(
                self.seller,
                self.profile.pk,
                self.variant.pk,
                {
                    "token": uuid.uuid4(),
                    "version": Position.objects.get(pk=self.variant.pk).version,
                    "quantity": quantity,
                    "batch_code": code,
                    "expires_on": expiry,
                    "reason": "Explicit synthetic batch receipt",
                },
            )
            lines.append(
                {"variant": str(self.variant.pk), "batch": str(Batch.objects.get(code=code).pk), "quantity": quantity}
            )
        return lines

    def test_whole_multibatch_cod_deducts_every_selected_bucket_once(self):
        lines = self.batch_stock()
        order = self.accept()
        self.prepare(order, lines=lines)
        result = self.send(order)
        self.assertEqual(result["state"], "dispatched")
        shipment = m.Shipment.objects.get()
        self.assertEqual(shipment.operation.movements.count(), 2)
        self.assertEqual(sum(Bucket.objects.filter(position_id=self.variant.pk).values_list("physical", flat=True)), 0)
        self.assertEqual(sum(Bucket.objects.filter(position_id=self.variant.pk).values_list("held", flat=True)), 0)

    def test_whole_multibatch_advance_consumes_exact_original_reservation(self):
        lines = self.batch_stock()
        order = self.accept("advance")
        self.prepare(order, lines=lines)
        self.assertEqual(sum(Bucket.objects.filter(position_id=self.variant.pk).values_list("held", flat=True)), 1)
        self.send(order)
        self.assertEqual(m.Shipment.objects.get().operation.movements.count(), 2)
        self.assertEqual(sum(Bucket.objects.filter(position_id=self.variant.pk).values_list("held", flat=True)), 0)

    def test_omitted_substituted_or_excess_quantity_never_prepares_partial_order(self):
        from rest_framework.exceptions import ValidationError

        lines = self.batch_stock()
        order = self.accept()
        self.prepare(order, lines=lines)
        current = m.Preparation.objects.get()
        for proposed in [
            lines[:1],
            [{**lines[0], "quantity": "0.750"}, lines[1]],
            [{**lines[0], "variant": str(uuid.uuid4())}, lines[1]],
        ]:
            with self.subTest(lines=proposed), self.assertRaises(ValidationError):
                self.command(
                    order,
                    "prepare",
                    recipient=current.recipient_id,
                    arrangement=current.arrangement_id,
                    lines=proposed,
                    reason="Invalid incomplete or substituted selection",
                )
        self.assertEqual(m.Preparation.objects.count(), 1)
        self.assertFalse(m.Shipment.objects.exists())

    def test_existing_advance_hold_expiry_at_actual_kabul_midnight_keeps_all_stock_and_money(self):
        from contextlib import contextmanager
        from datetime import datetime, timezone as utc
        from django.db import connection
        from apps.payments.queries import confirmed

        before = datetime(2030, 1, 2, 19, 29, 59, tzinfo=utc.utc)
        after = before + timedelta(seconds=1)

        @contextmanager
        def at(moment):
            with connection.cursor() as cursor:
                cursor.execute("SET timestamp=%s", [int(moment.timestamp())])
                cursor.execute("SELECT UTC_TIMESTAMP()")
                self.assertEqual(cursor.fetchone()[0], moment.replace(tzinfo=None))
            try:
                with patch("django.utils.timezone.now", return_value=moment):
                    yield
            finally:
                with connection.cursor() as cursor:
                    cursor.execute("SET timestamp=DEFAULT")

        # A cached, previously authenticated actor remains fresh; only the
        # owned SQL/Python business clocks move together. No guard is mocked.
        for principal in [self.seller, self.buyer, self.root, self.reviewer]:
            principal.account
        with at(before):
            lines = self.batch_stock("2030-01-02")
            order = self.accept("advance")
            self.prepare(order, lines=lines)
            self.assertEqual(sum(Bucket.objects.filter(position_id=self.variant.pk).values_list("held", flat=True)), 1)
        with at(after):
            result = self.send(order)
            self.assertEqual(result["code"], "stock_expired_inactive_or_unavailable")
            self.assertEqual(confirmed(order), Decimal("12.50"))
            self.assertEqual(sum(Bucket.objects.filter(position_id=self.variant.pk).values_list("held", flat=True)), 1)
            self.assertEqual(
                sum(Bucket.objects.filter(position_id=self.variant.pk).values_list("physical", flat=True)), 1
            )
            self.assertFalse(m.Shipment.objects.exists())
            self.assertTrue(m.ReviewCase.objects.filter(order=order, kind="stock").exists())

    def test_inactive_selected_stock_blocks_and_preserves_original_advance_hold(self):
        order = self.accept("advance")
        self.prepare(order)
        self.body["variants"][0]["id"] = str(self.variant.pk)
        self.body["variants"][0]["active"] = False
        # A valid catalogue publication still requires one active variant.
        # Keep the accepted/held variant inactive while adding an unrelated one.
        import copy

        alternative = copy.deepcopy(self.body["variants"][0])
        alternative.pop("id")
        alternative.update(sku="P13-UNRELATED-ACTIVE", active=True, attributes={"pack_size": "large"})
        self.body["variants"].append(alternative)
        self.publish(self.save())
        self.assertEqual(self.send(order)["code"], "stock_expired_inactive_or_unavailable")
        self.assertEqual(Bucket.objects.get().held, 1)
        self.assertFalse(m.Shipment.objects.exists())

    def test_raw_sql_cannot_rewrite_successful_shipment_or_its_money_snapshot(self):
        from django.db import connection

        order = self.accept()
        self.prepare(order)
        self.send(order)
        with self.assertRaises(DatabaseError) as error, transaction.atomic(), connection.cursor() as cursor:
            cursor.execute("UPDATE fulfilment_shipment SET goods_confirmed=1.00 WHERE order_id=%s", [order.pk.hex])
        self.assertEqual(error.exception.args[0], 1644)
        self.assertEqual((m.Shipment.objects.count(), Bucket.objects.get().physical), (1, Decimal(99)))

    def multi_variant(self, method):
        import copy
        from apps.catalogue.models import Variant

        self.body["variants"][0]["id"] = str(self.variant.pk)
        second_body = copy.deepcopy(self.body["variants"][0])
        second_body.pop("id", None)
        self.body["variants"].append({**second_body, "sku": "P13-SECOND", "attributes": {"pack_size": "large"}})
        saved = self.save()
        self.publish(saved)
        second = Variant.objects.get(product=self.product, sku="P13-SECOND")
        self.seed_stock(second)
        self.add()
        self.add(second, quantity="2.000")
        orders.submit(self.buyer, self.packet(method))
        order = SellerOrder.objects.get()
        lines = [
            {"variant": str(self.variant.pk), "batch": None, "quantity": "1.000"},
            {"variant": str(second.pk), "batch": None, "quantity": "2.000"},
        ]
        self.prepare(order, goods_amount="37.50", lines=lines)
        return order

    def test_whole_multivariant_cod_keeps_exact_accepted_quantities(self):
        order = self.multi_variant("cod")
        self.send(order)
        self.assertEqual(m.Shipment.objects.get().operation.movements.count(), 2)
        self.assertEqual(sum(Bucket.objects.values_list("physical", flat=True)), 197)
        self.assertEqual(sum(Bucket.objects.values_list("held", flat=True)), 0)

    def test_whole_multivariant_advance_consumes_every_original_held_line(self):
        order = self.multi_variant("advance")
        self.assertEqual(sum(Bucket.objects.values_list("held", flat=True)), 3)
        self.send(order)
        self.assertEqual(m.Shipment.objects.get().operation.movements.count(), 2)
        self.assertEqual(sum(Bucket.objects.values_list("physical", flat=True)), 197)
        self.assertEqual(sum(Bucket.objects.values_list("held", flat=True)), 0)


@override_settings(OWNER_MFA_REQUIRED=False)
class FulfilmentReviewCorrections(FulfilmentFixture, TestCase):
    batch_stock = FulfilmentBatchTests.batch_stock

    def expired_preparation(self, *, reprepare):
        from contextlib import contextmanager
        from datetime import datetime, timezone as utc
        from django.db import connection
        from apps.payments.queries import confirmed

        before = datetime(2030, 1, 2, 19, 29, 59, tzinfo=utc.utc)
        after = before + timedelta(seconds=1)

        @contextmanager
        def at(moment):
            with connection.cursor() as cursor:
                cursor.execute("SET timestamp=%s", [int(moment.timestamp())])
            try:
                with patch("django.utils.timezone.now", return_value=moment):
                    yield
            finally:
                with connection.cursor() as cursor:
                    cursor.execute("SET timestamp=DEFAULT")

        for actor in [self.seller, self.buyer, self.root, self.reviewer]:
            actor.account
        with at(before):
            lines = self.batch_stock("2030-01-02")
            order = self.accept("advance")
            person = self.command(
                order,
                "recipient",
                self.buyer,
                recipient_revision=0,
                name="Synthetic retained recipient",
                phone="000-TEST",
                address="Synthetic address",
                instructions="Synthetic only",
                reason="Initial recipient",
            )
            arrangement = self.command(
                order,
                "arrange",
                arranger="seller",
                provider="Synthetic provider",
                self_delivery=False,
                instructions="Manual whole delivery",
            )
            payments.mutate(
                self.seller,
                order.pk,
                "plan",
                {
                    "command_id": uuid.uuid4(),
                    "version": Finance.objects.get(order=order).version,
                    "intent_version": 0,
                    "reason": "Whole original allocation",
                    "lines": lines,
                },
            )
            self.goods(order)
            fields = {
                "recipient": person["recipient"],
                "arrangement": arrangement["arrangement"],
                "reason": "Prepare exact retained stock",
            }
            if reprepare:
                self.command(order, "prepare", **fields)
        with at(after):
            if reprepare:
                person = self.command(
                    order,
                    "recipient",
                    self.buyer,
                    recipient_revision=1,
                    name="Synthetic revised recipient",
                    phone="000-TEST",
                    address="Revised address",
                    instructions="Synthetic only",
                    reason="Supersede prepared recipient",
                )
                fields["recipient"] = person["recipient"]
            original = list(
                Bucket.objects.filter(position_id=self.variant.pk).order_by("pk").values_list("pk", "physical", "held")
            )
            moves = Movement.objects.count()
            key = uuid.uuid4()
            body = {
                "command_id": key,
                "version": m.State.objects.get(order=order).version,
                "goods_version": Finance.objects.get(order=order).version,
                **fields,
            }
            outcome = services.mutate(self.seller, order.pk, "prepare", body)
            self.assertEqual(outcome["state"], "blocked")
            self.assertEqual(outcome["code"], "stock_expired_inactive_or_unavailable")
            self.assertEqual(services.mutate(self.seller, order.pk, "prepare", body), outcome)
            repeated = self.command(order, "prepare", **fields)
            self.assertEqual(repeated["state"], "blocked")
            from apps.fulfilment.completion import recover

            recover(order.pk)
            self.assertEqual(m.ReviewCase.objects.filter(order=order, kind="stock", state="open").count(), 1)
            self.assertEqual(m.Preparation.objects.filter(order=order).count(), int(reprepare))
            self.assertFalse(m.Shipment.objects.filter(order=order).exists())
            self.assertEqual(confirmed(order), Decimal("12.50"))
            self.assertEqual(Movement.objects.count(), moves)
            self.assertEqual(
                list(
                    Bucket.objects.filter(position_id=self.variant.pk)
                    .order_by("pk")
                    .values_list("pk", "physical", "held")
                ),
                original,
            )

    def test_expired_hold_before_first_preparation_retains_one_review(self):
        self.expired_preparation(reprepare=False)

    def test_expired_hold_before_repreparation_retains_old_snapshot_and_one_review(self):
        self.expired_preparation(reprepare=True)

    def test_correction_images_survive_pending_approved_rejected_reload_and_scope_denial(self):
        from apps.fulfilment import media
        from tests.test_catalogue import image_file
        from django.contrib.auth.models import Permission

        order = self.accept()
        self.prepare(order, "5.00")
        original = media.upload(self.buyer, order.pk, uuid.uuid4(), "claim", image_file())
        self.command(
            order,
            "claim",
            self.buyer,
            charge=queries.current_charge(order).pk,
            amount="5.00",
            currency="AFN",
            paid_at=timezone.now() - timedelta(minutes=1),
            description="Synthetic actual provider receipt",
            evidence=[original["id"]],
        )
        case = m.ReviewCase.objects.get(order=order, kind="payment")
        self.review(case, "assign", assigned_to=self.root.user.pk)
        self.review(case, "approve")
        receipt = m.Receipt.objects.get(order=order)
        for version, decision in [(1, "approve"), (2, "reject")]:
            proof = media.upload(self.buyer, order.pk, uuid.uuid4(), "correction", image_file())
            result = self.command(
                order,
                "correction",
                self.buyer,
                receipt=receipt.pk,
                receipt_version=version,
                amount="4.00",
                paid_at=receipt.claim.paid_at,
                description="Corrected provider receipt",
                reason="Retained synthetic correction proof",
                evidence=[proof["id"]],
            )
            case = m.ReviewCase.objects.get(pk=m.Correction.objects.get(pk=result["correction"]).case.pk)
            for principal in [self.buyer, self.seller]:
                row = next(
                    x for x in queries.detail(principal, order.pk)["corrections"] if x["id"] == result["correction"]
                )
                self.assertEqual(row["evidence"], [proof["id"]])
                self.assertEqual(row["state"], "open")
            self.group.permissions.add(
                *Permission.objects.filter(
                    content_type__app_label="fulfilment",
                    codename__in=["read_fulfilment", "correct_delivery_payment", "read_delivery_evidence"],
                )
            )
            self.review(case, "assign", assigned_to=self.staff.user.pk)
            self.assertIn(
                proof["id"],
                next(x for x in queries.detail(self.staff, order.pk)["corrections"] if x["id"] == result["correction"])[
                    "evidence"
                ],
            )
            self.group.permissions.remove(
                Permission.objects.get(content_type__app_label="fulfilment", codename="read_delivery_evidence")
            )
            self.assertEqual(
                next(x for x in queries.detail(self.staff, order.pk)["corrections"] if x["id"] == result["correction"])[
                    "evidence"
                ],
                [],
            )
            self.assertIn(
                self.staff_client.head(
                    reverse("admin:fulfilment_evidence_bytes", args=[proof["id"]]), {"case": str(case.pk)}
                ).status_code,
                [403, 404],
            )
            self.review(case, "assign", assigned_to=self.root.user.pk)
            self.review(case, decision)
            response = self.buyer_client.get(f"/api/v1/fulfilment/buyer/orders/{order.pk}/")
            self.assertEqual(response.status_code, 200)
            row = next(x for x in response.json()["corrections"] if x["id"] == result["correction"])
            self.assertEqual(row["evidence"], [proof["id"]])
            self.assertEqual(row["state"], "approved" if decision == "approve" else "rejected")
            self.assertEqual(
                self.buyer_client.head(f"/api/v1/fulfilment/buyer/evidence/{proof['id']}/").status_code, 200
            )
            self.assertEqual(
                self.other_client.get(f"/api/v1/fulfilment/buyer/evidence/{proof['id']}/").status_code, 404
            )
            self.assertEqual(
                m.EvidenceBinding.objects.filter(claim=receipt.claim).get().evidence_id, uuid.UUID(original["id"])
            )
        self.assertEqual(queries.delivery_total(order), Decimal("4.00"))
        self.assertEqual(receipt.claim.amount, Decimal("5.00"))

    def test_native_handover_uses_document_only_style_font_policy(self):
        order = self.accept()
        self.prepare(order)
        self.send(order)
        for locale in ["fa-AF", "ps", "ar", "en"]:
            response = self.root_client.get(
                reverse("admin:fulfilment_state_handover", args=[order.pk]), {"locale": locale, "format": "html"}
            )
            self.assertEqual(response.status_code, 200)
            self.assertIn(b"<style>", response.content)
            self.assertIn(b"data:font/ttf;base64,", response.content)
            policy = response["Content-Security-Policy"]
            self.assertIn("font-src data:", policy)
            self.assertIn("style-src 'unsafe-inline'", policy)
            self.assertIn("default-src 'none'", policy)
            self.assertIn("frame-ancestors 'none'", policy)
            self.assertIn("no-store", response["Cache-Control"])
            from urllib.parse import urlencode

            private_path = reverse("admin:fulfilment_state_handover", args=[order.pk])
            denied = self.other_client.get(private_path, {"format": "html"})
            # OwnerSite.has_permission rejects buyer context before this view;
            # Django AdminSite.admin_view sends exactly the native login redirect.
            self.assertRedirects(
                denied,
                reverse("admin:login") + "?" + urlencode({"next": private_path + "?format=html"}),
                status_code=302,
                fetch_redirect_response=False,
            )
            self.assertNotIn(b"Synthetic private address", denied.content)
