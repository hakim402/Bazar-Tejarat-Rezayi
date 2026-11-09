"""Generalized reports: participant authority, isolation and native target guards."""

import itertools
import uuid
from unittest.mock import patch

from django.db import DatabaseError, connection, transaction
from django.http import Http404
from django.test import TestCase, override_settings
from rest_framework.exceptions import NotFound, PermissionDenied

from apps.catalogue.models import Product, SourceRevision, PriceChange
from apps.marketplace import services as storefront
from apps.marketplace.models import Store, StoreEvent, StoreRevision
from apps.messaging import cases, media, queries, services
from apps.messaging.models import Attachment, CaseAccess, CaseEvent, Command, Conversation, Message, Report, ReadState
from apps.notifications import services as notifications
from apps.notifications.models import Event, Notice
from apps.organizations.models import Membership
from apps.verification.models import ReviewCase as BusinessReview
from tests.test_catalogue import image_file
from tests.test_disputes import DisputeFixture


class ReportFixture(DisputeFixture):
    def store_target(self):
        store = Store.objects.filter(pk=self.profile.pk).first()
        if store is None:
            store = storefront.save(self.seller, self.profile.pk, {
                "version": 0,
                "body": {
                    "source_locale": "fa-AF",
                    "editions": {"fa-AF": {"description": "Synthetic store description", "logo_alt": "", "banner_alt": ""}},
                    "country": "Afghanistan", "city": "Kabul", "logo": None, "banner": None,
                },
            })
        return store

    def report_packet(self, **extra):
        return {"command_id": uuid.uuid4(), "category": "privacy", "reason": "Synthetic private participant report", **extra}

    def target_report(self, kind, target, actor=None, **extra):
        packet = self.report_packet(**extra)
        actor = actor or self.buyer
        result = (services.report(actor, target.pk, packet) if kind == "message"
                  else services.report_target(actor, kind, target.pk, packet))
        return Report.objects.get(pk=result["id"])

    def transition_report(self, row, action, actor=None, **extra):
        row.refresh_from_db()
        return cases.transition(actor or self.root, row.pk, version=row.version, action=action,
                                reason="Independent synthetic report transition", **extra)

    def report_state(self):
        result = self.dispute_state()
        for model in (Report, CaseEvent, CaseAccess, Command, Conversation, Message, Attachment, ReadState,
                      Product, SourceRevision, PriceChange, Store, StoreRevision, StoreEvent):
            result[model._meta.label] = list(model.objects.order_by("pk").values())
        return result

    def four_targets(self):
        room = self.room()
        return {"message": room.messages.first(), "product": self.product,
                "store": self.store_target(), "order": self.completed()}


