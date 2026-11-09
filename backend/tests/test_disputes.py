"""Real-service dispute/review contracts, sealed commands and native MariaDB guards.

DisputeFixture is intentionally not a TestCase and imports no older test class:
admin and notification suites can reuse its actual commerce/fulfilment setup
without rediscovering the older suites. Run only through the owned MariaDB runner.
"""

import io
import uuid
from decimal import Decimal

from django.contrib.auth.models import Group, Permission
from django.core.management import call_command
from django.db import DatabaseError, connection, transaction
from django.http import Http404
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.test import APIClient

from apps.accounts.models import Account, AuditEvent, User
from apps.catalogue.models import Variant
from apps.fulfilment import models as delivery, queries as delivery_queries
from apps.inventory.models import Bucket, Movement, StockTransition
from apps.marketplace.queries import PublicGate
from apps.orders import access, aftercare, aftercare_commands, disputes, reviews
from apps.orders import services as orders
from apps.orders.models import (
    AftercareCommand, AftercareEvent, DisputeDecision, DisputeRequest,
    DisputeResponse, Invoice, OrderLine, Review, ReviewDecision,
)
from apps.organizations.access import Conflict
from apps.organizations.models import Membership
from apps.payments import media as payment_media, queries as payment_queries, refunds, services as payment_services
from apps.payments.access import account_for
from apps.payments.models import Evidence, EvidenceBinding, Receipt, RefundDecision, RefundDue, RefundSeal
from tests.test_aftercare import AftercareFixture
from tests.test_catalogue import image_file
from tests.test_identity import signin
from tests.test_messaging import request_actor
from tests.test_staff_admin import admin_signin


class DisputeFixture(AftercareFixture):
    """Exported packet helpers; completion always uses actual COD delivery/receipt."""

    def delivered_order(self):
        order = self.accept("cod")
        self.prepare(order)
        self.send(order)
        self.command(order, "deliver", self.buyer, occurred_at=timezone.now(), reason="Actual synthetic delivery")
        self.assertTrue(delivery.Delivery.objects.filter(shipment__order=order).exists())
        self.assertFalse(delivery.Completion.objects.filter(order=order).exists())
        return order

    def company_order(self, *, complete=False):
        self.profile = self.company("dispute-company")
        self.variant = Variant.objects.get(product=self.product)
        orders.set_terms(self.seller, self.profile.pk, {
            "version": 0, "enabled": True,
            "destinations": [{"country": "AF", "all_cities": True, "cities": []}],
            "methods": ["advance", "cod"], "reason": "Synthetic company checkout terms",
        })
        self.seed_stock(self.variant)
        return self.completed() if complete else self.delivered_order()

    def dispute_group(self, role="dispute_deciders"):
        call_command("setup_dispute_groups", stdout=io.StringIO())
        return Group.objects.get(name=role)

    def dispute_reviewer(self, name="dispute-decider", *, role="dispute_deciders"):
        actor, client = self.connected("staff", name, group=self.dispute_group(role))
        if role == "dispute_deciders":
            call_command("setup_fulfilment_groups", stdout=io.StringIO())
            actor.user.groups.add(
                Group.objects.get(name="Rezayi: Delivery operational holds"),
                Group.objects.get(name="Rezayi: Delivery assignment"),
            )
        return actor, client

    def seller_member(self, order, name="dispute-seller-member", bundles=None):
        actor, client = self.connected("seller", name)
        member = Membership.objects.create(
            company=order.seller, account=actor.account,
            bundles=bundles if bundles is not None else ["orders_negotiation", "payments_refunds"],
        )
        return actor, client, member

    def other_context(self, user, context):
        """Native fresh grant for one User in another context, not a mocked Actor."""
        if context != "owner":
            Account.objects.get_or_create(user=user, context=context)
        client = APIClient(enforce_csrf_checks=True)
        if context in {"staff", "owner"}:
            admin_signin(client, user)
        else:
            signin(client, context, user.email)
        return request_actor(client, context, user), client

    def dispute_packet(self, order, **extra):
        return {
            "command_id": uuid.uuid4(), "version": self.head(order),
            "reason": "Synthetic post-delivery dispute", **extra,
        }

    def open_dispute(self, order, actor=None, **extra):
        result = disputes.mutate(actor or self.buyer, order.pk, "dispute_open", self.dispute_packet(order, **extra))
        return DisputeRequest.objects.get(pk=result["dispute"])

    def withdraw_dispute(self, row, actor=None, **extra):
        packet = self.dispute_packet(row.order, **{
            "dispute": str(row.pk), "reason": "Synthetic buyer dispute withdrawal", **extra,
        })
        return disputes.mutate(actor or self.buyer, row.order_id, "dispute_withdraw", packet)

    def respond_dispute(self, row, actor=None, **extra):
        packet = {"command_id": uuid.uuid4(), "version": self.head(row.order),
                  "dispute": str(row.pk), "text": "Synthetic retained seller response", **extra}
        return disputes.mutate(actor or self.seller, row.order_id, "dispute_respond", packet)

    def decision_packet(self, row, action, **extra):
        row.refresh_from_db()
        return {"command_id": uuid.uuid4(), "version": self.head(row.order),
                "dispute_version": row.version, "action": action,
                "reason": "Independent synthetic dispute decision", **extra}

    def decide_dispute(self, row, action="dismiss", actor=None, **extra):
        return disputes.decide(actor or self.root, row.pk, self.decision_packet(row, action, **extra))

    def assign_dispute(self, row, actor=None, assigned_to=None, **extra):
        return self.decide_dispute(row, "assign", actor=actor,
                                   assigned_to=assigned_to or (actor or self.root).user.pk, **extra)

    def review_packet(self, order, **extra):
        return {"command_id": uuid.uuid4(), "version": self.head(order), "rating": 4,
                "text": "Synthetic buyer experience", "language": "fa-AF", **extra}

    def submit_review(self, order, actor=None, **extra):
        result = reviews.mutate(actor or self.buyer, order.pk, "review_submit", self.review_packet(order, **extra))
        return Review.objects.get(pk=result["review"])

    def moderation_packet(self, row, action, **extra):
        row.refresh_from_db()
        return {"command_id": uuid.uuid4(), "version": self.head(row.order), "review_version": row.version,
                "action": action, "reason": "Independent synthetic review moderation", **extra}

    def moderate_review(self, row, action="approve", actor=None, **extra):
        return reviews.moderate(actor or self.root, row.pk, self.moderation_packet(row, action, **extra))

    def dispute_state(self):
        result = self.domain_state()
        for model in (DisputeRequest, DisputeResponse, DisputeDecision, Review, ReviewDecision,
                      Evidence, EvidenceBinding, Invoice, OrderLine, Receipt, Bucket, Movement, StockTransition):
            result[model._meta.label] = list(model.objects.order_by("pk").values())
        return result

    def assert_refusal(self, code, operation):
        before = self.dispute_state()
        with self.assertRaises(ValidationError) as error:
            operation()
        self.assertIn(code, str(error.exception.detail))
        self.assertEqual(self.dispute_state(), before)

    def guard_rejects(self, sql, parameters):
        self.assertEqual(connection.vendor, "mysql", "These are native MariaDB acceptance tests.")
        # Catch outside the savepoint: a rejected SQL statement must never poison
        # the outer TestCase transaction or hide subsequent guard assertions.
        with self.assertRaises(DatabaseError) as error, transaction.atomic(), connection.cursor() as cursor:
            cursor.execute(sql, parameters)
        self.assertEqual(error.exception.args[0], 1644, "Require native SIGNAL, not syntax/FK/unknown-column failure.")


