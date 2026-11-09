"""Retained-graph recovery regressions; execute only in the owned MariaDB runner.

These exercise historical validation and the NativeImporter pre-publication
boundary, not a full native snapshot/private-file restoration rehearsal.
"""

import hashlib
import tempfile
import uuid
from datetime import timedelta
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import Mock, patch

from django.db import connection
from django.test import SimpleTestCase, TransactionTestCase, override_settings
from django.utils import timezone

from apps.accounts.models import Account, User
from apps.fulfilment import models as delivery
from apps.messaging import cases, media as message_media, models as messaging, recovery as reports, services as messages
from apps.orders import models as orders, recovery
from apps.organizations.models import Membership
from apps.payments import models as payments, media as payment_media
from apps.runtime import native_restore, transfer
from apps.runtime.mariadb import schema
from config.testing import assert_owned_database, ownership_manifest, run_id
from tests.test_catalogue import image_file
from tests.test_dispute_reports import ReportFixture


@override_settings(OWNER_MFA_REQUIRED=False)
class DisputeRecoveryTests(ReportFixture, TransactionTestCase):
    @contextmanager
    def guardfree(self, model):
        """Only exact reviewed guards in this run's disposable unit DB are removed."""
        assert_owned_database(connection)
        self.assertEqual(connection.vendor, "mysql")
        self.assertEqual(connection.settings_dict["NAME"], "test_rezayi_" + run_id() + "_unit")
        table = model._meta.db_table
        final = {}
        for statement in schema.reference(5)["ddl"]:
            if statement.startswith("CREATE TRIGGER") and f" ON `{table}` " in statement:
                final[statement.split("`", 2)[1]] = statement
        self.assertTrue(final, "Require actual native guards, not an unprotected fixture.")
        dropped = []
        try:
            with connection.cursor() as cursor:
                inventory = schema.guard_inventory(cursor)
                for name in final:
                    self.assertEqual(inventory.get(name), schema.reference(5)["triggers"][name])
                    cursor.execute("DROP TRIGGER `" + name + "`")
                    dropped.append(name)
            yield
        finally:
            with connection.cursor() as cursor:
                for name in dropped:
                    cursor.execute(final[name])
                inventory = schema.guard_inventory(cursor)
                for name in dropped:
                    self.assertEqual(inventory[name], schema.reference(5)["triggers"][name])

    @contextmanager
    def malformed(self, model, pk, **changes):
        manager = getattr(model, "construction", model.objects)
        original = manager.filter(pk=pk).values(*changes).get()
        with self.guardfree(model):
            try:
                manager.filter(pk=pk).update(**changes)
                yield
            finally:
                manager.filter(pk=pk).update(**original)

    @contextmanager
    def missing(self, model, pk):
        manager = getattr(model, "construction", model.objects)
        original = manager.filter(pk=pk).values().get()
        with self.guardfree(model):
            manager.filter(pk=pk).delete()
            try:
                yield
            finally:
                manager.create(**original)
                if "created_at" in original:
                    manager.filter(pk=pk).update(created_at=original["created_at"])

    def assert_refused_before_publication(self, model):
        """Real canonical row hashes can match while retained graph semantics fail."""
        assert_owned_database(connection)
        root = Path(ownership_manifest()["root"])
        with tempfile.TemporaryDirectory(prefix="dispute-recovery-", dir=root) as directory:
            directory = Path(directory)
            directory.chmod(0o700)
            table = model._meta.db_table
            kinds = transfer.field_kinds()[table]
            names = list(kinds)
            quoted = ",".join(connection.ops.quote_name(name) for name in names)
            with connection.cursor() as cursor:
                cursor.execute("SELECT " + quoted + " FROM " + connection.ops.quote_name(table)
                               + " ORDER BY " + connection.ops.quote_name(model._meta.pk.column))
                rows = [[transfer.encode(value, kinds[name], "mysql") for name, value in zip(names, row, strict=True)]
                        for row in cursor.fetchall()]
            data = "".join(transfer.canonical(row) + "\n" for row in rows).encode()
            path = directory / (table + ".jsonl")
            path.write_bytes(data)
            path.chmod(0o600)
            importer = object.__new__(native_restore.NativeImporter)
            importer.directory = directory
            importer.version = 5
            importer.manifest = {"native_schema_version": 5}
            importer.tables = {table: {"count": len(rows), "sha256": hashlib.sha256(data).hexdigest()}}
            importer.structure = {table: {
                "names": names, "primary": model._meta.pk.column,
                "fields": [{"name": name, "kind": kinds[name]} for name in names],
            }}
            importer.journal = Mock(state="loading")
            # This is an already-loaded, checksummed table slice, not an attempt
            # to initialize a restore over a serving/current schema.
            self.assertEqual(importer.verify_rows()[table], importer.tables[table])
            with patch("apps.runtime.models.Schema.objects.exists", return_value=True), \
                 patch.object(native_restore, "validate_evidence"), \
                 patch("apps.fulfilment.recovery.validate_evidence"), \
                 patch.object(native_restore, "publish") as publish:
                with self.assertRaises(transfer.TransferError):
                    importer.run()
                publish.assert_not_called()
                importer.journal.save.assert_not_called()
                self.assertEqual(importer.journal.state, "loading")

    def closed_dispute(self, *, refund=False, order=None):
        row = self.open_dispute(order or self.completed())
        self.respond_dispute(row)
        self.assign_dispute(row)
        self.decide_dispute(row, "refund" if refund else "resolve", **({"amount": "5.00"} if refund else {}))
        row.refresh_from_db()
        return row

    def test_valid_pending_withdrawn_decided_and_review_histories(self):
        order = self.completed()
        first = self.open_dispute(order)
        self.withdraw_dispute(first)
        self.closed_dispute(order=order)
        self.open_dispute(order)
        review = self.submit_review(order)
        self.moderate_review(review)
        self.moderate_review(review, "withdraw")
        recovery.validate_history()

    def test_revoked_seller_membership_bundles_accounts_and_staff_groups_remain_valid_history(self):
        order = self.company_order(complete=True)
        seller, _, membership = self.seller_member(order)
        decider, _ = self.dispute_reviewer()
        row = self.open_dispute(order)
        self.respond_dispute(row, actor=seller)
        self.assign_dispute(row, assigned_to=decider.user.pk)
        self.decide_dispute(row, actor=decider)
        review = self.submit_review(order)
        moderator, _ = self.dispute_reviewer("historical-moderator", role="review_moderators")
        self.moderate_review(review, actor=moderator)
        report = self.target_report("order", order, actor=seller)
        self.transition_report(report, "assign", assigned_to=self.staff.account.pk)
        self.transition_report(report, "resolve")
        Membership.objects.filter(pk=membership.pk).update(active=False, bundles=[], revoked_at=timezone.now())
        decider.user.groups.clear()
        moderator.user.groups.clear()
        self.staff.user.groups.clear()
        Account.objects.filter(pk__in=[seller.account.pk, decider.account.pk, moderator.account.pk,
                                      self.staff.account.pk, self.buyer.account.pk]).update(status="suspended")
        User.objects.filter(pk__in=[seller.user.pk, decider.user.pk, moderator.user.pk,
                                   self.staff.user.pk, self.buyer.user.pk]).update(is_active=False, email_verified=False)
        recovery.validate_history()
        reports.validate_history()

    def test_checksums_do_not_authorize_cross_buyer_opening(self):
        row = self.open_dispute(self.completed())
        with self.malformed(orders.DisputeRequest, row.pk, requester_account_id=self.other_buyer.account.pk):
            self.assert_refused_before_publication(orders.DisputeRequest)

    def test_opening_action_actor_and_command_target_are_exact(self):
        row = self.open_dispute(self.completed())
        for changes in ({"action": "review_submitted"}, {"actor_id": self.other_buyer.user.pk}):
            with self.subTest(changes=changes), self.malformed(orders.AftercareEvent, row.event_id, **changes):
                self.assert_refused_before_publication(orders.AftercareEvent)
        command = orders.AftercareCommand.objects.get(event_id=row.event_id)
        for target in (str(self.other_buyer.account.pk), "malformed-uuid"):
            with self.subTest(target=target), self.malformed(
                orders.AftercareCommand, command.pk, result={**command.result, "dispute": target},
            ):
                self.assert_refused_before_publication(orders.AftercareCommand)

    def test_delivery_must_belong_to_the_exact_order_and_precede_opening(self):
        row = self.open_dispute(self.completed())
        fact = delivery.Delivery.objects.get(order_id=row.order_id)
        other = self.accept()
        with self.malformed(delivery.Delivery, fact.pk, order_id=other.pk):
            self.assert_refused_before_publication(delivery.Delivery)
        with self.malformed(delivery.Delivery, fact.pk, created_at=row.event.created_at + timedelta(seconds=1)):
            self.assert_refused_before_publication(delivery.Delivery)

    def test_hold_kind_and_opening_event_identity_are_exact(self):
        row = self.open_dispute(self.completed())
        with self.malformed(delivery.Blocker, row.blocker_id, kind="cancellation"):
            self.assert_refused_before_publication(delivery.Blocker)
        with self.malformed(delivery.Event, row.blocker.event_id, actor_id=self.other_buyer.user.pk):
            self.assert_refused_before_publication(delivery.Event)

    def test_sequential_disputes_cannot_borrow_each_others_opening_hold(self):
        order = self.completed()
        first = self.open_dispute(order)
        self.withdraw_dispute(first)
        second = self.open_dispute(order)
        with self.malformed(orders.DisputeRequest, second.pk, blocker_id=first.blocker_id):
            self.assert_refused_before_publication(orders.DisputeRequest)

    def test_retained_response_requires_its_exact_seller_event(self):
        row = self.open_dispute(self.completed())
        self.respond_dispute(row)
        for changes in ({"actor_id": self.buyer.account.pk}, {"event_id": row.event_id}):
            with self.subTest(changes=changes), self.malformed(orders.DisputeResponse, row.pk, **changes):
                self.assert_refused_before_publication(orders.DisputeResponse)

    def test_terminal_decision_actor_context_action_and_state_must_agree(self):
        row = self.closed_dispute()
        for changes in ({"context": "buyer"}, {"actor_id": self.other_buyer.user.pk}, {"action": "dismissed"}):
            with self.subTest(changes=changes), self.malformed(orders.DisputeDecision, row.pk, **changes):
                self.assert_refused_before_publication(orders.DisputeDecision)
        with self.malformed(orders.DisputeRequest, row.pk, state="pending"):
            self.assert_refused_before_publication(orders.DisputeRequest)
        with self.malformed(orders.DisputeRequest, row.pk, version=row.version + 1):
            self.assert_refused_before_publication(orders.DisputeRequest)

    def test_withdrawal_requires_retained_event_and_exact_closure(self):
        row = self.open_dispute(self.completed())
        self.withdraw_dispute(row)
        recovery.validate_history()
        closure = delivery.BlockerClosure.objects.get(blocker_id=row.blocker_id)
        with self.malformed(delivery.BlockerClosure, closure.pk, disposition="erroneous"):
            self.assert_refused_before_publication(delivery.BlockerClosure)
        with self.missing(delivery.BlockerClosure, closure.pk):
            self.assert_refused_before_publication(delivery.BlockerClosure)
        event = orders.AftercareEvent.objects.get(order_id=row.order_id, action="dispute_withdrawn")
        with self.malformed(orders.AftercareEvent, event.pk, action="dispute_assigned"):
            self.assert_refused_before_publication(orders.AftercareEvent)

    def test_pending_state_cannot_hide_a_retained_closure(self):
        row = self.closed_dispute()
        with self.malformed(orders.DisputeRequest, row.pk, state="pending"):
            self.assert_refused_before_publication(orders.DisputeRequest)

    def test_dispute_refund_requires_same_order_cause_currency_and_exact_amount(self):
        row = self.closed_dispute(refund=True)
        due = payments.RefundDue.objects.get(dispute_decision__dispute=row)
        other = self.completed()
        for changes in ({"order_id": other.pk}, {"cause": "excess"}, {"currency": "USD"}, {"amount": "4.00"}):
            with self.subTest(changes=changes), self.malformed(payments.RefundDue, due.pk, **changes):
                self.assert_refused_before_publication(payments.RefundDue)
        with self.malformed(payments.Event, due.event_id, actor_id=self.other_buyer.user.pk):
            self.assert_refused_before_publication(payments.Event)

    def test_checksums_cannot_replace_a_missing_refund_seal(self):
        row = self.closed_dispute(refund=True)
        due = payments.RefundDue.objects.get(dispute_decision__dispute=row)
        with self.missing(payments.RefundSeal, due.pk):
            self.assert_refused_before_publication(payments.RefundSeal)

    def test_retained_refund_confirmer_is_not_dispute_decider_or_report_evidence_author(self):
        order = self.completed()
        evidence = payment_media.upload(self.buyer, order.pk, uuid.uuid4(), image_file())
        image = payments.Evidence.objects.get(pk=evidence["id"])
        row = self.open_dispute(order, evidence=[evidence["id"]])
        self.assign_dispute(row)
        self.decide_dispute(row, "refund", amount="5.00")
        due = payments.RefundDue.objects.get(dispute_decision__dispute=row)
        self.report(order, due)
        confirmer, _ = self.connected("staff", "recovery-confirmer", group=self.native_group("Goods refund review"))
        self.refund(due, "assign", assigned_to=confirmer.user.pk)
        self.refund(due, "confirm", actor=confirmer)
        decision = payments.RefundDecision.objects.get(report__due=due)
        # Forge a self-consistent owner event/decision: identity checks alone
        # must not allow the original dispute decider to confirm the due.
        with self.malformed(payments.Event, decision.event_id, actor_id=self.root.user.pk, account_id=None, context="owner"), \
             self.malformed(payments.RefundDecision, decision.pk, actor_id=self.root.user.pk, account_id=None, context="owner"):
            self.assert_refused_before_publication(payments.RefundDecision)
        confirmer.user.groups.clear()
        recovery.validate_history()
        # A retained evidence author conflict is User-based, not grant-based.
        with self.malformed(payments.Evidence, image.pk, creator_id=confirmer.account.pk):
            self.assert_refused_before_publication(payments.Evidence)

    def test_review_requires_original_completion_buyer_rating_and_language(self):
        review = self.submit_review(self.completed())
        for changes in ({"buyer_id": self.other_buyer.account.pk}, {"language": "de"}):
            with self.subTest(changes=changes), self.malformed(orders.Review, review.pk, **changes):
                self.assert_refused_before_publication(orders.Review)
        completion = delivery.Completion.objects.get(order_id=review.order_id)
        other_delivery = delivery.Delivery.objects.get(order=self.delivered_order())
        with self.malformed(delivery.Completion, completion.pk, delivery_id=other_delivery.pk):
            self.assert_refused_before_publication(delivery.Completion)

    def test_review_pending_has_no_decisions_and_version_counts_all_history(self):
        review = self.submit_review(self.completed())
        self.moderate_review(review)
        self.moderate_review(review, "withdraw")
        review.refresh_from_db()
        recovery.validate_history()
        for changes in ({"state": "pending"}, {"version": 2}):
            with self.subTest(changes=changes), self.malformed(orders.Review, review.pk, **changes):
                self.assert_refused_before_publication(orders.Review)

    def test_review_moderation_event_action_context_and_chronological_transition(self):
        review = self.submit_review(self.completed())
        self.moderate_review(review)
        self.moderate_review(review, "withdraw")
        first = review.decisions.order_by("event__version").first()
        with self.malformed(orders.AftercareEvent, first.event_id, action="review_withdrawn"):
            self.assert_refused_before_publication(orders.AftercareEvent)
        with self.malformed(orders.ReviewDecision, first.pk, action="rejected"):
            self.assert_refused_before_publication(orders.ReviewDecision)

    def test_reports_validate_all_four_targets_and_retained_order_conversation_access(self):
        targets = self.four_targets()
        for kind, target in targets.items():
            row = self.target_report(kind, target)
            self.transition_report(row, "assign", assigned_to=self.staff.account.pk)
            if kind in {"message", "order"}:
                cases.inspect(self.root, row.pk)
            self.transition_report(row, "resolve")
            self.transition_report(row, "reopen")
        reports.validate_history()

    def test_order_report_cannot_precede_retained_acceptance(self):
        order = self.completed()
        row = self.target_report("order", order)
        reports.validate_history()
        with self.malformed(messaging.Report, row.pk, created_at=order.accepted_at - timedelta(seconds=1)):
            self.assert_refused_before_publication(messaging.Report)

    def test_report_opening_version_transition_and_assignment_corruption_refuse_publication(self):
        row = self.target_report("order", self.completed())
        opening = row.events.get()
        with self.malformed(messaging.CaseEvent, opening.pk, actor_id=self.other_buyer.user.pk):
            self.assert_refused_before_publication(messaging.CaseEvent)
        with self.malformed(messaging.Report, row.pk, version=2):
            self.assert_refused_before_publication(messaging.Report)
        with self.malformed(messaging.Report, row.pk, assigned_to_id=self.staff.account.pk):
            self.assert_refused_before_publication(messaging.Report)
        self.transition_report(row, "resolve")
        event = row.events.get(action="resolve")
        with self.malformed(messaging.CaseEvent, event.pk, action="reopen"):
            self.assert_refused_before_publication(messaging.CaseEvent)

    def test_message_and_order_report_scope_cannot_be_substituted(self):
        room = self.room()
        row = self.target_report("message", room.messages.first())
        with self.malformed(messaging.Report, row.pk, reporter_id=self.other_buyer.account.pk):
            self.assert_refused_before_publication(messaging.Report)
        order = self.completed()
        with self.malformed(messaging.Report, row.pk, message_id=None, order_id=order.pk):
            self.assert_refused_before_publication(messaging.Report)
        row = self.target_report("order", order)
        cases.inspect(self.root, row.pk)
        access = row.accesses.get()
        unrelated = self.enquire(actor=self.other_buyer)
        with self.malformed(messaging.CaseAccess, access.pk, conversation_id=unrelated["conversation"]):
            self.assert_refused_before_publication(messaging.CaseAccess)
        with self.malformed(messaging.CaseAccess, access.pk, target=self.other_buyer.account.pk):
            self.assert_refused_before_publication(messaging.CaseAccess)

    def test_report_snapshot_and_image_access_target_cannot_cross_conversations(self):
        room = self.room()
        own = message_media.upload(self.buyer, room.pk, uuid.uuid4(), image_file())
        messages.send(self.buyer, room.pk, {
            "command_id": uuid.uuid4(), "body": "Retained private image", "images": [uuid.UUID(own["id"])],
        })
        row = self.target_report("order", self.completed())
        cases.attachment(self.root, row.pk, own["id"])
        access = row.accesses.get()
        reports.validate_history()
        with self.malformed(messaging.Conversation, room.pk, snapshot={**room.snapshot, "product": str(uuid.uuid4())}):
            self.assert_refused_before_publication(messaging.Conversation)
        with self.malformed(messaging.CaseAccess, access.pk, target=room.pk):
            self.assert_refused_before_publication(messaging.CaseAccess)
        product_report = self.target_report("product", self.product)
        with self.malformed(messaging.CaseAccess, access.pk, report_id=product_report.pk):
            self.assert_refused_before_publication(messaging.CaseAccess)