@override_settings(OWNER_MFA_REQUIRED=False)
class ReportTargetTests(ReportFixture, TestCase):
    def test_all_four_targets_create_real_versioned_cases_with_only_one_anchor(self):
        targets = self.four_targets()
        for kind, target in targets.items():
            with self.subTest(kind=kind):
                row = self.target_report(kind, target)
                self.assertEqual((row.target_kind, row.status, row.version), (kind, "open", 1))
                self.assertEqual(getattr(row, kind + "_id"), target.pk)
                self.assertEqual(sum(getattr(row, field + "_id") is not None for field in targets), 1)
                event = CaseEvent.objects.get(report=row)
                self.assertEqual((event.action, event.actor_id, event.version), ("reported", self.buyer.user.pk, 1))

    def test_new_target_replay_and_deliberate_duplicate_commands_coalesce_one_open_case(self):
        for kind, target in {"product": self.product, "store": self.store_target(), "order": self.completed()}.items():
            with self.subTest(kind=kind):
                packet = self.report_packet()
                first = services.report_target(self.buyer, kind, target.pk, packet)
                self.assertEqual(services.report_target(self.buyer, kind, target.pk, packet), first)
                duplicate = services.report_target(self.buyer, kind, target.pk, self.report_packet(reason="Distinct deliberate report"))
                self.assertEqual(duplicate["id"], first["id"])
                self.assertEqual(Report.objects.filter(reporter=self.buyer.account, **{kind + "_id": target.pk}).count(), 1)
                self.assertEqual(CaseEvent.objects.filter(report_id=first["id"], action="reported").count(), 1)
                self.assertEqual(Report.objects.get(pk=first["id"]).reason, packet["reason"])

    def test_message_route_retains_distinct_intents_while_identical_replay_is_sealed(self):
        message = self.room().messages.first()
        packet = self.report_packet()
        first = services.report(self.buyer, message.pk, packet)
        self.assertEqual(services.report(self.buyer, message.pk, packet), first)
        second = services.report(self.buyer, message.pk, self.report_packet())
        self.assertNotEqual(first["id"], second["id"])
        self.assertEqual(Report.objects.filter(message=message).count(), 2)

    def test_target_scoped_command_seal_rejects_changed_packet_preserves_other_target_identity(self):
        packet = self.report_packet()
        store = self.store_target()
        first = services.report_target(self.buyer, "product", self.product.pk, packet)
        before = self.report_state()
        for changes in ({"reason": "Changed report reason"}, {"category": "fraud"}):
            with self.subTest(changes=changes), self.assertRaises(services.CommandConflict):
                services.report_target(self.buyer, "product", self.product.pk, {**packet, **changes})
        self.assertEqual(self.report_state(), before)
        # Messaging's retained identity is (account, action/target, key), unlike
        # the order aftercare ledger's globally unique command UUID.
        second = services.report_target(self.buyer, "store", store.pk, packet)
        self.assertNotEqual(first["id"], second["id"])
        self.assertEqual(Command.objects.filter(account=self.buyer.account, key=packet["command_id"]).count(), 2)

    def test_product_and_store_require_buyer_and_unknown_or_ineligible_are_scoped_404(self):
        store = self.store_target()
        for kind, target in (("product", self.product), ("store", store)):
            with self.subTest(kind=kind):
                with self.assertRaises(PermissionDenied):
                    self.target_report(kind, target, actor=self.seller)
                with self.assertRaises(Http404):
                    services.report_target(self.buyer, kind, uuid.uuid4(), self.report_packet())
        BusinessReview.objects.filter(profile=self.profile).update(status="suspended")
        before = self.report_state()
        for kind, target in (("product", self.product), ("store", store)):
            with self.subTest(kind=kind), self.assertRaises(Http404):
                self.target_report(kind, target)
        self.assertEqual(self.report_state(), before)

    def test_order_report_exact_buyer_and_current_seller_positive_cross_buyer_denied(self):
        order = self.completed()
        buyer = self.target_report("order", order)
        seller = self.target_report("order", order, actor=self.seller)
        self.assertNotEqual(buyer.pk, seller.pk)
        before = self.report_state()
        with self.assertRaises(Http404):
            self.target_report("order", order, actor=self.other_buyer)
        self.assertEqual(self.report_state(), before)

    def test_order_report_revoked_company_member_loses_authority(self):
        order = self.company_order(complete=True)
        actor, _, member = self.seller_member(order)
        row = self.target_report("order", order, actor=actor)
        Membership.objects.filter(pk=member.pk).update(active=False)
        before = self.report_state()
        with self.assertRaises(Http404):
            self.target_report("order", order, actor=actor)
        with self.assertRaises(Http404):
            queries.target_reports(actor, "order", order.pk)
        self.assertEqual(self.report_state(), before)
        self.assertEqual(row.status, "open")

    def test_report_and_its_transitions_never_mutate_ratings_publication_prices_or_money(self):
        targets = self.four_targets()
        review = self.submit_review(targets["order"], rating=5)
        self.moderate_review(review)
        protected = self.dispute_state()
        catalogue = {m._meta.label: list(m.objects.order_by("pk").values())
                     for m in (Product, SourceRevision, PriceChange, Store, StoreRevision, StoreEvent)}
        # Notices are expected reporting effects, never financial or rating effects.
        for key in tuple(protected):
            if key.startswith("notifications.") or key == "runtime.Job":
                protected.pop(key)
        for kind, target in targets.items():
            row = self.target_report(kind, target)
            self.transition_report(row, "resolve")
            self.transition_report(row, "reopen")
        current = self.dispute_state()
        for key in tuple(current):
            if key.startswith("notifications.") or key == "runtime.Job":
                current.pop(key)
        self.assertEqual(current, protected)
        self.assertEqual({m._meta.label: list(m.objects.order_by("pk").values())
                          for m in (Product, SourceRevision, PriceChange, Store, StoreRevision, StoreEvent)}, catalogue)

    def test_own_report_lists_are_reporter_scoped_without_other_participant_reasons(self):
        order = self.completed()
        mine = self.target_report("order", order)
        other = self.target_report("order", order, actor=self.seller, reason="Seller confidential report reason")
        result = queries.own_reports(self.buyer)
        self.assertEqual(result["count"], 1)
        self.assertEqual(result["results"][0]["id"], str(mine.pk))
        self.assertNotIn(str(other.pk), str(result))
        self.assertNotIn(other.reason, str(result))
        self.assertEqual([r["id"] for r in queries.target_reports(self.seller, "order", order.pk)["results"]], [str(other.pk)])

    def test_target_api_positive_categories_strict_validation_and_own_status(self):
        path = f"messaging/buyer/reports/product/{self.product.pk}/"
        for category in ("abuse", "fraud", "spam", "privacy", "other"):
            with self.subTest(category=category):
                result = self.post(self.buyer_client, path, self.report_packet(category=category))
                self.assertEqual(result.status_code, 201, result.content)
        for changes in ({"category": "rating"}, {"reason": "ab"}, {"reason": "x" * 1001}, {"rating": 1}):
            with self.subTest(changes=changes):
                self.assertEqual(self.post(self.buyer_client, path, self.report_packet(**changes)).status_code, 400)
        own = self.buyer_client.get("/api/v1/messaging/buyer/reports/")
        self.assertEqual(own.status_code, 200, own.content)
        self.assertEqual((own.json()["count"], own.json()["results"][0]["target_kind"]), (1, "product"))
        self.assertEqual(Report.objects.get().category, "abuse")

    def test_report_get_head_and_scoped_404_do_not_create_case_notice_or_command(self):
        order = self.completed()
        store = self.store_target()
        before = self.report_state()
        for path in ("messaging/buyer/reports/", f"messaging/buyer/reports/product/{self.product.pk}/",
                     f"messaging/buyer/reports/store/{store.pk}/", f"messaging/buyer/reports/order/{order.pk}/"):
            for method in ("get", "head"):
                with self.subTest(path=path, method=method):
                    self.assertEqual(getattr(self.buyer_client, method)("/api/v1/" + path).status_code, 200)
        self.assertEqual(self.other_client.get(f"/api/v1/messaging/buyer/reports/order/{order.pk}/").status_code, 404)
        self.assertEqual(self.buyer_client.get(f"/api/v1/messaging/buyer/reports/unknown/{uuid.uuid4()}/").status_code, 404)
        self.assertEqual(self.report_state(), before)