@override_settings(OWNER_MFA_REQUIRED=False)
class DisputeLifecycleTests(DisputeFixture, TestCase):
    def test_acceptance_preparation_and_dispatch_are_not_delivery_eligibility(self):
        order = self.accept("cod")
        for prepare in (False, True):
            if prepare:
                self.prepare(order)
                self.send(order)
            with self.subTest(dispatched=prepare):
                self.assert_refusal("dispute_not_delivered", lambda: self.open_dispute(order))

    def test_actual_delivery_before_completion_is_sufficient(self):
        order = self.delivered_order()
        row = self.open_dispute(order)
        self.assertEqual((row.state, row.requester_account_id, row.version), ("pending", order.buyer_id, 1))
        self.assertFalse(delivery.Completion.objects.filter(order=order).exists())
        self.assertTrue(aftercare.pending_dispute(order))

    def test_open_seals_aftercare_event_command_and_one_linked_hold(self):
        order = self.completed()
        key = uuid.uuid4()
        row = self.open_dispute(order, command_id=key)
        event = AftercareEvent.objects.get(pk=row.event_id)
        self.assertEqual((event.action, event.context, event.account_id), ("dispute_opened", "buyer", order.buyer_id))
        command = AftercareCommand.objects.get(pk=key)
        self.assertEqual((command.action, command.event_id, command.order_id), ("dispute_open", event.pk, order.pk))
        self.assertEqual(delivery.Blocker.objects.filter(order=order, kind="dispute").count(), 1)
        self.assertEqual(row.blocker.kind, "dispute")
        self.assertEqual(delivery.ReviewCase.objects.get(blocker=row.blocker).state, "open")
        self.assertTrue(AuditEvent.objects.filter(resource_id=row.pk, action="dispute_opened").exists())

    def test_exact_order_buyer_only_seller_cannot_open(self):
        order = self.delivered_order()
        before = self.dispute_state()
        with self.assertRaises(Http404):
            self.open_dispute(order, actor=self.other_buyer)
        with self.assertRaises(PermissionDenied):
            self.open_dispute(order, actor=self.seller)
        self.assertEqual(self.dispute_state(), before)

    def test_one_pending_dispute_per_order(self):
        order = self.delivered_order()
        self.open_dispute(order)
        self.assert_refusal("dispute_request_pending", lambda: self.open_dispute(order))
        self.assertEqual(DisputeRequest.objects.filter(order=order).count(), 1)

    def test_distinct_orders_have_independent_pending_cases_and_heads(self):
        first, second = self.completed(), self.completed()
        one, two = self.open_dispute(first), self.open_dispute(second)
        self.assertNotEqual(one.blocker_id, two.blocker_id)
        self.assertEqual((self.head(first), self.head(second)), (1, 1))
        self.assertEqual(DisputeRequest.objects.filter(state="pending").count(), 2)

    def test_open_replay_is_identical_even_after_case_closure(self):
        order = self.completed()
        packet = self.dispute_packet(order)
        result = disputes.mutate(self.buyer, order.pk, "dispute_open", packet)
        row = DisputeRequest.objects.get(pk=result["dispute"])
        self.assign_dispute(row)
        self.decide_dispute(row)
        before = self.dispute_state()
        self.assertEqual(disputes.mutate(self.buyer, order.pk, "dispute_open", packet), result)
        self.assertEqual(self.dispute_state(), before)

    def test_command_identity_rejects_changed_reason_action_and_actor(self):
        order = self.completed()
        packet = self.dispute_packet(order)
        result = disputes.mutate(self.buyer, order.pk, "dispute_open", packet)
        before = self.dispute_state()
        for actor, action, changes in (
            (self.buyer, "dispute_open", {"reason": "Changed private dispute reason"}),
            (self.buyer, "dispute_withdraw", {"dispute": result["dispute"]}),
            (self.seller, "dispute_open", {}),
        ):
            with self.subTest(action=action, actor=actor.context), self.assertRaises(Conflict):
                disputes.mutate(actor, order.pk, action, {**packet, **changes})
        self.assertEqual(self.dispute_state(), before)

    def test_open_requires_integer_current_head_and_bounded_reason(self):
        order = self.delivered_order()
        for value in (1, "0", True, None):
            with self.subTest(version=value):
                self.assert_refusal("dispute_stale_version", lambda: self.open_dispute(order, version=value))
        for reason in ("ab", " " * 3, "x" * 1001, 7, None):
            with self.subTest(reason_type=type(reason).__name__), self.assertRaises(ValidationError):
                self.open_dispute(order, reason=reason)
        self.assertFalse(DisputeRequest.objects.exists())

    def test_pending_dispute_blocks_new_completion_until_decided(self):
        order = self.delivered_order()
        row = self.open_dispute(order)
        self.receipt(order, "12.50")
        self.assertFalse(delivery.Completion.objects.filter(order=order).exists())
        self.assign_dispute(row)
        self.decide_dispute(row, "resolve")
        self.assertTrue(delivery.Completion.objects.filter(order=order).exists())
        self.assertFalse(delivery_queries.active_blockers(order).filter(pk=row.blocker_id).exists())

    def test_post_completion_open_and_resolution_preserve_original_facts(self):
        order = self.completed()
        models = (delivery.Completion, delivery.Delivery, delivery.Shipment, Invoice, OrderLine,
                  Receipt, Bucket, Movement, StockTransition)
        original = {m._meta.label: list(m.objects.order_by("pk").values()) for m in models}
        row = self.open_dispute(order)
        self.assertEqual(delivery_queries.detail(self.buyer, order.pk)["completion"], "completed_with_exception")
        self.assign_dispute(row)
        self.decide_dispute(row, "resolve")
        self.assertEqual({m._meta.label: list(m.objects.order_by("pk").values()) for m in models}, original)
        self.assertEqual(delivery_queries.detail(self.buyer, order.pk)["completion"], "completed")

    def test_current_seller_response_is_retained_once_and_replays(self):
        order = self.delivered_order()
        row = self.open_dispute(order)
        key = uuid.uuid4()
        result = self.respond_dispute(row, command_id=key)
        before = self.dispute_state()
        self.assertEqual(disputes.mutate(self.seller, order.pk, "dispute_respond", {
            "command_id": key, "version": result["version"] - 1, "dispute": str(row.pk),
            "text": "Synthetic retained seller response",
        }), result)
        self.assertEqual(self.dispute_state(), before)
        with self.assertRaises(Conflict):
            self.respond_dispute(row)
        response = DisputeResponse.objects.get(dispute=row)
        self.assertEqual(response.actor_id, self.seller.account.pk)
        row.refresh_from_db()
        self.assertEqual(row.version, 2)

    def test_buyer_cannot_respond_and_response_text_is_bounded(self):
        row = self.open_dispute(self.delivered_order())
        self.assert_refusal("dispute_not_responder", lambda: self.respond_dispute(row, actor=self.buyer))
        for value in ("ab", "x" * 2001, None):
            with self.subTest(text=value), self.assertRaises(ValidationError):
                self.respond_dispute(row, text=value)
        self.respond_dispute(row, text="x" * 2000)
        self.assertEqual(len(DisputeResponse.objects.get(dispute=row).text), 2000)

    def test_authorized_company_negotiator_can_respond_but_revoked_member_cannot(self):
        order = self.company_order()
        actor, _, member = self.seller_member(order)
        row = self.open_dispute(order)
        Membership.objects.filter(pk=member.pk).update(active=False)
        before = self.dispute_state()
        with self.assertRaises(Http404):
            self.respond_dispute(row, actor=actor)
        self.assertEqual(self.dispute_state(), before)
        Membership.objects.filter(pk=member.pk).update(active=True)
        self.respond_dispute(row, actor=actor)
        self.assertEqual(DisputeResponse.objects.get(dispute=row).actor_id, actor.account.pk)

    def test_company_messaging_bundle_is_not_dispute_response_authority(self):
        order = self.company_order()
        actor, _, _ = self.seller_member(order, bundles=["messaging"])
        row = self.open_dispute(order)
        with self.assertRaises(Http404):
            self.respond_dispute(row, actor=actor)
        self.assertFalse(DisputeResponse.objects.exists())

    def test_withdrawal_closes_hold_once_without_a_staff_decision(self):
        order = self.completed()
        row = self.open_dispute(order)
        key = uuid.uuid4()
        version = self.head(order)
        result = self.withdraw_dispute(row, command_id=key)
        self.assertEqual(result["state"], "withdrawn")
        self.assertFalse(DisputeDecision.objects.filter(dispute=row).exists())
        self.assertEqual(delivery.BlockerClosure.objects.filter(blocker=row.blocker).count(), 1)
        self.assertFalse(delivery_queries.active_blockers(order).filter(pk=row.blocker_id).exists())
        before = self.dispute_state()
        self.assertEqual(disputes.mutate(self.buyer, order.pk, "dispute_withdraw", {
            "command_id": key, "version": version, "dispute": str(row.pk),
            "reason": "Synthetic buyer dispute withdrawal",
        }), result)
        self.assertEqual(self.dispute_state(), before)
        self.assertEqual(delivery.Completion.objects.filter(order=order).count(), 1)

    def test_buyer_withdrawal_reenables_initial_completion_with_honest_once_only_case_history(self):
        order = self.delivered_order()
        row = self.open_dispute(order)
        self.assign_dispute(row)
        case = delivery.ReviewCase.objects.get(blocker=row.blocker)
        prior_version, assignee = case.version, case.assigned_to_id
        self.receipt(order, "12.50")
        self.assertFalse(delivery.Completion.objects.filter(order=order).exists())
        self.assertEqual(access.aftercare_rights(self.buyer), set())
        self.withdraw_dispute(row)
        case.refresh_from_db()
        closure = delivery.BlockerClosure.objects.get(blocker=row.blocker)
        case_event = delivery.CaseEvent.objects.get(event_id=closure.event_id)
        self.assertEqual((case.state, case.version, case.assigned_to_id), ("resolved", prior_version + 1, assignee))
        self.assertEqual((case_event.action, case_event.case_version, case_event.assigned_to_id),
                         ("withdraw", case.version, assignee))
        self.assertEqual((closure.event.action, closure.event.context, closure.event.actor_id, closure.event.account_id),
                         ("dispute_withdrawn", "buyer", self.buyer.user.pk, order.buyer_id))
        self.assertEqual(closure.disposition, "withdrawn")
        self.assertTrue(delivery.Publication.objects.filter(event_id=closure.event_id).exists())
        self.assertEqual(delivery.Completion.objects.filter(order=order).count(), 1)
        self.assertFalse(DisputeDecision.objects.filter(dispute=row).exists())
        self.assertFalse(delivery_queries.active_blockers(order).exists())

    def test_sequential_withdrawn_and_decided_cases_retain_distinct_hold_history(self):
        order = self.completed()
        first = self.open_dispute(order)
        self.withdraw_dispute(first)
        second = self.open_dispute(order)
        self.assign_dispute(second)
        self.decide_dispute(second)
        third = self.open_dispute(order)
        self.assertEqual(DisputeRequest.objects.filter(order=order).count(), 3)
        self.assertEqual(DisputeRequest.objects.filter(order=order, state="pending").count(), 1)
        self.assertEqual(delivery.BlockerClosure.objects.filter(blocker__order=order, blocker__kind="dispute").count(), 2)
        self.assertEqual(list(delivery_queries.active_blockers(order).filter(kind="dispute").values_list("pk", flat=True)),
                         [third.blocker_id])

    def test_closed_case_rejects_new_response_withdrawal_and_decision(self):
        row = self.open_dispute(self.completed())
        self.assign_dispute(row)
        self.decide_dispute(row)
        before = self.dispute_state()
        for operation in (lambda: self.respond_dispute(row), lambda: self.withdraw_dispute(row)):
            with self.assertRaises(Http404):
                operation()
        with self.assertRaises(Conflict):
            self.decide_dispute(row)
        self.assertEqual(self.dispute_state(), before)

    def test_dispute_transaction_rollback_leaves_no_case_hold_command_or_notice(self):
        order = self.completed()
        before = self.dispute_state()
        with self.assertRaises(RuntimeError), transaction.atomic():
            self.open_dispute(order)
            raise RuntimeError("Synthetic outer transaction rollback")
        self.assertEqual(self.dispute_state(), before)