class RecoveryVersionRoutingTests(SimpleTestCase):
    def test_native3_and_native4_do_not_query_phase15_tables(self):
        class ValidationBoundary(Exception):
            pass

        for version in (3, 4, 5):
            importer = object.__new__(native_restore.NativeImporter)
            importer.version = version
            importer.manifest = {"native_schema_version": version}
            importer.verify_rows = Mock(return_value={})
            importer.journal = Mock()
            importer.journal.save.side_effect = ValidationBoundary
            with self.subTest(version=version), \
                 patch("apps.runtime.models.Schema.objects.exists", return_value=True), \
                 patch.object(transfer, "validate_history"), \
                 patch.object(native_restore, "validate_payments"), \
                 patch.object(native_restore, "validate_evidence"), \
                 patch("apps.fulfilment.recovery.validate_history"), \
                 patch("apps.fulfilment.recovery.validate_evidence"), \
                 patch.object(recovery, "validate_history") as aftercare, \
                 patch.object(reports, "validate_history") as report_validator, \
                 patch.object(native_restore, "publish") as publish:
                with self.assertRaises(ValidationBoundary):
                    importer.run()
                if version >= 4:
                    aftercare.assert_called_once_with(include_disputes=version >= 5)
                else:
                    aftercare.assert_not_called()
                self.assertEqual(report_validator.call_count, int(version == 5))
                publish.assert_not_called()

    def test_report_target_xor_rejects_zero_and_multiple_retained_targets(self):
        from types import SimpleNamespace

        for values in ((None, None, None, None), ("message", "product", None, None)):
            report = SimpleNamespace(**dict(zip((kind + "_id" for kind in reports.TARGETS), values, strict=True)))
            with self.subTest(values=values), self.assertRaises(transfer.TransferError):
                reports.report_scope(report)