@override_settings(OWNER_MFA_REQUIRED=False)
class ReportCaseScopeTests(ReportFixture, TestCase):
    def test_assigned_order_case_reads_only_existing_matching_thread_and_audits_before_disclosure(self):
        matching = self.room()
        unrelated_id = services.create_enquiry(self.other_buyer, {
            "command_id": uuid.uuid4(), "body": "Unrelated private thread", "images": [],
            "product": self.product.pk, "locale": "en",
        })["conversation"]
        order = self.completed()
        row = self.target_report("order", order)
        self.transition_report(row, "assign", assigned_to=self.staff.account.pk)
        before = ReadState.objects.order_by("pk").values_list("pk", "last_read")
        reads = list(before)
        result = cases.inspect(self.staff, row.pk)
        self.assertEqual([r["body"] for r in result["messages"]], [matching.messages.first().body])
        self.assertNotIn("Unrelated private thread", str(result))
        audit = CaseAccess.objects.get(report=row)
        self.assertEqual((audit.conversation_id, audit.actor_id, audit.action, audit.target),
                         (matching.pk, self.staff.user.pk, "inspect", matching.pk))
        self.assertNotEqual(audit.conversation_id, uuid.UUID(unrelated_id))
        self.assertEqual(list(ReadState.objects.order_by("pk").values_list("pk", "last_read")), reads)

    def test_order_checkout_without_enquiry_does_not_mint_conversation_access(self):
        row = self.target_report("order", self.completed())
        before = self.report_state()
        with self.assertRaises(NotFound):
            cases.inspect(self.root, row.pk)
        self.assertEqual(self.report_state(), before)
        self.assertFalse(Conversation.objects.exists())

    def test_product_store_cases_never_grant_thread_or_attachment_access_even_root(self):
        room = self.room()
        staged = media.upload(self.buyer, room.pk, uuid.uuid4(), image_file())
        services.send(self.buyer, room.pk, {
            "command_id": uuid.uuid4(), "body": "Private image context", "images": [uuid.UUID(staged["id"])],
        })
        for kind, target in (("product", self.product), ("store", self.store_target())):
            row = self.target_report(kind, target)
            before = self.report_state()
            with self.subTest(kind=kind):
                with self.assertRaises(NotFound):
                    cases.inspect(self.root, row.pk)
                with self.assertRaises(NotFound):
                    cases.attachment(self.root, row.pk, staged["id"])
            self.assertEqual(self.report_state(), before)

    def test_order_case_evidence_is_matching_thread_only_and_audited(self):
        room = self.room()
        own = media.upload(self.buyer, room.pk, uuid.uuid4(), image_file())
        services.send(self.buyer, room.pk, {
            "command_id": uuid.uuid4(), "body": "Order-linked image", "images": [uuid.UUID(own["id"])],
        })
        other_result = services.create_enquiry(self.other_buyer, {
            "command_id": uuid.uuid4(), "body": "Other buyer enquiry", "images": [], "product": self.product.pk,
            "locale": "en",
        })
        other = media.upload(self.other_buyer, other_result["conversation"], uuid.uuid4(), image_file())
        services.send(self.other_buyer, other_result["conversation"], {
            "command_id": uuid.uuid4(), "body": "Other buyer image", "images": [uuid.UUID(other["id"])],
        })
        row = self.target_report("order", self.completed())
        item = cases.attachment(self.root, row.pk, own["id"])
        self.assertEqual(str(item.pk), own["id"])
        access = CaseAccess.objects.get(report=row)
        self.assertEqual((access.action, access.conversation_id, access.target), ("image", room.pk, item.pk))
        before = self.report_state()
        with self.assertRaises(Http404):
            cases.attachment(self.root, row.pk, other["id"])
        self.assertEqual(self.report_state(), before)

    def test_unassigned_resolved_and_revoked_staff_cannot_inspect_order_case(self):
        self.room()
        row = self.target_report("order", self.completed())
        with self.assertRaises(NotFound):
            cases.inspect(self.staff, row.pk)
        self.transition_report(row, "assign", assigned_to=self.staff.account.pk)
        self.assertEqual(cases.inspect(self.staff, row.pk)["report"].pk, row.pk)
        self.staff.user.groups.clear()
        before = self.report_state()
        with self.assertRaises(Http404):
            cases.inspect(self.staff, row.pk)
        self.assertEqual(self.report_state(), before)
        self.transition_report(row, "resolve")
        with self.assertRaises(NotFound):
            cases.inspect(self.root, row.pk)
        self.transition_report(row, "reopen")
        row.refresh_from_db()
        self.assertEqual((row.status, row.assigned_to_id), ("open", None))

    def test_root_reporter_and_historical_seller_members_are_not_independent(self):
        root_buyer, _ = self.other_context(self.root.user, "buyer")
        own = self.target_report("product", self.product, actor=root_buyer)
        before = self.report_state()
        with self.assertRaises(PermissionDenied):
            self.transition_report(own, "resolve")
        self.assertEqual(self.report_state(), before)
        order = self.company_order(complete=True)
        actor, _, member = self.seller_member(order)
        from apps.accounts.models import User

        User.objects.filter(pk=actor.user.pk).update(is_staff=True)
        actor.user.refresh_from_db()
        staff, _ = self.other_context(actor.user, "staff")
        staff.user.groups.add(self.group)
        Membership.objects.filter(pk=member.pk).update(active=False)
        row = self.target_report("order", order)
        self.assertFalse(cases.queryset(staff).filter(pk=row.pk).exists())
        with self.assertRaises(PermissionDenied):
            cases.independent(row, staff.user)

    def test_audit_sink_failure_prevents_private_body_and_image_disclosure(self):
        room = self.room()
        staged = media.upload(self.buyer, room.pk, uuid.uuid4(), image_file())
        services.send(self.buyer, room.pk, {
            "command_id": uuid.uuid4(), "body": "Private audited proof", "images": [uuid.UUID(staged["id"])],
        })
        row = self.target_report("order", self.completed())
        before = self.report_state()
        # Fault only the audit sink, never a participant, delivery or business fact.
        with patch("apps.messaging.cases.CaseAccess.objects.create", side_effect=RuntimeError("Synthetic audit unavailable")):
            with self.assertRaises(RuntimeError):
                cases.inspect(self.root, row.pk)
            with self.assertRaises(RuntimeError):
                cases.attachment(self.root, row.pk, staged["id"])
        self.assertEqual(self.report_state(), before)

    def test_report_status_notices_use_exact_target_and_reporter_not_staff_or_counterpart(self):
        for kind, target in self.four_targets().items():
            with self.subTest(kind=kind):
                row = self.target_report(kind, target)
                self.transition_report(row, "resolve")
                event = Event.objects.get(report=row, report_version=2)
                notice = Notice.objects.get(event=event)
                self.assertEqual(notice.account_id, self.buyer.account.pk)
                anchor = "conversation_id" if kind == "message" else kind + "_id"
                expected = target.conversation_id if kind == "message" else target.pk
                self.assertEqual(getattr(notice, anchor), expected)
                result = notifications.notices(self.buyer)
                typed = next(r for r in result["results"] if r["report"] == str(row.pk))
                self.assertEqual(typed["kind"], "report_status")
                self.assertNotIn(row.reason, str(typed))


