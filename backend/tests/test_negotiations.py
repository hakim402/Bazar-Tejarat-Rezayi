"""Real PostgreSQL negotiation transitions, bounds and immutable agreements."""
from django.db import DatabaseError as WakeFailure, connection
from unittest import skipUnless

import copy
import uuid
from decimal import Decimal
from unittest.mock import patch
from datetime import timedelta
from django.test import TestCase, TransactionTestCase, override_settings
from django.db import transaction, DatabaseError
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from tests.test_commerce import CommerceFixture
from tests.test_catalogue import image_file
from apps.catalogue import services as catalogue
from apps.catalogue.media import upload
from apps.catalogue.models import Product, Variant
from apps.orders import negotiations as n, queries, documents
from apps.orders.models import Negotiation, NegotiationRevision, NegotiationEvent, SellerOrder, Invoice, OrderLine
from apps.notifications.models import Notice, Outbox


class NegotiationFixture(CommerceFixture):
    def setUp(self):
        super().setUp()
        self.fixed = self.variant
        result = catalogue.create(
            self.seller, {"seller": self.profile.pk, "currency": "AFN", "pricing_mode": "negotiable"}
        )
        self.negotiable = Product.objects.get(pk=result["id"])
        image = upload(self.seller, self.negotiable.pk, self.negotiable.version, image_file())
        self.negotiable.refresh_from_db()
        self.product.refresh_from_db()
        body = copy.deepcopy(self.product.published.body)
        body = {
            k: body[k]
            for k in ["locale", "title", "description", "brand", "category", "attributes", "images", "variants"]
        }
        body["images"] = [{"id": image["id"], "alt": "Synthetic negotiation", "variant": None}]
        for v in body["variants"]:
            v.pop("id", None)
            v.pop("attribute_labels", None)
            v["sku"] = "NEG-" + str(uuid.uuid4())[:8]
            v["retail"] = "12.50"
            v["wholesale"] = "10.00"
        saved = catalogue.save(self.seller, self.negotiable.pk, {"version": self.negotiable.version, "body": body})
        for actor, action in [(self.seller, "submit"), (self.reviewer, "publish")]:
            self.negotiable.refresh_from_db()
            catalogue.transition(
                actor,
                self.negotiable.pk,
                {
                    "version": self.negotiable.version,
                    "revision": saved["revision"],
                    "action": action,
                    "reason": "Synthetic negotiable publication",
                },
            )
        self.variant = Variant.objects.get(product=self.negotiable)
        self.seed_stock(self.variant)

    def proposal(self):
        return {
            "lines": [
                {
                    "variant": str(self.variant.pk),
                    "tier": "retail",
                    "quantity": "2.000",
                    "unit_price": "10.00",
                    "max_quantity": "4.000",
                    "max_unit_price": "15.00",
                }
            ],
            "choice": {"seller": str(self.profile.pk), "country": "AF", "city": "kabul", "method": "advance"},
            "explanation": "seller-finalizes-v1",
            "note": "Synthetic buyer proposal",
        }

    def request_packet(self):
        self.add(quantity="2.000")
        cart = __import__("apps.cart.services", fromlist=["buyer"]).buyer(self.buyer)
        return {
            "command_id": uuid.uuid4(),
            "version": cart.version,
            "currency": "AFN",
            "lines": [x.pk for x in cart.lines.filter(variant=self.variant)],
            "proposals": [self.proposal()],
        }

    def submitted(self):
        result = n.submit(self.buyer, self.request_packet())
        self.assertEqual(result["outcomes"][0]["state"], "submitted", result)
        return Negotiation.objects.get(pk=result["outcomes"][0]["request"])

    def final(self, row):
        return {
            "command_id": uuid.uuid4(),
            "version": row.version,
            "reason": "Synthetic actual seller finalization",
            "lines": [{k: v for k, v in self.proposal()["lines"][0].items() if not k.startswith("max_")}],
            "choice": self.proposal()["choice"],
        }

    def extra_variant(self, profile, currency="AFN"):
        from apps.orders import services as orders

        result = catalogue.create(
            self.seller, {"seller": profile.pk, "currency": currency, "pricing_mode": "negotiable"}
        )
        product = Product.objects.get(pk=result["id"])
        image = upload(self.seller, product.pk, product.version, image_file())
        product.refresh_from_db()
        source = Product.objects.get(pk=self.negotiable.pk).published.body
        body = {
            k: copy.deepcopy(source[k])
            for k in ["locale", "title", "description", "brand", "category", "attributes", "images", "variants"]
        }
        body["images"] = [{"id": image["id"], "alt": "Synthetic second request product", "variant": None}]
        for line in body["variants"]:
            line.pop("id", None)
            line.pop("attribute_labels", None)
            line["sku"] = "EXTRA-" + str(uuid.uuid4())[:8]
            line["retail"] = "12.50"
            line["wholesale"] = "10.00"
        saved = catalogue.save(self.seller, product.pk, {"version": product.version, "body": body})
        for actor, action in [(self.seller, "submit"), (self.reviewer, "publish")]:
            product.refresh_from_db()
            catalogue.transition(
                actor,
                product.pk,
                {
                    "version": product.version,
                    "revision": saved["revision"],
                    "action": action,
                    "reason": "Synthetic request publication",
                },
            )
        variant = Variant.objects.get(product=product)
        self.seed_stock(variant)
        if not orders.terms(profile)["enabled"]:
            orders.set_terms(
                self.seller,
                profile.pk,
                {
                    "version": 0,
                    "enabled": True,
                    "destinations": [{"country": "AF", "all_cities": True, "cities": []}],
                    "methods": ["advance", "cod"],
                    "reason": "Synthetic second seller terms",
                },
            )
        return variant

    def request_company(self):
        from apps.organizations.models import BusinessProfile, Membership
        from apps.verification.models import ReviewCase

        profile = BusinessProfile.objects.create(
            account=self.seller.account, kind="company", display_name="Synthetic negotiation company"
        )
        Membership.objects.create(
            company=profile, account=self.seller.account, is_owner=True, bundles=["catalogue", "orders_negotiation"]
        )
        ReviewCase.objects.create(
            profile=profile, status="approved", snapshot={"display_name": "Synthetic negotiation company"}
        )
        return profile