@override_settings(OWNER_MFA_REQUIRED=False)
class DisputeAuthorityTests(DisputeFixture, TestCase):
    def test_native_group_setup_is_idempotent_defines_roles_without_assigning_users(self):
        before = list(User.objects.order_by("pk").values())
        memberships = list(User.groups.through.objects.order_by("pk").values())
        call_command("setup_dispute_groups", stdout=io.StringIO())
        call_command("setup_dispute_groups", stdout=io.StringIO())
        for name, codes in {
            "dispute_reviewers": {"read_dispute", "read_dispute_evidence"},
            "dispute_deciders": {"read_dispute", "assign_dispute", "decide_dispute", "read_dispute_evidence"},
            "review_moderators": {"read_review", "moderate_review"},
        }.items():
            with self.subTest(role=name):
                self.assertEqual(set(Group.objects.get(name=name).permissions.filter(
                    content_type__app_label="orders").values_list("codename", flat=True)), codes)
        self.assertEqual(list(User.objects.order_by("pk").values()), before)
        self.assertEqual(list(User.groups.through.objects.order_by("pk").values()), memberships)

    def test_decision_requires_assignment_even_for_independent_root(self):
        row = self.open_dispute(self.completed())
        before = self.dispute_state()
        with self.assertRaises(PermissionDenied):
            self.decide_dispute(row)
        self.assertEqual(self.dispute_state(), before)

    def test_staff_assignment_synchronizes_linked_hold_and_decides_once(self):
        actor, _ = self.dispute_reviewer()
        row = self.open_dispute(self.completed())
        self.assign_dispute(row, assigned_to=actor.user.pk)
        row.refresh_from_db()
        case = delivery.ReviewCase.objects.get(blocker=row.blocker)
        self.assertEqual((row.assigned_to_id, case.assigned_to_id), (actor.user.pk, actor.user.pk))
        packet = self.decision_packet(row, "dismiss")
        result = disputes.decide(actor, row.pk, packet)
        before = self.dispute_state()
        self.assertEqual(disputes.decide(actor, row.pk, packet), result)
        self.assertEqual(self.dispute_state(), before)
        self.assertEqual(DisputeDecision.objects.filter(dispute=row).count(), 1)
        self.assertEqual(delivery.BlockerClosure.objects.filter(blocker=row.blocker).count(), 1)
        self.assertEqual(delivery.BlockerClosure.objects.get(blocker=row.blocker).disposition, "decided")

    def test_read_only_reviewer_cannot_assign_or_decide(self):
        actor, _ = self.dispute_reviewer(role="dispute_reviewers")
        row = self.open_dispute(self.completed())
        self.assertNotIn(actor.user.pk, [u.pk for u in disputes.reviewers(row)])
        before = self.dispute_state()
        with self.assertRaises(PermissionDenied):
            self.assign_dispute(row, assigned_to=actor.user.pk)
        with self.assertRaises(Http404):
            self.decide_dispute(row, actor=actor)
        self.assertEqual(self.dispute_state(), before)

    def test_decide_permission_without_exact_dispute_read_cannot_be_assigned(self):
        actor, _ = self.dispute_reviewer("decide-without-dispute-read")
        row = self.open_dispute(self.completed())
        decide_only = Group.objects.create(name="Synthetic decide dispute without read")
        decide_only.permissions.set(Permission.objects.filter(content_type__app_label="orders", codename="decide_dispute"))
        actor.user.groups.remove(self.dispute_group())
        actor.user.groups.add(decide_only)
        before = self.dispute_state()
        self.assertNotIn(actor.user.pk, [user.pk for user in disputes.reviewers(row)])
        with self.assertRaises(PermissionDenied):
            self.assign_dispute(row, assigned_to=actor.user.pk)
        self.assertEqual(self.dispute_state(), before)

    def test_read_only_assigned_staff_can_read_but_not_decide(self):
        actor, _ = self.dispute_reviewer()
        row = self.open_dispute(self.completed())
        self.assign_dispute(row, assigned_to=actor.user.pk)
        actor.user.groups.remove(self.dispute_group())
        actor.user.groups.add(self.dispute_group("dispute_reviewers"))
        self.assertTrue(access.dispute_scope(actor).filter(pk=row.pk).exists())
        before = self.dispute_state()
        with self.assertRaises(PermissionDenied):
            self.decide_dispute(row, actor=actor)
        self.assertEqual(self.dispute_state(), before)

    def test_revoked_native_group_removes_read_decide_and_replay_authority_immediately(self):
        actor, _ = self.dispute_reviewer()
        row = self.open_dispute(self.completed())
        self.assign_dispute(row, assigned_to=actor.user.pk)
        packet = self.decision_packet(row, "resolve")
        actor.user.groups.clear()
        self.assertFalse(access.dispute_scope(actor).filter(pk=row.pk).exists())
        before = self.dispute_state()
        with self.assertRaises(Http404):
            disputes.decide(actor, row.pk, packet)
        self.assertEqual(self.dispute_state(), before)
        self.assertNotIn(actor.user.pk, [u.pk for u in disputes.reviewers(row)])

    def test_other_assignee_and_stale_case_or_head_cannot_decide(self):
        actor, _ = self.dispute_reviewer()
        row = self.open_dispute(self.completed())
        self.assign_dispute(row, assigned_to=actor.user.pk)
        before = self.dispute_state()
        with self.assertRaises(PermissionDenied):
            self.decide_dispute(row, actor=self.root)
        for changes in ({"version": 0}, {"dispute_version": 1}, {"dispute_version": True}):
            with self.subTest(changes=changes):
                self.assert_refusal("dispute_stale_version", lambda: self.decide_dispute(row, actor=actor, **changes))
        self.assertEqual(self.dispute_state(), before)

    def test_same_user_seller_and_historical_member_excluded_even_when_staff_or_root(self):
        order = self.company_order(complete=True)
        member_actor, _, member = self.seller_member(order)
        User.objects.filter(pk=member_actor.user.pk).update(is_staff=True, is_superuser=True)
        member_actor.user.refresh_from_db()
        conflicted, _ = self.other_context(member_actor.user, "owner")
        Membership.objects.filter(pk=member.pk).update(active=False)
        row = self.open_dispute(order)
        before = self.dispute_state()
        self.assertNotIn(conflicted.user.pk, [u.pk for u in disputes.reviewers(row)])
        with self.assertRaises(PermissionDenied):
            self.assign_dispute(row, assigned_to=conflicted.user.pk)
        with self.assertRaises(PermissionDenied):
            disputes.independent(order, conflicted.user, dispute=row)
        self.assertEqual(self.dispute_state(), before)

    def test_buyer_response_and_evidence_authors_never_become_independent_root(self):
        order = self.completed()
        image = payment_media.upload(self.buyer, order.pk, uuid.uuid4(), image_file())
        row = self.open_dispute(order, evidence=[image["id"]])
        User.objects.filter(pk=self.buyer.user.pk).update(is_staff=True, is_superuser=True)
        self.buyer.user.refresh_from_db()
        conflicted, _ = self.other_context(self.buyer.user, "owner")
        self.assertEqual(row.evidence_bindings.get().evidence.creator.user_id, conflicted.user.pk)
        with self.assertRaises(PermissionDenied):
            disputes.independent(order, conflicted.user, dispute=row)
        with self.assertRaises(PermissionDenied):
            self.assign_dispute(row, assigned_to=conflicted.user.pk)
        self.respond_dispute(row)
        User.objects.filter(pk=self.seller.user.pk).update(is_staff=True, is_superuser=True)
        self.seller.user.refresh_from_db()
        seller_root, _ = self.other_context(self.seller.user, "owner")
        with self.assertRaises(PermissionDenied):
            disputes.independent(order, seller_root.user, dispute=row)

    def test_decision_rechecks_active_exact_buyer(self):
        order = self.completed()
        row = self.open_dispute(order)
        self.assign_dispute(row)
        User.objects.filter(pk=self.buyer.user.pk).update(email_verified=False)
        self.assert_refusal("dispute_not_requester", lambda: self.decide_dispute(row))

    def test_bound_private_evidence_uses_real_pipeline_and_cannot_be_rebound(self):
        order = self.completed()
        upload = payment_media.upload(self.buyer, order.pk, uuid.uuid4(), image_file())
        row = self.open_dispute(order, evidence=[upload["id"]])
        item = Evidence.objects.get(pk=upload["id"])
        self.assertEqual(EvidenceBinding.objects.get(evidence=item).dispute_id, row.pk)
        self.assertEqual(item.order_id, order.pk)
        self.assertEqual(payment_media.permitted(self.seller, item.pk).pk, item.pk)
        with self.assertRaises(Http404):
            payment_media.permitted(self.other_buyer, item.pk)
        self.assign_dispute(row)
        self.decide_dispute(row)
        before = self.dispute_state()
        with self.assertRaises(Http404):
            self.open_dispute(order, evidence=[upload["id"]])
        self.assertEqual(self.dispute_state(), before)

    def test_evidence_limit_and_other_order_or_creator_refuse_atomically(self):
        order = self.completed()
        images = [payment_media.upload(self.buyer, order.pk, uuid.uuid4(), image_file())["id"] for _ in range(4)]
        before = self.dispute_state()
        with self.assertRaises(ValidationError):
            self.open_dispute(order, evidence=images)
        self.assertEqual(self.dispute_state(), before)
        another = self.completed()
        with self.assertRaises(Http404):
            self.open_dispute(another, evidence=[images[0]])
        seller_image = payment_media.upload(self.seller, order.pk, uuid.uuid4(), image_file())["id"]
        with self.assertRaises(Http404):
            self.open_dispute(order, evidence=[seller_image])
        self.assertFalse(DisputeRequest.objects.exists())