@override_settings(OWNER_MFA_REQUIRED=False)
class ReportNativeGuardTests(ReportFixture, TestCase):
    def test_native_exactly_one_target_constraint_rejects_every_zero_or_multi_target_shape(self):
        targets = self.four_targets()
        self.assertEqual(connection.vendor, "mysql")
        before = self.report_state()
        fields = tuple(targets)
        for size in (0, 2, 3, 4):
            for selected in itertools.combinations(fields, size):
                values = [targets[k].pk.hex if k in selected else None for k in fields]
                with self.subTest(targets=selected), self.assertRaises(DatabaseError) as error, transaction.atomic(), connection.cursor() as cursor:
                    cursor.execute(
                        "INSERT INTO messaging_report (id,message_id,product_id,store_id,order_id,reporter_id,category,reason,status,assigned_to_id,version,created_at) "
                        "VALUES (%s,%s,%s,%s,%s,%s,'privacy','Invalid target shape','open',NULL,1,UTC_TIMESTAMP(6))",
                        [uuid.uuid4().hex, *values, self.buyer.account.pk.hex],
                    )
                self.assertEqual(error.exception.args[0], 4025)
                self.assertIn("messaging_report_target", str(error.exception))
        self.assertEqual(self.report_state(), before)

    def test_all_four_retained_targets_category_reason_and_reporter_cannot_be_retargeted(self):
        targets = self.four_targets()
        for kind, target in targets.items():
            row = self.target_report(kind, target)
            before = self.report_state()
            for sql, parameters in (
                ("UPDATE messaging_report SET category='fraud',version=version+1 WHERE id=%s", [row.pk.hex]),
                ("UPDATE messaging_report SET reason='Forged report',version=version+1 WHERE id=%s", [row.pk.hex]),
                ("UPDATE messaging_report SET reporter_id=%s,version=version+1 WHERE id=%s", [self.other_buyer.account.pk.hex, row.pk.hex]),
                (f"UPDATE messaging_report SET {kind}_id=NULL,version=version+1 WHERE id=%s", [row.pk.hex]),
                ("DELETE FROM messaging_report WHERE id=%s", [row.pk.hex]),
            ):
                with self.subTest(kind=kind, sql=sql):
                    self.guard_rejects(sql, parameters)
            self.assertEqual(self.report_state(), before)

    def test_report_command_case_event_and_access_audit_are_append_only(self):
        self.room()
        row = self.target_report("order", self.completed())
        cases.inspect(self.root, row.pk)
        event = CaseEvent.objects.get(report=row)
        audit = CaseAccess.objects.get(report=row)
        seal = Command.objects.get(outcome__id=str(row.pk))
        before = self.report_state()
        for sql, parameters in (
            ("UPDATE messaging_command SET outcome=JSON_OBJECT('status','resolved') WHERE id=%s", [seal.pk.hex]),
            ("DELETE FROM messaging_command WHERE id=%s", [seal.pk.hex]),
            ("UPDATE messaging_caseevent SET reason='Forged case history' WHERE id=%s", [event.pk.hex]),
            ("DELETE FROM messaging_caseevent WHERE id=%s", [event.pk.hex]),
            ("UPDATE messaging_caseaccess SET target=%s WHERE id=%s", [uuid.uuid4().hex, audit.pk.hex]),
            ("DELETE FROM messaging_caseaccess WHERE id=%s", [audit.pk.hex]),
        ):
            with self.subTest(sql=sql):
                self.guard_rejects(sql, parameters)
        self.assertEqual(self.report_state(), before)