@override_settings(OWNER_MFA_REQUIRED=False)
class NegotiationTests(NegotiationFixture, TestCase):
    def test_submission_finalization_limits_replay_snapshot_and_no_stock_change(self):
        before = self.inventory_state()
        row = self.submitted()
        self.assertFalse(SellerOrder.objects.exists())
        data = self.final(row)
        data["lines"][0].update(quantity="4.000", unit_price="15.00")
        data["choice"]["method"] = "cod"
        first = n.transition(self.seller, row.pk, "finalize", data)
        self.assertEqual(n.transition(self.seller, row.pk, "finalize", data), first)
        order = SellerOrder.objects.get()
        self.assertIsNone(order.outcome_id)
        self.assertEqual(order.negotiation_id, row.pk)
        self.assertEqual(order.goods_total, Decimal("60.00"))
        self.assertIsNone(order.due_at)
        self.assertEqual(order.snapshot["origin"], "negotiated")
        self.assertEqual(order.snapshot["finalizer"]["account"], str(self.seller.account.pk))
        self.assertEqual(OrderLine.objects.get().snapshot["max_quantity"], "4.000")
        self.assertEqual(self.inventory_state(), before)
        self.assertEqual(Invoice.objects.count(), 1)
        self.assertEqual(Notice.objects.filter(negotiation=row, event__negotiation_event__action="accepted").count(), 1)
        self.assertEqual(Notice.objects.filter(order=order).count(), 0)
        self.assertFalse(Outbox.objects.exists())

    def test_over_limit_and_incomplete_finalization_roll_back_all_lines(self):
        row = self.submitted()
        for changes in [{"quantity": "4.001"}, {"unit_price": "15.01"}, {"quantity": "0.000"}, {"tier": "wholesale"}]:
            data = self.final(row)
            data["lines"][0].update(changes)
            with self.assertRaises(ValidationError):
                n.transition(self.seller, row.pk, "finalize", data)
            self.assertFalse(Invoice.objects.exists())
            row.refresh_from_db()
            self.assertEqual(row.state, "submitted")

    def test_correction_lower_caps_stale_finalizer_and_history(self):
        row = self.submitted()
        stale = self.final(row)
        n.transition(
            self.seller,
            row.pk,
            "request-correction",
            {"command_id": uuid.uuid4(), "version": 1, "reason": "Correct the terms"},
        )
        p = self.proposal()
        p["lines"][0].update(unit_price="5.00", max_unit_price="6.00", quantity="1.000", max_quantity="1.000")
        n.transition(
            self.buyer,
            row.pk,
            "resubmit",
            {"command_id": uuid.uuid4(), "version": 2, "reason": "Buyer narrows binding maxima", "proposal": p},
        )
        with self.assertRaises(n.CommandConflict):
            n.transition(self.seller, row.pk, "finalize", stale)
        row.refresh_from_db()
        data = self.final(row)
        with self.assertRaises(ValidationError):
            n.transition(self.seller, row.pk, "finalize", data)
        data["lines"][0].update(unit_price="6.00", quantity="1.000")
        n.transition(self.seller, row.pk, "finalize", data)
        self.assertEqual(NegotiationRevision.objects.filter(request=row).count(), 2)
        self.assertEqual(NegotiationEvent.objects.filter(request=row).count(), 4)

    def test_no_automatic_expiry_and_buyer_need_not_be_online(self):
        row = self.submitted()
        later = timezone.now() + timedelta(days=4000)
        from apps.accounts.models import ContextGrant

        ContextGrant.objects.filter(authority_id=self.buyer.request.session["authority"]).update(revoked=True)
        with patch("apps.orders.services.timezone.now", return_value=later):
            n.transition(self.seller, row.pk, "finalize", self.final(row))
        order = SellerOrder.objects.get()
        self.assertEqual(order.accepted_at, later)
        self.assertEqual((order.due_at - later).total_seconds(), 72 * 3600)

    def test_raw_history_and_caps_cannot_be_rewritten(self):
        row = self.submitted()
        for model, values in [
            (Negotiation, {"revision": 3, "version": 2}),
            (NegotiationRevision, {"body": {}}),
            (NegotiationEvent, {"reason": "forged"}),
        ]:
            with self.assertRaises(DatabaseError), transaction.atomic():
                model.objects.update(**values)
        n.transition(self.seller, row.pk, "finalize", self.final(row))
        for model, values in [
            (SellerOrder, {"goods_total": "1.00"}),
            (OrderLine, {"quantity": "999.000"}),
            (Invoice, {"number": "FORGED"}),
        ]:
            with self.assertRaises(DatabaseError), transaction.atomic():
                model.objects.update(**values)

    def test_api_privacy_unknown_fields_csrf_and_context_isolation(self):
        row = self.submitted()
        url = f"/api/v1/orders/buyer/negotiations/{row.pk}/"
        self.assertEqual(self.buyer_client.get(url).status_code, 200)
        self.assertEqual(self.other_client.get(url).status_code, 404)
        self.assertEqual(self.seller_client.get(url).status_code, 403)
        data = self.final(row)
        data["lines"][0]["max_unit_price"] = "999.00"
        response = self.post(self.seller_client, f"orders/seller/negotiations/{row.pk}/finalize/", n.canonical(data))
        self.assertEqual(response.status_code, 400, response.content)
        from rest_framework.test import APIClient

        self.assertIn(APIClient().post("/api/v1/orders/buyer/negotiation-submissions/", {}).status_code, [403, 400])

    def test_withdrawal_terminal_and_no_auto_reopen(self):
        row = self.submitted()
        data = {"command_id": uuid.uuid4(), "version": 1, "reason": "Buyer withdraws before seller finalization"}
        result = n.transition(self.buyer, row.pk, "withdraw", data)
        self.assertEqual(n.transition(self.buyer, row.pk, "withdraw", data), result)
        with self.assertRaises(n.CommandConflict):
            n.transition(self.seller, row.pk, "finalize", self.final(row))
        self.assertFalse(Invoice.objects.exists())

    def test_protected_documents_and_no_stored_contacts(self):
        row = self.submitted()
        n.transition(self.seller, row.pk, "finalize", self.final(row))
        invoice = Invoice.objects.get()
        for locale in ["fa-AF", "ps", "ar", "en"]:
            text = documents.html_document(queries.document(self.buyer, invoice.pk), locale)
            self.assertNotIn("PRIVATE", text)
            self.assertIn("BR-", text)
        self.assertEqual(self.other_client.get(f"/api/v1/orders/buyer/invoices/{invoice.pk}/pdf/").status_code, 404)