@override_settings(OWNER_MFA_REQUIRED=False)
class DisputeRefundTests(DisputeFixture, TestCase):
    def test_non_monetary_outcomes_close_hold_and_never_create_due(self):
        for action, expected in (("dismiss", "dismissed"), ("resolve", "resolved_non_monetary")):
            with self.subTest(action=action):
                row = self.open_dispute(self.completed())
                self.assign_dispute(row)
                outcome = self.decide_dispute(row, action)
                decision = DisputeDecision.objects.get(dispute=row)
                self.assertEqual((outcome["state"], decision.action), (expected, expected))
                self.assertIsNone(decision.amount)
                self.assertIsNone(decision.refund_due_id)
                self.assertEqual(delivery.BlockerClosure.objects.filter(blocker=row.blocker).count(), 1)
        self.assertFalse(RefundDue.objects.exists())

    def test_refund_due_is_exact_bounded_and_never_actual_refund_execution(self):
        order = self.completed("15.00")
        row = self.open_dispute(order)
        self.assign_dispute(row)
        receipts = list(Receipt.objects.filter(order=order).values())
        result = self.decide_dispute(row, "refund", amount="15.00")
        due = RefundDue.objects.get(pk=result["refund_due"])
        self.assertEqual((due.cause, due.amount, due.currency), ("dispute", Decimal("15.00"), "AFN"))
        self.assertTrue(RefundSeal.objects.filter(due=due).exists())
        self.assertEqual(DisputeDecision.objects.get(dispute=row).refund_due_id, due.pk)
        self.assertEqual(refunds.refunded_total(order), Decimal("0.00"))
        self.assertEqual(payment_queries.confirmed(order), Decimal("15.00"))
        self.assertEqual(list(Receipt.objects.filter(order=order).values()), receipts)
        self.assertFalse(delivery_queries.active_blockers(order).filter(pk=row.blocker_id).exists())
        self.assertEqual(delivery.Completion.objects.filter(order=order).count(), 1)

    def test_assigned_dispute_decider_without_payment_read_can_order_exact_cross_ledger_due(self):
        actor, _ = self.dispute_reviewer("dispute-only-refund-decider")
        order = self.completed()
        row = self.open_dispute(order)
        self.assign_dispute(row, assigned_to=actor.user.pk)
        from apps.payments.access import rights

        self.assertNotIn("read_payments", rights(actor))
        result = self.decide_dispute(row, "refund", actor=actor, amount="5.00")
        due = RefundDue.objects.get(pk=result["refund_due"])
        decision = DisputeDecision.objects.get(dispute=row)
        self.assertNotEqual(due.event_id, decision.event_id)
        self.assertEqual((due.event.actor_id, due.event.account_id, due.event.context),
                         (decision.actor_id, decision.account_id, decision.context))
        self.assertEqual(due.event.action, "refund_due_created")
        self.assertEqual(due.event.version, payment_queries.annotate(type(order).objects.filter(pk=order.pk)).get().payment_version)
        self.assertEqual((due.amount, due.currency, due.order_id), (decision.amount, order.currency, order.pk))
        self.assertTrue(RefundSeal.objects.filter(due=due).exists())
        self.assertFalse(delivery_queries.active_blockers(order).filter(pk=row.blocker_id).exists())

    def test_refund_refuses_zero_unconfirmed_excess_float_and_non_exact_input(self):
        row = self.open_dispute(self.delivered_order())
        self.assign_dispute(row)
        self.assert_refusal("dispute_refund_amount_invalid", lambda: self.decide_dispute(row, "refund", amount="1.00"))
        self.receipt(row.order, "12.50")
        self.assert_refusal("dispute_refund_amount_invalid", lambda: self.decide_dispute(row, "refund", amount="12.51"))
        for value in ("0.00", "-1.00", "1e1", "1.001", 1.25, "NaN", None):
            before = self.dispute_state()
            with self.subTest(amount=value), self.assertRaises(ValidationError):
                self.decide_dispute(row, "refund", amount=value)
            self.assertEqual(self.dispute_state(), before)

    def test_bound_subtracts_confirmed_and_unconfirmed_retained_prior_dues(self):
        order = self.completed("20.00")
        prior = RefundDue.objects.get(pk=self.due(order, "5.00")["refund_due"])
        self.report(order, prior)
        self.confirm_refund(prior)
        self.due(order, "2.50")
        self.assertEqual(disputes.refund_bound(order), Decimal("12.50"))
        row = self.open_dispute(order)
        self.assign_dispute(row)
        self.assert_refusal("dispute_refund_amount_invalid", lambda: self.decide_dispute(row, "refund", amount="12.51"))
        self.decide_dispute(row, "refund", amount="12.50")
        self.assertEqual(refunds.due_total(order), Decimal("20.00"))
        next_row = self.open_dispute(order)
        self.assign_dispute(next_row)
        self.assert_refusal("dispute_refund_amount_invalid", lambda: self.decide_dispute(next_row, "refund", amount="0.01"))

    def test_dispute_decider_root_cannot_confirm_due_different_independent_staff_can(self):
        order = self.completed()
        row = self.open_dispute(order)
        self.assign_dispute(row)
        due = RefundDue.objects.get(pk=self.decide_dispute(row, "refund", amount="5.00")["refund_due"])
        self.report(order, due)
        before = self.dispute_state()
        with self.assertRaises(PermissionDenied):
            self.refund(due, "assign", assigned_to=self.root.user.pk)
        self.assertEqual(self.dispute_state(), before)
        actor, _ = self.connected("staff", "different-refund-confirmer", group=self.native_group("Goods refund review"))
        self.refund(due, "assign", assigned_to=actor.user.pk)
        self.refund(due, "confirm", actor=actor)
        self.assertEqual(refunds.refunded_total(order), Decimal("5.00"))
        self.assertEqual(payment_queries.confirmed(order), Decimal("15.00"))
        self.assertEqual(RefundDecision.objects.get(report__due=due).actor_id, actor.user.pk)
        self.assertEqual(delivery.Completion.objects.filter(order=order).count(), 1)

    def test_dispute_refund_decision_replay_never_multiplies_due_seal_or_hold_closure(self):
        row = self.open_dispute(self.completed())
        self.assign_dispute(row)
        packet = self.decision_packet(row, "refund", amount="5.00")
        result = disputes.decide(self.root, row.pk, packet)
        before = self.dispute_state()
        self.assertEqual(disputes.decide(self.root, row.pk, packet), result)
        with self.assertRaises(Conflict):
            disputes.decide(self.root, row.pk, {**packet, "amount": "4.00"})
        self.assertEqual(self.dispute_state(), before)
        self.assertEqual((RefundDue.objects.count(), RefundSeal.objects.count()), (1, 1))
        self.assertEqual(delivery.BlockerClosure.objects.filter(blocker=row.blocker).count(), 1)


@override_settings(OWNER_MFA_REQUIRED=False)
class BuyerReviewTests(DisputeFixture, TestCase):
    def test_review_requires_completed_not_just_delivered_order(self):
        order = self.delivered_order()
        self.assert_refusal("review_not_completed", lambda: self.submit_review(order))
        self.receipt(order, "12.50")
        self.assertEqual(self.submit_review(order).buyer_id, order.buyer_id)

    def test_exact_buyer_only_other_buyer_and_seller_denied(self):
        order = self.completed()
        before = self.dispute_state()
        with self.assertRaises(Http404):
            self.submit_review(order, actor=self.other_buyer)
        with self.assertRaises(PermissionDenied):
            self.submit_review(order, actor=self.seller)
        self.assertEqual(self.dispute_state(), before)

    def test_all_integer_ratings_and_four_languages_preserved_verbatim(self):
        for rating, language in ((1, "en"), (2, "fa-AF"), (3, "ps"), (4, "ar"), (5, "fa-AF")):
            with self.subTest(rating=rating, language=language):
                row = self.submit_review(self.completed(), rating=rating, language=language,
                                         text="تجربه خریدار — buyer experience")
                self.assertEqual((row.rating, row.language, row.text),
                                 (rating, language, "تجربه خریدار — buyer experience"))
                self.assertEqual(row.state, "pending")

    def test_rating_refusals_do_not_coerce_bool_float_or_string(self):
        order = self.completed()
        for value in (0, 6, -1, True, False, 4.0, "4", None):
            with self.subTest(rating=value):
                self.assert_refusal("review_rating_invalid", lambda: self.submit_review(order, rating=value))

    def test_text_bounds_and_unknown_language_refuse_without_command(self):
        order = self.completed()
        for text in ("ab", " " * 3, "x" * 2001, None):
            before = self.dispute_state()
            with self.subTest(text_type=type(text).__name__), self.assertRaises(ValidationError):
                self.submit_review(order, text=text)
            self.assertEqual(self.dispute_state(), before)
        for language in ("fa", "de", "", None):
            with self.subTest(language=language), self.assertRaises(ValidationError):
                self.submit_review(order, language=language)
        row = self.submit_review(order, text="x" * 2000)
        self.assertEqual(len(row.text), 2000)

    def test_one_review_per_order_even_after_buyer_withdrawal(self):
        order = self.completed()
        row = self.submit_review(order)
        reviews.mutate(self.buyer, order.pk, "review_withdraw", self.dispute_packet(order))
        row.refresh_from_db()
        self.assertEqual(row.state, "withdrawn")
        self.assert_refusal("review_already_submitted", lambda: self.submit_review(order))
        self.assertEqual(Review.objects.filter(order=order).count(), 1)
        self.assertEqual(ReviewDecision.objects.get(review=row).context, "buyer")

    def test_submission_and_withdrawal_replay_return_original_packets(self):
        order = self.completed()
        packet = self.review_packet(order)
        submitted = reviews.mutate(self.buyer, order.pk, "review_submit", packet)
        withdrawal = self.dispute_packet(order)
        withdrawn = reviews.mutate(self.buyer, order.pk, "review_withdraw", withdrawal)
        before = self.dispute_state()
        self.assertEqual(reviews.mutate(self.buyer, order.pk, "review_submit", packet), submitted)
        self.assertEqual(reviews.mutate(self.buyer, order.pk, "review_withdraw", withdrawal), withdrawn)
        self.assertEqual(self.dispute_state(), before)
        self.assertEqual(ReviewDecision.objects.count(), 1)

    def test_pending_review_has_no_public_rating_and_empty_average_is_null(self):
        self.submit_review(self.completed(), rating=5)
        self.assertEqual(reviews.aggregate(self.profile), {"count": 0, "average": None})
        self.assertFalse(reviews.eligible_reviews(self.profile).exists())
        self.assertEqual(PublicGate("en").store_reviews(self.profile.pk, 1)["results"], [])

    def test_approve_average_and_count_use_same_eligible_set_rejection_excluded(self):
        first = self.submit_review(self.completed(), rating=1)
        second = self.submit_review(self.completed(), rating=4)
        rejected = self.submit_review(self.completed(), rating=5)
        self.moderate_review(first)
        self.moderate_review(second)
        self.moderate_review(rejected, "reject")
        summary = reviews.aggregate(self.profile)
        public = PublicGate("ar").store_reviews(self.profile.pk, 1)
        self.assertEqual(summary, {"count": 2, "average": "2.5"})
        self.assertEqual(public["count"], summary["count"])
        self.assertEqual(sorted(row["rating"] for row in public["results"]), [1, 4])
        self.assertEqual(set(reviews.eligible_reviews(self.profile).values_list("pk", flat=True)), {first.pk, second.pk})

    def test_staff_withdrawal_removes_public_review_retains_content_and_both_decisions(self):
        row = self.submit_review(self.completed(), rating=5)
        original = (row.rating, row.text, row.language, row.created_at, row.event_id)
        self.moderate_review(row)
        self.moderate_review(row, "withdraw")
        row.refresh_from_db()
        self.assertEqual((row.rating, row.text, row.language, row.created_at, row.event_id), original)
        self.assertEqual(row.state, "withdrawn")
        self.assertEqual(set(row.decisions.values_list("action", flat=True)), {"approved", "withdrawn"})
        self.assertEqual(reviews.aggregate(self.profile), {"count": 0, "average": None})
        self.assertEqual(PublicGate("en").store_reviews(self.profile.pk, 1)["count"], 0)
        self.assert_refusal("review_already_submitted", lambda: self.submit_review(row.order))

    def test_buyer_cannot_withdraw_approved_review(self):
        row = self.submit_review(self.completed())
        self.moderate_review(row)
        before = self.dispute_state()
        with self.assertRaises(Http404):
            reviews.mutate(self.buyer, row.order_id, "review_withdraw", self.dispute_packet(row.order))
        self.assertEqual(self.dispute_state(), before)

    def test_moderation_replay_and_changed_reason_do_not_rewrite_history(self):
        row = self.submit_review(self.completed())
        packet = self.moderation_packet(row, "approve")
        result = reviews.moderate(self.root, row.pk, packet)
        before = self.dispute_state()
        self.assertEqual(reviews.moderate(self.root, row.pk, packet), result)
        with self.assertRaises(Conflict):
            reviews.moderate(self.root, row.pk, {**packet, "reason": "Changed moderation reason"})
        with self.assertRaises(Conflict):
            self.moderate_review(row, "reject")
        self.assertEqual(self.dispute_state(), before)
        self.assertEqual(row.decisions.count(), 1)

    def test_native_moderation_group_freshness_and_read_without_decide(self):
        actor, _ = self.dispute_reviewer(role="review_moderators")
        row = self.submit_review(self.completed())
        read_only = Group.objects.create(name="Synthetic review read only")
        read_only.permissions.set(Permission.objects.filter(content_type__app_label="orders", codename="read_review"))
        actor.user.groups.set([read_only])
        self.assertTrue(access.review_scope(actor).filter(pk=row.pk).exists())
        before = self.dispute_state()
        with self.assertRaises(PermissionDenied):
            self.moderate_review(row, actor=actor)
        actor.user.groups.clear()
        with self.assertRaises(Http404):
            self.moderate_review(row, actor=actor)
        self.assertEqual(self.dispute_state(), before)

    def test_same_user_seller_root_cannot_moderate_own_business_review(self):
        order = self.completed()
        row = self.submit_review(order)
        User.objects.filter(pk=self.seller.user.pk).update(is_staff=True, is_superuser=True)
        self.seller.user.refresh_from_db()
        actor, _ = self.other_context(self.seller.user, "owner")
        before = self.dispute_state()
        with self.assertRaises(PermissionDenied):
            self.moderate_review(row, actor=actor)
        self.assertEqual(self.dispute_state(), before)

    def test_historical_seller_member_is_excluded_from_moderation_queue(self):
        order = self.company_order(complete=True)
        actor, _, member = self.seller_member(order)
        User.objects.filter(pk=actor.user.pk).update(is_staff=True)
        actor.user.refresh_from_db()
        staff, _ = self.other_context(actor.user, "staff")
        staff.user.groups.add(self.dispute_group("review_moderators"))
        Membership.objects.filter(pk=member.pk).update(active=False)
        row = self.submit_review(order)
        self.assertFalse(access.review_scope(staff).filter(pk=row.pk).exists())
        with self.assertRaises(Http404):
            self.moderate_review(row, actor=staff)

    def test_moderation_requires_current_head_review_version_and_reason(self):
        row = self.submit_review(self.completed())
        for extra in ({"version": 0}, {"review_version": 0}, {"review_version": "1"}):
            with self.subTest(extra=extra):
                self.assert_refusal("review_stale_version", lambda: self.moderate_review(row, **extra))
        for reason in ("ab", "x" * 1001, None):
            with self.subTest(reason_type=type(reason).__name__), self.assertRaises(ValidationError):
                self.moderate_review(row, reason=reason)
        self.assertFalse(ReviewDecision.objects.exists())

    def test_public_projection_has_only_role_rating_text_language_and_date(self):
        row = self.submit_review(self.completed(), language="ps")
        self.moderate_review(row)
        result = PublicGate("en").store_reviews(self.profile.pk, 1)["results"][0]
        self.assertEqual(set(result), {"reviewer", "rating", "text", "language", "created_at"})
        self.assertEqual((result["reviewer"], result["language"]), ("buyer", "ps"))
        for value in (self.buyer.user.email, self.seller.user.email, str(row.order_id), str(row.buyer_id),
                      "NEVER-PUBLIC-CONTACT"):
            self.assertNotIn(value, str(result))