@override_settings(OWNER_MFA_REQUIRED=False)
class NegotiationConcurrencyTests(NegotiationFixture, TransactionTestCase):
    def race(self, actions):
        from concurrent.futures import ThreadPoolExecutor
        from threading import Barrier
        from django.db import connections

        barrier = Barrier(len(actions))

        def run(action):
            connections.close_all()
            try:
                barrier.wait(timeout=10)
                return action()
            except n.CommandConflict:
                return {"conflict": True}
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=len(actions)) as pool:
            return list(pool.map(run, actions))

    def test_withdrawal_versus_finalization_has_one_winner_and_no_deadlock(self):
        row = self.submitted()
        data = self.final(row)
        results = self.race(
            [
                lambda: n.transition(self.seller, row.pk, "finalize", data),
                lambda: n.transition(
                    self.buyer,
                    row.pk,
                    "withdraw",
                    {"command_id": uuid.uuid4(), "version": 1, "reason": "Concurrent buyer withdrawal"},
                ),
            ]
        )
        self.assertEqual(sum(bool(r.get("conflict")) for r in results), 1)
        row.refresh_from_db()
        self.assertIn(row.state, ["accepted", "withdrawn"])
        self.assertEqual(Invoice.objects.count(), 1 if row.state == "accepted" else 0)
        self.assertEqual(NegotiationEvent.objects.filter(request=row).count(), 2)

    def test_concurrent_finalizers_reconcile_one_order_invoice_event(self):
        row = self.submitted()
        data = self.final(row)
        results = self.race(
            [
                lambda: n.transition(self.seller, row.pk, "finalize", data),
                lambda: n.transition(self.seller, row.pk, "finalize", data),
            ]
        )
        self.assertEqual(results[0], results[1])
        self.assertEqual(Invoice.objects.count(), 1)
        self.assertEqual(NegotiationEvent.objects.filter(request=row, action="accepted").count(), 1)

    @skipUnless(connection.vendor == "mysql", "Native private construction publication boundary")
    def test_private_construction_never_appears_as_an_accepted_request_agreement(self):
        from apps.orders import services
        row=self.submitted()
        data=self.final(row)
        with transaction.atomic():
            buyer=n.participant_locks(self.seller,row.seller_id,row.buyer_id)
            prepared,total,snapshot,proposal=n.final_offer(buyer,row,data)
            snapshot.update(origin="negotiated",proposal=proposal,finalizer={"account":str(self.seller.account.pk)})
            with patch("apps.orders.services.event"):
                services.write_agreement(self.seller,buyer,row.seller,row.currency,data["choice"],prepared,total,snapshot,negotiation=row)
        self.assertTrue(SellerOrder.construction.exists())
        self.assertFalse(SellerOrder.objects.exists())
        self.assertFalse(Invoice.objects.exists())
        result=n.request_data(Negotiation.objects.get(pk=row.pk),"buyer")
        self.assertIsNone(result["order"])
        self.assertIsNone(result["invoice"])

    def test_raw_incomplete_agreement_and_forged_cap_rollback_at_commit(self):
        row = self.submitted()
        data = self.final(row)
        with self.assertRaises(DatabaseError):
            with transaction.atomic():
                buyer = n.participant_locks(self.seller, row.seller_id, row.buyer_id)
                locked = Negotiation.objects.select_for_update().get(pk=row.pk)
                prepared, total, snapshot, proposal = n.final_offer(buyer, locked, data)
                snapshot.update(
                    origin="negotiated", proposal=proposal, finalizer={"account": str(self.seller.account.pk)}
                )
                from apps.orders import services

                with patch("apps.orders.services.event"):
                    services.write_agreement(
                        self.seller,
                        buyer,
                        row.seller,
                        row.currency,
                        data["choice"],
                        prepared,
                        total,
                        snapshot,
                        negotiation=locked,
                    )
                if connection.vendor == "mysql":
                    from apps.orders.models import NegotiationEvent
                    NegotiationEvent.objects.create(request=locked, version=locked.version+1,
                        revision=locked.revision, action="accepted", actor=self.seller.account,
                        reason="Synthetic missing agreement event")
        self.assertFalse(Invoice.objects.exists())
        self.assertFalse(SellerOrder.construction.exists())
        with self.assertRaises(DatabaseError):
            with transaction.atomic():
                buyer = n.participant_locks(self.seller, row.seller_id, row.buyer_id)
                prepared, total, snapshot, proposal = n.final_offer(buyer, row, data)
                prepared[0]["quantity"] = Decimal("5.000")
                prepared[0]["amount"] = Decimal("50.00")
                prepared[0]["snapshot"]["max_quantity"] = "999.000"
                snapshot.update(
                    origin="negotiated", proposal=proposal, finalizer={"account": str(self.seller.account.pk)}
                )
                services.write_agreement(
                    self.seller,
                    buyer,
                    row.seller,
                    row.currency,
                    data["choice"],
                    prepared,
                    Decimal("50"),
                    snapshot,
                    negotiation=row,
                )
        self.assertFalse(SellerOrder.objects.exists())

    def test_membership_revocation_during_finalization_rechecks_after_profile_lock(self):
        from concurrent.futures import ThreadPoolExecutor
        from threading import Event
        from django.db import connections
        from django.http import Http404
        from apps.organizations.models import BusinessProfile, Membership

        company = self.request_company()
        self.variant = self.extra_variant(company)
        self.profile = company
        operator, _ = self.connected("seller", "negotiation-race-operator")
        member = Membership.objects.create(company=company, account=operator.account, bundles=["orders_negotiation"])
        row = self.submitted()
        started = Event()
        original = n.participant_locks

        def attempting(*args, **kwargs):
            started.set()
            return original(*args, **kwargs)

        def finalizer():
            connections.close_all()
            try:
                return n.transition(operator, row.pk, "finalize", self.final(row))
            except Http404:
                return {"revoked": True}
            finally:
                connections.close_all()

        with (
            ThreadPoolExecutor(max_workers=1) as pool,
            patch("apps.orders.negotiations.participant_locks", side_effect=attempting),
        ):
            with transaction.atomic():
                locked = BusinessProfile.objects.select_for_update().get(pk=company.pk)
                future = pool.submit(finalizer)
                self.assertTrue(started.wait(timeout=10))
                member.active = False
                member.save()
                locked.version += 1
                locked.save()
            self.assertEqual(future.result(timeout=15), {"revoked": True})
        self.assertFalse(Invoice.objects.exists())
        row.refresh_from_db()
        self.assertEqual(row.state, "submitted")

    def test_resubmission_serializes_against_stale_wider_finalizer(self):
        row = self.submitted()
        stale = self.final(row)
        n.transition(
            self.seller,
            row.pk,
            "request-correction",
            {"command_id": uuid.uuid4(), "version": 1, "reason": "Synthetic concurrent correction"},
        )
        p = self.proposal()
        p["lines"][0].update(unit_price="5.00", max_unit_price="6.00")
        results = self.race(
            [
                lambda: n.transition(self.seller, row.pk, "finalize", stale),
                lambda: n.transition(
                    self.buyer,
                    row.pk,
                    "resubmit",
                    {"command_id": uuid.uuid4(), "version": 2, "reason": "Buyer lowers cap atomically", "proposal": p},
                ),
            ]
        )
        self.assertEqual(sum(bool(x.get("conflict")) for x in results), 1)
        self.assertFalse(Invoice.objects.exists())
        row.refresh_from_db()
        self.assertEqual(row.revision, 2)
        self.assertRaises(ValidationError, n.transition, self.seller, row.pk, "finalize", self.final(row))