@override_settings(OWNER_MFA_REQUIRED=False)
class DisputeApiTests(DisputeFixture, TestCase):
    def test_buyer_open_seller_response_and_buyer_status_positive_api(self):
        order = self.completed()
        result = self.post(self.buyer_client, f"orders/buyer/orders/{order.pk}/disputes/", self.dispute_packet(order))
        self.assertEqual(result.status_code, 201, result.content)
        row = DisputeRequest.objects.get(pk=result.json()["outcome"]["dispute"])
        detail = self.buyer_client.get(f"/api/v1/orders/buyer/disputes/{row.pk}/")
        self.assertEqual(detail.status_code, 200, detail.content)
        self.assertTrue(detail.json()["can_withdraw"])
        response = self.post(self.seller_client, f"orders/seller/disputes/{row.pk}/respond/", {
            "command_id": uuid.uuid4(), "version": self.head(order), "dispute": str(row.pk),
            "text": "Actual synthetic seller response",
        })
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(DisputeResponse.objects.get(dispute=row).text, "Actual synthetic seller response")

    def test_scoped_unknown_and_cross_buyer_dispute_reads_and_writes_are_404(self):
        row = self.open_dispute(self.completed())
        before = self.dispute_state()
        for pk in (row.pk, uuid.uuid4()):
            with self.subTest(pk=pk):
                self.assertEqual(self.other_client.get(f"/api/v1/orders/buyer/disputes/{pk}/").status_code, 404)
                self.assertEqual(self.post(self.other_client, f"orders/buyer/disputes/{pk}/withdraw/", {
                    **self.dispute_packet(row.order), "dispute": str(pk),
                }).status_code, 404)
        self.assertEqual(self.dispute_state(), before)

    def test_get_head_lists_detail_status_and_lookup_never_write_business_rows(self):
        order = self.completed()
        row = self.open_dispute(order)
        before = self.dispute_state()
        for client, paths in (
            (self.buyer_client, ["orders/buyer/disputes/", f"orders/buyer/disputes/{row.pk}/",
                                f"orders/buyer/orders/{order.pk}/review/",
                                f"orders/buyer/orders/{order.pk}/aftercare-commands/{uuid.uuid4()}/"]),
            (self.seller_client, ["orders/seller/disputes/", f"orders/seller/disputes/{row.pk}/"]),
        ):
            for path in paths:
                for method in ("get", "head"):
                    with self.subTest(path=path, method=method):
                        response = getattr(client, method)("/api/v1/" + path)
                        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self.dispute_state(), before)

    def test_staff_decide_and_moderate_rest_routes_are_retired_even_for_root(self):
        order = self.completed()
        dispute = self.open_dispute(order)
        review = self.submit_review(order)
        before = self.dispute_state()
        for client in (self.staff_client, self.root_client):
            for path in (f"orders/staff/disputes/{dispute.pk}/decide/", f"orders/staff/reviews/{review.pk}/moderate/"):
                with self.subTest(path=path):
                    self.assertEqual(client.get("/api/v1/" + path).status_code, 404)
                    self.assertEqual(self.post(client, path, {}).status_code, 404)
        self.assertEqual(self.dispute_state(), before)

    def test_review_submit_status_withdraw_api_and_cross_buyer_404(self):
        order = self.completed()
        path = f"orders/buyer/orders/{order.pk}/reviews/"
        result = self.post(self.buyer_client, path, self.review_packet(order))
        self.assertEqual(result.status_code, 201, result.content)
        row = Review.objects.get(order=order)
        status = f"/api/v1/orders/buyer/orders/{order.pk}/review/"
        self.assertEqual(self.buyer_client.get(status).json()["state"], "pending")
        self.assertEqual(self.other_client.get(status).status_code, 404)
        withdrawn = self.post(self.buyer_client, f"orders/buyer/reviews/{row.pk}/withdraw/",
                              self.dispute_packet(order))
        self.assertEqual(withdrawn.status_code, 200, withdrawn.content)
        self.assertEqual(self.buyer_client.get(status).json()["state"], "withdrawn")

    def test_csrf_wrong_context_and_unknown_fields_cannot_open_or_review(self):
        order = self.completed()
        before = self.dispute_state()
        for family, packet in (("disputes", self.dispute_packet(order)), ("reviews", self.review_packet(order))):
            path = f"orders/buyer/orders/{order.pk}/{family}/"
            with self.subTest(family=family):
                self.assertEqual(self.buyer_client.post("/api/v1/" + path, packet, format="json").status_code, 403)
                self.assertEqual(self.post(self.seller_client, path, packet).status_code, 403)
                self.assertEqual(self.post(self.buyer_client, path, {**packet, "untrusted_staff_decision": True}).status_code, 400)
        self.assertEqual(self.dispute_state(), before)

    def test_public_reviews_summary_locales_privacy_headers_and_unknown_store_404(self):
        row = self.submit_review(self.completed(), rating=3, language="ar")
        self.moderate_review(row)
        client = APIClient()
        before = self.dispute_state()
        for locale in ("fa-AF", "ps", "ar", "en"):
            base = f"/api/v1/marketplace/public/{locale}/stores/{self.profile.pk}/reviews/"
            with self.subTest(locale=locale):
                response = client.get(base)
                self.assertEqual(response.status_code, 200, response.content)
                self.assertEqual(response.json()["results"][0]["language"], "ar")
                self.assertEqual(client.get(base + "summary/").json(), {"count": 1, "average": "3.0"})
                self.assertIn("no-store", response["Cache-Control"])
                self.assertIn("noindex", response["X-Robots-Tag"])
                self.assertEqual(client.head(base).status_code, 200)
        self.assertEqual(client.get(f"/api/v1/marketplace/public/en/stores/{uuid.uuid4()}/reviews/").status_code, 404)
        self.assertEqual(self.dispute_state(), before)

    def test_replay_lookup_and_absence_fence_share_existing_aftercare_command_family(self):
        order = self.completed()
        for service, action, packet in (
            (disputes, "dispute_open", self.dispute_packet(order)),
            (reviews, "review_submit", self.review_packet(order)),
        ):
            with self.subTest(action=action):
                packet["version"] = self.head(order)
                key = packet["command_id"]
                before = self.dispute_state()
                self.assertEqual(service.reconcile(self.buyer, order.pk, key), {"state": "unknown", "result": None})
                self.assertEqual(self.dispute_state(), before)
                result = service.mutate(self.buyer, order.pk, action, packet)
                path = f"/api/v1/orders/buyer/orders/{order.pk}/aftercare-commands/{key}/"
                self.assertEqual(self.buyer_client.get(path).json(), {"state": "applied", "result": result})
                fenced = uuid.uuid4()
                rejected = service.settle(self.buyer, order.pk, fenced)
                self.assertEqual(rejected, {"state": "rejected", "result": {"settled": True}})
                before = self.dispute_state()
                with self.assertRaises(Conflict):
                    service.mutate(self.buyer, order.pk, action, {**packet, "command_id": fenced, "version": self.head(order)})
                self.assertEqual(service.settle(self.buyer, order.pk, fenced), rejected)
                self.assertEqual(self.dispute_state(), before)