@override_settings(OWNER_MFA_REQUIRED=False)
class NegotiationSafetyTests(NegotiationFixture, TestCase):
    def test_invalid_missing_caps_and_nonfinite_precision_are_rejected_at_api(self):
        from apps.orders.negotiation_contracts import SubmissionCommand

        packet = n.canonical(self.request_packet())
        for field, value in [
            ("max_unit_price", None),
            ("max_unit_price", "NaN"),
            ("max_unit_price", "-1.00"),
            ("max_unit_price", "1000000000.00"),
            ("max_quantity", "Infinity"),
            ("max_quantity", "1.0001"),
            ("unit_price", "0.000"),
            ("quantity", "1e3"),
        ]:
            data = copy.deepcopy(packet)
            data["proposals"][0]["lines"][0][field] = value
            serializer = SubmissionCommand(data=data)
            self.assertFalse(serializer.is_valid(), (field, value))
        data = copy.deepcopy(packet)
        data["proposals"][0]["lines"][0].pop("max_unit_price")
        self.assertFalse(SubmissionCommand(data=data).is_valid())
        for value in ["0.00", "-1.00"]:
            data = copy.deepcopy(packet)
            data["proposals"][0]["lines"][0]["max_unit_price"] = value
            self.assertRaises(
                ValidationError, n.validate_proposal, self.buyer.account, self.profile, data["proposals"][0], "AFN"
            )
        self.assertFalse(Negotiation.objects.exists())

    def test_preview_writes_nothing_and_fixed_currency_duplicate_substitution_denied(self):
        packet = self.request_packet()
        before = self.inventory_state()
        result = n.preview_submission(self.buyer, packet)
        self.assertEqual(result["results"][0]["code"], "ready")
        self.assertFalse(Negotiation.objects.exists())
        self.assertEqual(self.inventory_state(), before)
        data = copy.deepcopy(packet)
        data["proposals"][0]["lines"] *= 2
        self.assertRaises(ValidationError, n.submit, self.buyer, data)
        data = copy.deepcopy(packet)
        data["proposals"][0]["lines"][0]["variant"] = str(self.fixed.pk)
        self.assertRaises(ValidationError, n.submit, self.buyer, data)
        data = copy.deepcopy(packet)
        data["currency"] = "USD"
        self.assertRaises(ValidationError, n.submit, self.buyer, data)

    def test_command_and_submission_absence_is_fenced_before_late_write(self):
        packet = self.request_packet()
        self.assertTrue(n.settle_submission(self.buyer, packet["command_id"])["rejected"])
        self.assertRaises(n.CommandConflict, n.submit, self.buyer, packet)
        packet["command_id"] = uuid.uuid4()
        result = n.submit(self.buyer, packet)
        row = Negotiation.objects.get(pk=result["outcomes"][0]["request"])
        command = self.final(row)
        self.assertTrue(n.settle_command(self.seller, row.pk, command["command_id"])["rejected"])
        self.assertRaises(n.CommandConflict, n.transition, self.seller, row.pk, "finalize", command)
        command["command_id"] = uuid.uuid4()
        accepted = n.transition(self.seller, row.pk, "finalize", command)
        self.assertEqual(n.settle_command(self.seller, row.pk, command["command_id"]), accepted)
        self.assertEqual(Invoice.objects.count(), 1)

    def test_membership_scope_staff_readonly_and_revocation(self):
        from apps.organizations.models import Membership
        from django.contrib.auth.models import Permission
        from django.http import Http404

        # Exact individual source cannot be read or acted on through a different seller.
        other, _ = self.connected("seller", "negotiation-other-seller")
        row = self.submitted()
        self.assertRaises(Http404, n.detail, other, row.pk)
        self.assertEqual(self.root_client.get(f"/admin/orders/negotiation/{row.pk}/change/").status_code, 200)
        path = f"/admin/orders/negotiation/{row.pk}/change/"
        self.assertIn(self.staff_client.get(path).status_code, [302, 403])
        self.group.permissions.add(
            Permission.objects.get(content_type__app_label="orders", codename="read_negotiations")
        )
        self.assertEqual(self.staff_client.get(path).status_code, 200)
        self.assertEqual(
            self.post(
                self.staff_client, f"orders/seller/negotiations/{row.pk}/finalize/", n.canonical(self.final(row))
            ).status_code,
            403,
        )
        self.group.permissions.clear()
        self.assertIn(self.staff_client.get(path).status_code, [302, 403])
        self.assertFalse(Membership.objects.filter(account=other.account, company=row.seller).exists())

    def test_lost_response_repeated_changed_payload_and_broker_outage(self):
        row = self.submitted()
        data = self.final(row)
        with (
            self.captureOnCommitCallbacks(execute=True),
            patch("apps.runtime.jobs.enqueue", side_effect=WakeFailure("Synthetic broker outage")),
        ):
            result = n.transition(self.seller, row.pk, "finalize", data)
        self.assertEqual(n.reconcile(self.seller, row.pk, data["command_id"]), result)
        changed = copy.deepcopy(data)
        changed["reason"] = "Different business payload"
        self.assertRaises(n.CommandConflict, n.transition, self.seller, row.pk, "finalize", changed)
        self.assertEqual(Invoice.objects.count(), 1)

    def test_current_product_withdrawal_terms_and_suspended_buyer_block_finalization(self):
        from apps.accounts.models import Account

        row = self.submitted()
        self.negotiable.refresh_from_db()
        catalogue.transition(
            self.reviewer,
            self.negotiable.pk,
            {
                "version": self.negotiable.version,
                "revision": self.negotiable.published_id,
                "action": "unpublish",
                "reason": "Synthetic publication withdrawal",
            },
        )
        self.assertRaises(
            __import__("apps.orders.services", fromlist=["SellerFailure"]).SellerFailure,
            n.transition,
            self.seller,
            row.pk,
            "finalize",
            self.final(row),
        )
        Account.objects.filter(pk=self.buyer.account.pk).update(status="suspended")
        from rest_framework.exceptions import PermissionDenied

        self.assertRaises(PermissionDenied, n.transition, self.seller, row.pk, "finalize", self.final(row))
        self.assertFalse(Invoice.objects.exists())

    def test_independent_sellers_outage_resume_and_exact_unchanged_cart_cleanup(self):
        from apps.cart import services as cart
        from apps.orders.models import NegotiationSubmission

        company = self.request_company()
        second = self.extra_variant(company)
        usd = self.extra_variant(company, "USD")
        packet = self.request_packet()
        self.add(variant=second, quantity="2.000")
        self.add(variant=usd)
        self.add(variant=self.fixed)
        rows = cart.buyer(self.buyer)
        packet["version"] = rows.version
        packet["lines"] += list(rows.lines.filter(variant=second).values_list("pk", flat=True))
        p = copy.deepcopy(self.proposal())
        p["lines"][0]["variant"] = str(second.pk)
        p["choice"]["seller"] = str(company.pk)
        packet["proposals"].append(p)
        original = n.create_seller

        def interrupted(actor, submission, pk):
            if submission.outcomes.get(pk=pk).seller_id == company.pk:
                raise OSError("Synthetic dependency failure")
            return original(actor, submission, pk)

        before = self.inventory_state()
        with patch("apps.orders.negotiations.create_seller", side_effect=interrupted):
            result = n.submit(self.buyer, packet)
        self.assertTrue(result["pending"])
        self.assertEqual(Negotiation.objects.count(), 1)
        self.assertFalse(rows.lines.filter(variant=self.variant).exists())
        self.assertTrue(rows.lines.filter(variant=second).exists())
        self.add(variant=second, quantity="5.000")
        result = n.resume(self.buyer, result["id"])
        self.assertFalse(result["pending"])
        self.assertEqual(Negotiation.objects.count(), 2)
        self.assertEqual(rows.lines.get(variant=second).quantity, Decimal("5.000"))
        self.assertTrue(rows.lines.filter(variant=self.fixed).exists())
        self.assertTrue(rows.lines.filter(variant=usd).exists())
        self.assertEqual(self.inventory_state(), before)
        self.assertEqual(NegotiationSubmission.objects.count(), 1)
        self.assertEqual(n.submit(self.buyer, packet), result)

    def test_company_negotiation_bundles_finance_scope_and_notice_revocation(self):
        from apps.organizations.models import Membership
        from django.http import Http404
        from apps.notifications import services as notices

        company = self.request_company()
        variant = self.extra_variant(company)
        packet = self.request_packet()
        self.add(variant=variant, quantity="2.000")
        from apps.cart.services import buyer

        cart = buyer(self.buyer)
        packet["version"] = cart.version
        packet["lines"] = list(cart.lines.filter(variant=variant).values_list("pk", flat=True))
        p = self.proposal()
        p["choice"]["seller"] = str(company.pk)
        p["lines"][0]["variant"] = str(variant.pk)
        packet["proposals"] = [p]
        operator, _ = self.connected("seller", "request-operator")
        finance, _ = self.connected("seller", "request-finance")
        cataloguer, _ = self.connected("seller", "request-cataloguer")
        member = Membership.objects.create(company=company, account=operator.account, bundles=["orders_negotiation"])
        Membership.objects.create(company=company, account=finance.account, bundles=["payments_refunds"])
        Membership.objects.create(company=company, account=cataloguer.account, bundles=["catalogue"])
        result = n.submit(self.buyer, packet)
        row = Negotiation.objects.get(pk=result["outcomes"][0]["request"])
        self.assertEqual(n.detail(operator, row.pk)["id"], str(row.pk))
        self.assertRaises(Http404, n.detail, finance, row.pk)
        self.assertRaises(Http404, n.detail, cataloguer, row.pk)
        self.assertEqual(notices.counts(operator)["unread_notices"], 1)
        member.active = False
        member.save()
        self.assertEqual(notices.counts(operator)["unread_notices"], 0)
        self.assertRaises(Http404, n.detail, operator, row.pk)
        self.assertEqual(Notice.objects.filter(account=finance.account, negotiation=row).count(), 0)

    def test_wholesale_evidence_minimum_and_aggregate_stock_for_negotiation(self):
        self.add(tier="wholesale", quantity="50.000")
        cart = __import__("apps.cart.services", fromlist=["buyer"]).buyer(self.buyer)
        p = self.proposal()
        p["lines"][0].update(tier="wholesale", quantity="50.000", max_quantity="60.000")
        packet = {
            "command_id": uuid.uuid4(),
            "version": cart.version,
            "currency": "AFN",
            "lines": list(cart.lines.values_list("pk", flat=True)),
            "proposals": [p],
        }
        result = n.submit(self.buyer, packet)
        self.assertEqual(result["outcomes"][0]["code"], "wholesale_verification")
        self.assertTrue(cart.lines.exists())
        # Establish approved current business evidence using the existing commerce fixture helper.
        from tests.test_commerce import CommerceBoundaryTests

        CommerceBoundaryTests.verified_buyer(self)
        p["lines"][0].update(quantity="0.500", max_quantity="60.000")
        packet["command_id"] = uuid.uuid4()
        result = n.submit(self.buyer, packet)
        self.assertEqual(result["outcomes"][0]["code"], "wholesale_minimum")
        p["lines"][0].update(quantity="50.000", max_quantity="60.000")
        p["lines"].append({**self.proposal()["lines"][0], "quantity": "60.000", "max_quantity": "60.000"})
        self.add(quantity="60.000")
        packet.update(
            command_id=uuid.uuid4(),
            version=__import__("apps.cart.services", fromlist=["buyer"]).buyer(self.buyer).version,
            lines=list(cart.lines.values_list("pk", flat=True)),
        )
        result = n.submit(self.buyer, packet)
        self.assertEqual(result["outcomes"][0]["code"], "stock_shortage")
        self.assertFalse(Invoice.objects.exists())

    def test_notice_fanout_is_bounded_and_durable_with_current_membership(self):
        from apps.accounts.models import User, Account
        from apps.organizations.models import Membership
        from apps.notifications.models import OrderNoticeCursor
        from apps.notifications.order_events import sweep_orders

        company = self.request_company()
        variant = self.extra_variant(company)
        self.add(variant=variant)
        cart = __import__("apps.cart.services", fromlist=["buyer"]).buyer(self.buyer)
        p = self.proposal()
        p["choice"]["seller"] = str(company.pk)
        p["lines"][0]["variant"] = str(variant.pk)
        for i in range(105):
            user = User.objects.create_user(f"neg-fanout-{i}@example.test", None, email_verified=True)
            account = Account.objects.create(user=user, context="seller")
            Membership.objects.create(company=company, account=account, bundles=["orders_negotiation"])
        result = n.submit(
            self.buyer,
            {
                "command_id": uuid.uuid4(),
                "version": cart.version,
                "currency": "AFN",
                "lines": list(cart.lines.values_list("pk", flat=True)),
                "proposals": [p],
            },
        )
        row = Negotiation.objects.get(pk=result["outcomes"][0]["request"])
        cursor = OrderNoticeCursor.objects.get(event__negotiation_event__request=row)
        self.assertFalse(cursor.complete)
        self.assertEqual(Notice.objects.filter(negotiation=row).count(), 100)
        sweep_orders()
        cursor.refresh_from_db()
        self.assertTrue(cursor.complete)
        self.assertEqual(Notice.objects.filter(negotiation=row).count(), 106)
        sweep_orders()
        self.assertEqual(Notice.objects.filter(negotiation=row).count(), 106)
        self.assertFalse(Outbox.objects.exists())

    def test_bounded_chronological_history_retains_all_revisions_through_pages(self):
        row = self.submitted()
        for i in range(11):
            n.transition(
                self.seller,
                row.pk,
                "request-correction",
                {"command_id": uuid.uuid4(), "version": row.version, "reason": "Synthetic correction history"},
            )
            row.refresh_from_db()
            n.transition(
                self.buyer,
                row.pk,
                "resubmit",
                {
                    "command_id": uuid.uuid4(),
                    "version": row.version,
                    "reason": "Synthetic buyer revision",
                    "proposal": self.proposal(),
                },
            )
            row.refresh_from_db()
        first = n.detail(self.buyer, row.pk)
        second = n.detail(self.buyer, row.pk, history_page=2)
        self.assertEqual(first["history_count"], 23)
        self.assertEqual(len([x for x in first["history"] if "version" in x]), 20)
        self.assertEqual([x["version"] for x in second["history"] if "version" in x], [21, 22, 23])
        self.assertEqual(first["proposal"], second["proposal"])
        self.assertTrue(all(x.get("actor") for x in first["history"]))
        self.assertEqual(n.page(self.buyer, {"page": 1, "q": "", "state": ""})["results"][0]["history"], [])

    def test_negotiated_wholesale_finalization_and_off_increment_cap(self):
        from tests.test_commerce import CommerceBoundaryTests

        CommerceBoundaryTests.verified_buyer(self)
        p = self.proposal()
        p["lines"][0]["max_quantity"] = "4.001"
        self.assertRaises(ValidationError, n.validate_proposal, self.buyer.account, self.profile, p, "AFN")
        packet = self.request_packet()
        packet["proposals"][0]["lines"][0]["tier"] = "wholesale"
        self.add(tier="wholesale", quantity="2.000")
        cart = __import__("apps.cart.services", fromlist=["buyer"]).buyer(self.buyer)
        packet.update(
            version=cart.version, lines=list(cart.lines.filter(tier="wholesale").values_list("pk", flat=True))
        )
        result = n.submit(self.buyer, packet)
        row = Negotiation.objects.get(pk=result["outcomes"][0]["request"])
        data = self.final(row)
        data["lines"][0].update(tier="wholesale", quantity="4.000", unit_price="15.00")
        n.transition(self.seller, row.pk, "finalize", data)
        self.assertEqual(OrderLine.objects.get().tier, "wholesale")
        self.assertEqual(SellerOrder.objects.get().goods_total, Decimal("60.00"))

    def test_migration_reversal_refuses_retained_negotiated_history(self):
        import importlib
        from django.db import connection

        self.submitted()
        for module in [
            "apps.orders.migrations.0004_negotiation_guards",
            "apps.notifications.migrations.0009_negotiation_resource_guard",
        ]:
            with self.assertRaises(DatabaseError), transaction.atomic(), connection.cursor() as cursor:
                cursor.execute(importlib.import_module(module).REVERSE)
        self.assertEqual(Negotiation.objects.count(), 1)

    def test_returned_requests_remain_withdrawable_or_rejectable_after_many_years(self):
        later = timezone.now() + timedelta(days=4000)
        for action, actor, terminal in [("withdraw", self.buyer, "withdrawn"), ("reject", self.seller, "rejected")]:
            row = self.submitted()
            n.transition(
                self.seller,
                row.pk,
                "request-correction",
                {
                    "command_id": uuid.uuid4(),
                    "version": row.version,
                    "reason": "Synthetic returned request retained indefinitely",
                },
            )
            row.refresh_from_db()
            with patch("apps.orders.services.timezone.now", return_value=later):
                self.assertEqual(n.detail(actor, row.pk)["state"], "correction_requested")
                result = n.transition(
                    actor,
                    row.pk,
                    action,
                    {
                        "command_id": uuid.uuid4(),
                        "version": row.version,
                        "reason": "Explicit terminal action after many years",
                    },
                )
            self.assertEqual(result["state"], terminal)
        self.assertFalse(Invoice.objects.exists())

    def test_seller_can_reject_inactive_counterparty_and_reconcile_the_same_result(self):
        from apps.accounts.models import Account

        row = self.submitted()
        Account.objects.filter(pk=self.buyer.account.pk).update(status="suspended")
        data = {
            "command_id": uuid.uuid4(),
            "version": row.version,
            "reason": "Explicit rejection of an inactive counterparty",
        }
        result = n.transition(self.seller, row.pk, "reject", data)
        self.assertEqual(result["state"], "rejected")
        self.assertEqual(n.settle_command(self.seller, row.pk, data["command_id"]), result)
        self.assertFalse(Invoice.objects.exists())

    def test_accepted_command_reconciliation_survives_later_counterparty_suspension(self):
        from apps.accounts.models import Account

        row = self.submitted()
        data = self.final(row)
        result = n.transition(self.seller, row.pk, "finalize", data)
        Account.objects.filter(pk=self.buyer.account.pk).update(status="suspended")
        self.assertEqual(n.settle_command(self.seller, row.pk, data["command_id"]), result)
        self.assertEqual(Invoice.objects.count(), 1)