@override_settings(OWNER_MFA_REQUIRED=False)
class DisputeNativeGuardTests(DisputeFixture, TestCase):
    def test_native_request_update_and_delete_refuse_unwitnessed_changes(self):
        row = self.open_dispute(self.completed())
        before = self.dispute_state()
        for sql, parameters in (
            ("UPDATE orders_disputerequest SET reason='Forged reason' WHERE id=%s", [row.pk.hex]),
            ("UPDATE orders_disputerequest SET state='withdrawn',version=version+1 WHERE id=%s", [row.pk.hex]),
            ("UPDATE orders_disputerequest SET assigned_to_id=%s,version=version+1 WHERE id=%s", [self.root.user.pk.hex, row.pk.hex]),
            ("DELETE FROM orders_disputerequest WHERE id=%s", [row.pk.hex]),
        ):
            with self.subTest(sql=sql):
                self.guard_rejects(sql, parameters)
        self.assertEqual(self.dispute_state(), before)

    def test_raw_duplicate_pending_request_is_signal_refused_not_only_service_check(self):
        row = self.open_dispute(self.completed())
        before = self.dispute_state()
        self.guard_rejects(
            "INSERT INTO orders_disputerequest (id,order_id,state,requester_account_id,reason,blocker_id,assigned_to_id,version,event_id,created_at) "
            "VALUES (%s,%s,'pending',%s,'Forged duplicate request',NULL,NULL,1,%s,UTC_TIMESTAMP(6))",
            [uuid.uuid4().hex, row.order_id.hex, row.requester_account_id.hex, row.event_id.hex],
        )
        self.assertEqual(self.dispute_state(), before)

    def test_raw_response_requires_seller_and_current_response_event(self):
        row = self.open_dispute(self.completed())
        before = self.dispute_state()
        self.guard_rejects(
            "INSERT INTO orders_disputeresponse (dispute_id,actor_id,text,event_id,created_at) "
            "VALUES (%s,%s,'Forged buyer response',%s,UTC_TIMESTAMP(6))",
            [row.pk.hex, self.buyer.account.pk.hex, row.event_id.hex],
        )
        self.assertEqual(self.dispute_state(), before)

    def test_raw_decision_requires_decision_event_assignment_and_independence(self):
        row = self.open_dispute(self.completed())
        self.assign_dispute(row)
        before = self.dispute_state()
        self.guard_rejects(
            "INSERT INTO orders_disputedecision (dispute_id,event_id,actor_id,account_id,context,action,amount,refund_due_id,reason,created_at) "
            "VALUES (%s,%s,%s,NULL,'owner','dismissed',NULL,NULL,'Forged decision using opening event',UTC_TIMESTAMP(6))",
            [row.pk.hex, row.event_id.hex, self.root.user.pk.hex],
        )
        self.assertEqual(self.dispute_state(), before)

    def test_orm_response_and_decision_history_is_append_only(self):
        row = self.open_dispute(self.completed())
        self.respond_dispute(row)
        self.assign_dispute(row)
        self.decide_dispute(row)
        before = self.dispute_state()
        for model, changes in ((DisputeResponse, {"text": "Forged retained response"}),
                               (DisputeDecision, {"reason": "Forged retained decision"})):
            with self.subTest(model=model.__name__), self.assertRaises(DatabaseError) as error, transaction.atomic():
                model.objects.filter(pk=row.pk).update(**changes)
            self.assertEqual(error.exception.args[0], 1644)
        for table in ("orders_disputeresponse", "orders_disputedecision"):
            self.guard_rejects(f"DELETE FROM {table} WHERE dispute_id=%s", [row.pk.hex])
        self.assertEqual(self.dispute_state(), before)

    def test_review_content_and_state_cannot_be_rewritten_through_orm_or_sql(self):
        row = self.submit_review(self.completed())
        self.moderate_review(row)
        before = self.dispute_state()
        for changes in ({"rating": 1}, {"text": "Forged text"}, {"language": "en"}, {"buyer_id": self.other_buyer.account.pk}):
            with self.subTest(changes=changes), self.assertRaises(DatabaseError) as error, transaction.atomic():
                Review.objects.filter(pk=row.pk).update(**changes)
            self.assertEqual(error.exception.args[0], 1644)
        self.guard_rejects("UPDATE orders_review SET state='withdrawn',version=version+1 WHERE order_id=%s", [row.pk.hex])
        self.guard_rejects("DELETE FROM orders_review WHERE order_id=%s", [row.pk.hex])
        self.assertEqual(self.dispute_state(), before)

    def test_raw_review_rating_refusals_and_wrong_buyer_need_real_submit_witness(self):
        order = self.completed()
        row = self.open_dispute(order)
        before = self.dispute_state()
        for rating, buyer in ((0, self.buyer.account.pk), (6, self.buyer.account.pk), (4, self.other_buyer.account.pk)):
            with self.subTest(rating=rating, buyer=buyer):
                self.guard_rejects(
                    "INSERT INTO orders_review (order_id,buyer_id,rating,text,language,state,version,event_id,created_at) "
                    "VALUES (%s,%s,%s,'Forged unwitnessed review','en','pending',1,%s,UTC_TIMESTAMP(6))",
                    [order.pk.hex, buyer.hex, rating, row.event_id.hex],
                )
        self.assertEqual(self.dispute_state(), before)

    def test_moderation_history_and_command_seals_refuse_update_delete(self):
        row = self.submit_review(self.completed())
        packet = self.moderation_packet(row, "approve")
        reviews.moderate(self.root, row.pk, packet)
        decision = row.decisions.get()
        before = self.dispute_state()
        for sql, parameters in (
            ("UPDATE orders_reviewdecision SET reason='Forged moderation' WHERE id=%s", [decision.pk.hex]),
            ("DELETE FROM orders_reviewdecision WHERE id=%s", [decision.pk.hex]),
            ("UPDATE orders_aftercarecommand SET result=JSON_OBJECT('state','rejected') WHERE id=%s", [packet["command_id"].hex]),
            ("UPDATE orders_aftercarecommand SET actor_id=%s WHERE id=%s", [self.buyer.user.pk.hex, packet["command_id"].hex]),
            ("DELETE FROM orders_aftercarecommand WHERE id=%s", [packet["command_id"].hex]),
            ("UPDATE orders_aftercareevent SET action='review_withdrawn' WHERE id=%s", [decision.event_id.hex]),
            ("UPDATE orders_aftercare SET version=version+1 WHERE order_id=%s", [row.pk.hex]),
        ):
            with self.subTest(sql=sql):
                self.guard_rejects(sql, parameters)
        self.assertEqual(self.dispute_state(), before)

    def test_buyer_cannot_emit_ordinary_clear_or_unwitnessed_dispute_withdrawal(self):
        row = self.open_dispute(self.completed())
        from apps.fulfilment import services as delivery_services

        before = self.dispute_state()
        for action in ("case_clear", "dispute_withdrawn"):
            with self.subTest(action=action), self.assertRaises(DatabaseError) as error, transaction.atomic():
                state = delivery_services.coordinator(row.order)
                delivery_services.emit(row.order, state, action, self.buyer)
            self.assertEqual(error.exception.args[0], 1644)
        self.assertEqual(self.dispute_state(), before)
        self.assertTrue(delivery_queries.active_blockers(row.order).filter(pk=row.blocker_id).exists())

    def test_pending_published_opening_refuses_late_raw_sql_evidence_even_after_response(self):
        order = self.completed()
        image = payment_media.upload(self.buyer, order.pk, uuid.uuid4(), image_file())["id"]
        row = self.open_dispute(order)
        self.assertEqual(row.evidence_bindings.count(), 0)
        opening = AftercareEvent.objects.get(pk=row.event_id)
        command = AftercareCommand.objects.get(event=opening)
        self.assertGreaterEqual(command.result["version"], opening.version)
        for responded in (False, True):
            if responded:
                self.respond_dispute(row)
            before = self.dispute_state()
            self.guard_rejects(
                "INSERT INTO payments_evidencebinding (evidence_id,claim_id,receipt_id,correction_id,report_id,dispute_id,created_at) "
                "VALUES (%s,NULL,NULL,NULL,NULL,%s,UTC_TIMESTAMP(6))",
                [uuid.UUID(image).hex, row.pk.hex],
            )
            self.assertEqual(self.dispute_state(), before)
            row.refresh_from_db()
            self.assertEqual(row.state, "pending")

    def test_unpublished_dispute_evidence_caps_exact_target_and_denies_rebinding(self):
        order = self.completed()
        another = self.completed()
        images = [payment_media.upload(self.buyer, order.pk, uuid.uuid4(), image_file())["id"] for _ in range(4)]
        wrong_order = payment_media.upload(self.buyer, another.pk, uuid.uuid4(), image_file())["id"]
        wrong_account = payment_media.upload(self.seller, order.pk, uuid.uuid4(), image_file())["id"]
        order = aftercare_commands.lock_order(self.buyer, order.pk, disputes.requesters(self.buyer))
        _, head = aftercare_commands.ordered_state(order)
        opening = aftercare_commands.emit(order, head, "dispute_opened", self.buyer)
        row = DisputeRequest.objects.create(order=order, requester_account=self.buyer.account,
                                            event=opening, reason="Unpublished synthetic opening")
        sql = ("INSERT INTO payments_evidencebinding (evidence_id,claim_id,receipt_id,correction_id,report_id,dispute_id,created_at) "
               "VALUES (%s,NULL,NULL,NULL,NULL,%s,UTC_TIMESTAMP(6))")
        for image in (wrong_order, wrong_account):
            self.guard_rejects(sql, [uuid.UUID(image).hex, row.pk.hex])
        for image in images[:3]:
            with connection.cursor() as cursor:
                cursor.execute(sql, [uuid.UUID(image).hex, row.pk.hex])
        self.assertEqual(row.evidence_bindings.count(), 3)
        self.guard_rejects(sql, [uuid.UUID(images[3]).hex, row.pk.hex])
        self.guard_rejects(sql, [uuid.UUID(images[0]).hex, row.pk.hex])
        self.assertEqual(row.evidence_bindings.count(), 3)

    def test_dispute_due_seals_only_after_exact_cross_ledger_decision_and_final_request(self):
        order = self.completed()
        row = self.open_dispute(order)
        self.assign_dispute(row)
        order = aftercare_commands.lock_order(self.root, order.pk, disputes.order_scope(self.root))
        finance, head = aftercare_commands.ordered_state(order)
        event = aftercare_commands.emit(order, head, "dispute_decided", self.root)
        with self.assertRaises(DatabaseError) as mismatch, transaction.atomic():
            fresh = payment_services.coordinator(order)
            wrong_actor_event = payment_services.emit(order, fresh, "refund_due_created", self.seller)
            RefundDue.objects.create(order=order, cause="dispute", amount=Decimal("5.00"),
                                     currency=order.currency, event=wrong_actor_event)
        self.assertEqual(mismatch.exception.args[0], 1644)
        due = refunds.create_due(order, finance, self.root, "dispute", Decimal("5.00"), "Staged native refund")
        self.assertIsNotNone(due)
        from apps.notifications.models import Event as NoticeEvent

        self.assertFalse(RefundSeal.objects.filter(due=due).exists())
        self.assertFalse(NoticeEvent.objects.filter(payment_event_id=due.event_id).exists())
        self.guard_rejects("INSERT INTO payments_refundseal (due_id,created_at) VALUES (%s,UTC_TIMESTAMP(6))", [due.pk.hex])
        self.guard_rejects(
            "INSERT INTO orders_disputedecision "
            "(dispute_id,event_id,actor_id,account_id,context,action,amount,refund_due_id,reason,created_at) "
            "VALUES (%s,%s,%s,NULL,'owner','refund_ordered',4.00,%s,'Wrong exact amount',UTC_TIMESTAMP(6))",
            [row.pk.hex, event.pk.hex, self.root.user.pk.hex, due.pk.hex],
        )
        with self.assertRaises(DatabaseError) as error, transaction.atomic():
            fresh = payment_services.coordinator(order)
            payment_services.emit(order, fresh, "refund_assigned", self.root)
            DisputeDecision.objects.create(
                dispute=row, event=event, actor=self.root.user, context="owner", action="refund_ordered",
                amount=due.amount, refund_due=due, reason="Obsolete finance event must not witness decision",
            )
        self.assertEqual(error.exception.args[0], 1644)
        decision = DisputeDecision.objects.create(
            dispute=row, event=event, actor=self.root.user, account=account_for(self.root), context="owner",
            action="refund_ordered", amount=due.amount, refund_due=due, reason="Exact native cross-ledger witness",
        )
        self.assertNotEqual(decision.event_id, due.event_id)
        self.guard_rejects("INSERT INTO payments_refundseal (due_id,created_at) VALUES (%s,UTC_TIMESTAMP(6))", [due.pk.hex])
        row.refresh_from_db()
        row.state = "refund_ordered"
        row.version += 1
        row.save(update_fields=["state", "version"])
        RefundSeal.objects.create(due=due)
        self.assertEqual(RefundSeal.objects.filter(due=due).count(), 1)

    def test_one_unpublished_decision_event_cannot_mint_additional_dispute_dues(self):
        order = self.completed()
        row = self.open_dispute(order)
        self.assign_dispute(row)
        order = aftercare_commands.lock_order(self.root, order.pk, disputes.order_scope(self.root))
        finance, head = aftercare_commands.ordered_state(order)
        event = aftercare_commands.emit(order, head, "dispute_decided", self.root)
        due = refunds.create_due(order, finance, self.root, "dispute", Decimal("5.00"), "First retained due")
        sql = ("INSERT INTO payments_refunddue "
               "(id,order_id,cause,amount,currency,event_id,assigned_to_id,version,created_at) "
               "VALUES (%s,%s,'dispute',1.00,'AFN',%s,NULL,1,UTC_TIMESTAMP(6))")
        self.guard_rejects(sql, [uuid.uuid4().hex, order.pk.hex, due.event_id.hex])
        for decided in (False, True):
            if decided:
                DisputeDecision.objects.create(
                    dispute=row, event=event, actor=self.root.user, context="owner", action="refund_ordered",
                    amount=due.amount, refund_due=due, reason="First decision witness",
                )
            with self.subTest(decided=decided), self.assertRaises(DatabaseError) as error, transaction.atomic():
                fresh = payment_services.coordinator(order)
                refunds.create_due(order, fresh, self.root, "dispute", Decimal("1.00"), "Forbidden additional due")
            self.assertEqual(error.exception.args[0], 1644)
        self.assertEqual(RefundDue.objects.filter(order=order).count(), 1)
        self.assertEqual(refunds.due_total(order), Decimal("5.00"))

    def test_raw_refund_construction_refuses_missing_decide_permission_and_new_membership_conflict(self):
        actor, _ = self.dispute_reviewer("raw-refund-permission-reviewer")
        order = self.company_order(complete=True)
        row = self.open_dispute(order)
        self.assign_dispute(row, assigned_to=actor.user.pk)
        read_only = Group.objects.create(name="Synthetic assigned dispute reader")
        read_only.permissions.set(Permission.objects.filter(content_type__app_label="orders", codename="read_dispute"))
        actor.user.groups.remove(self.dispute_group())
        actor.user.groups.add(read_only)
        order = aftercare_commands.lock_order(self.root, order.pk, disputes.order_scope(self.root))
        for conflict in (False, True):
            if conflict:
                actor.user.groups.add(self.dispute_group())
                seller_context, _ = self.other_context(actor.user, "seller")
                Membership.objects.create(company=order.seller, account=seller_context.account, active=False)
            before = self.dispute_state()
            with self.subTest(membership_conflict=conflict), self.assertRaises(DatabaseError) as error, transaction.atomic():
                finance, head = aftercare_commands.ordered_state(order)
                aftercare_commands.emit(order, head, "dispute_decided", actor)
                refunds.create_due(order, finance, actor, "dispute", Decimal("5.00"), "Forbidden native refund")
            self.assertEqual(error.exception.args[0], 1644)
            self.assertEqual(self.dispute_state(), before)

    def test_dispute_refund_due_and_private_binding_are_retained_native_facts(self):
        order = self.completed()
        upload = payment_media.upload(self.buyer, order.pk, uuid.uuid4(), image_file())
        row = self.open_dispute(order, evidence=[upload["id"]])
        self.assign_dispute(row)
        due = RefundDue.objects.get(pk=self.decide_dispute(row, "refund", amount="5.00")["refund_due"])
        evidence = Evidence.objects.get(pk=upload["id"])
        before = self.dispute_state()
        self.guard_rejects("UPDATE payments_refunddue SET amount=amount+1 WHERE id=%s", [due.pk.hex])
        self.guard_rejects("UPDATE payments_evidencebinding SET dispute_id=NULL WHERE evidence_id=%s", [evidence.pk.hex])
        self.guard_rejects("DELETE FROM payments_evidencebinding WHERE evidence_id=%s", [evidence.pk.hex])
        self.assertEqual(self.dispute_state(), before)
