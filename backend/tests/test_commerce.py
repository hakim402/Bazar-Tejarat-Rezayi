"""Phase 10 disposable PostgreSQL acceptance: no real accounts/providers/runtime."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier, Event as ThreadEvent
from apps.catalogue.media import StorageUnavailable
from apps.accounts.services import AuthFailure
import uuid
from decimal import Decimal
from unittest.mock import patch
from django.test import TestCase, TransactionTestCase, override_settings
from django.db import transaction, DatabaseError, connections
from rest_framework.test import APIClient
from rest_framework.exceptions import PermissionDenied, ValidationError
from apps.cart import services as cart
from apps.cart.models import Cart, CartLine, MergeReceipt
from apps.orders import services as orders, queries, documents
from apps.orders.models import SellerOrder, Invoice, OrderLine, CheckoutSubmission, OrderPolicy, CheckoutOutcome
from apps.catalogue.models import Variant
from apps.inventory import services as stock
from apps.inventory.models import Position, Bucket, Movement, Operation, Allocation, Shortage, Recovery
from apps.notifications.models import Notice, Outbox
from tests.test_messaging import MessagingFixture


class CommerceFixture(MessagingFixture):
    def setUp(self):
        super().setUp()
        OrderPolicy.objects.get_or_create(pk=1)
        self.variant = Variant.objects.get(product=self.product)
        self.request = self.buyer.request
        self.request.COOKIES = {}
        orders.set_terms(
            self.seller,
            self.profile.pk,
            {
                "version": 0,
                "enabled": True,
                "destinations": [{"country": "AF", "all_cities": True, "cities": []}],
                "methods": ["advance", "cod"],
                "reason": "Synthetic approved terms",
            },
        )
        self.seed_stock(self.variant)

    def seed_stock(self, variant, amount="100.000"):
        position = Position.objects.filter(pk=variant.pk).first()
        if not position:
            stock.configure(
                self.seller,
                variant.product.seller_id,
                variant.pk,
                {
                    "token": str(uuid.uuid4()),
                    "reason": "Synthetic stock",
                    "version": 0,
                    "tracking": "plain",
                    "expiry_required": False,
                    "threshold": "1.000",
                },
            )
        position = Position.objects.get(pk=variant.pk)
        stock.manual(
            self.seller,
            variant.product.seller_id,
            variant.pk,
            {
                "token": str(uuid.uuid4()),
                "reason": "Synthetic received stock",
                "version": position.version,
                "quantity": amount,
            },
        )

    def add(self, variant=None, tier="retail", quantity="1.000", actor=None):
        actor = actor or self.buyer
        row = cart.buyer(actor)
        return cart.mutate(
            actor.request,
            actor,
            {
                "command_id": uuid.uuid4(),
                "version": row.version if row else 0,
                "action": "set",
                "variant": (variant or self.variant).pk,
                "tier": tier,
                "quantity": quantity,
            },
        )

    def packet(self, method="advance"):
        row = cart.buyer(self.buyer)
        lines = list(row.lines.select_related("variant__product"))
        return {
            "command_id": uuid.uuid4(),
            "version": row.version,
            "currency": "AFN",
            "lines": [x.pk for x in lines],
            "choices": [
                {"seller": pk, "country": "AF", "city": "Kabul", "method": method}
                for pk in sorted({x.variant.product.seller_id for x in lines})
            ],
            "shown_prices": [],
            "locale": "en",
        }

    def inventory_state(self):
        return {
            m._meta.label: list(m.objects.order_by("pk").values())
            for m in [Position, Bucket, Movement, Operation, Allocation, Shortage, Recovery]
        }


@override_settings(OWNER_MFA_REQUIRED=False)
class CommerceTests(CommerceFixture, TestCase):
    def test_accept_replay_current_price_snapshot_and_no_inventory_write(self):
        self.add()
        data = self.packet()
        before = self.inventory_state()
        first = orders.submit(self.buyer, data)
        self.assertEqual(first["outcomes"][0]["state"], "accepted")
        self.assertEqual(orders.submit(self.buyer, data), first)
        self.assertEqual(self.inventory_state(), before)
        self.assertEqual((SellerOrder.objects.count(), Invoice.objects.count(), OrderLine.objects.count()), (1, 1, 1))
        item = SellerOrder.objects.get()
        self.assertEqual(item.goods_total, Decimal("12.50"))
        self.assertEqual((item.due_at - item.accepted_at).total_seconds(), 72 * 3600)
        self.assertEqual(Notice.objects.filter(order=item).count(), 2)
        self.assertEqual(Outbox.objects.count(), 0)
        self.assertNotIn("NEVER", str(item.snapshot))
        self.assertNotIn("PRIVATE", str(item.snapshot))
        self.assertFalse(cart.buyer(self.buyer).lines.exists())

    def test_cod_and_protected_cross_account_invoice(self):
        self.add()
        orders.submit(self.buyer, self.packet("cod"))
        item = Invoice.objects.get()
        self.assertIsNone(item.order.due_at)
        self.assertEqual(queries.document(self.buyer, item.pk).pk, item.pk)
        self.assertEqual(queries.document(self.seller, item.pk).pk, item.pk)
        from django.http import Http404

        with self.assertRaises(Http404):
            queries.document(self.other_buyer, item.pk)
        response = self.buyer_client.get(f"/api/v1/orders/buyer/invoices/{item.pk}/?locale=en")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self.other_client.get(f"/api/v1/orders/buyer/invoices/{item.pk}/").status_code, 404)

    def test_wholesale_rejected_without_fallback_and_cart_preserved(self):
        self.add(tier="wholesale")
        result = orders.submit(self.buyer, self.packet())
        self.assertEqual(result["outcomes"][0]["code"], "wholesale_verification")
        self.assertFalse(Invoice.objects.exists())
        self.assertEqual(cart.buyer(self.buyer).lines.count(), 1)

    def test_stock_aggregation_unknown_shortage_and_unpaid_repeat(self):
        self.add(quantity="101.000")
        result = orders.submit(self.buyer, self.packet())
        self.assertEqual(result["outcomes"][0]["code"], "stock_shortage")
        self.add(quantity="100.000")
        orders.submit(self.buyer, self.packet())
        self.add(quantity="100.000")
        orders.submit(self.buyer, self.packet())
        self.assertEqual(SellerOrder.objects.count(), 2)
        self.assertEqual(Bucket.objects.get().held, 0)

    def test_seller_atomic_outage_pending_resume_no_duplicate(self):
        self.add()
        data = self.packet()
        with patch("apps.notifications.order_events.order_committed", side_effect=OSError("synthetic outage")):
            result = orders.submit(self.buyer, data)
        self.assertTrue(result["pending"])
        self.assertFalse(SellerOrder.objects.exists())
        self.assertEqual(cart.buyer(self.buyer).lines.count(), 1)
        result = orders.submit(self.buyer, data)
        self.assertFalse(result["pending"])
        self.assertEqual(Invoice.objects.count(), 1)
        self.assertEqual(
            self.post(self.buyer_client, f"orders/buyer/checkouts/{result['id']}/resume/", {}).status_code, 200
        )

    def test_retained_agreements_reject_raw_database_rewrite(self):
        self.add()
        orders.submit(self.buyer, self.packet())
        for model, changes in [
            (SellerOrder, {"goods_total": Decimal("1.00")}),
            (OrderLine, {"quantity": Decimal("9.000")}),
            (Invoice, {"number": "FORGED"}),
            (CheckoutSubmission, {"digest": "bad"}),
            (CheckoutOutcome, {"state": "failed", "version": 2}),
        ]:
            with self.subTest(model=model.__name__), self.assertRaises(DatabaseError), transaction.atomic():
                model.objects.update(**changes)

    def test_guest_cookie_csrf_single_merge_and_seller_context(self):
        client = APIClient(enforce_csrf_checks=True)
        result = client.get("/api/v1/cart/guest/?locale=en")
        self.assertEqual(result.status_code, 200, result.content)
        self.assertNotIn(cart.SESSION_KEY, result.cookies)
        result = self.post(client, "cart/guest/initialize/", {})
        self.assertEqual(result.status_code, 200)
        self.assertIn(cart.SESSION_KEY, result.cookies)
        scope = client.get("/api/v1/cart/guest/").json()["guest_scope"]
        data = {
            "guest_scope": scope,
            "command_id": str(uuid.uuid4()),
            "version": 0,
            "action": "set",
            "variant": str(self.variant.pk),
            "tier": "retail",
            "quantity": "1.000",
        }
        self.assertEqual(client.post("/api/v1/cart/guest/", data, format="json").status_code, 403)
        self.assertEqual(self.post(client, "cart/guest/", data).status_code, 200)
        self.buyer.request.COOKIES = {cart.SESSION_KEY: client.cookies[cart.SESSION_KEY].value}
        data = {"command_id": uuid.uuid4(), "version": 0, "guest_version": 1}
        first = cart.merge(self.buyer.request, self.buyer, data)
        self.assertEqual(cart.merge(self.buyer.request, self.buyer, data), first)
        self.assertEqual(MergeReceipt.objects.count(), 1)
        self.assertEqual(cart.buyer(self.buyer).lines.get().quantity, 1)
        self.assertEqual(self.seller_client.get("/api/v1/cart/guest/").status_code, 200)
        self.assertEqual(self.buyer_client.get("/api/v1/cart/guest/").status_code, 403)

    def test_invalid_cart_payload_and_quantity_preserves_version(self):
        self.buyer_client.get("/api/v1/cart/buyer/")
        base = {
            "command_id": str(uuid.uuid4()),
            "version": 0,
            "action": "set",
            "variant": str(self.variant.pk),
            "tier": "retail",
            "quantity": "1.000",
        }
        for values in [
            {"quantity": "NaN"},
            {"quantity": "0.124"},
            {"quantity": "0"},
            {"cart": "forged"},
            {"tier": "other"},
        ]:
            response = self.post(self.buyer_client, "cart/buyer/", {**base, **values})
            self.assertEqual(response.status_code, 400, response.content)
        self.assertFalse(CartLine.objects.exists())

    def test_all_locales_actual_protected_pdf_escaping_and_dependency_outage(self):
        self.add()
        orders.submit(self.buyer, self.packet())
        invoice = Invoice.objects.get()
        for locale in ["fa-AF", "ps", "ar", "en"]:
            body = documents.pdf_bytes(invoice, locale)
            self.assertTrue(body.startswith(b"%PDF-"))
            self.assertGreater(len(body), 10000)
            html = documents.html_document(invoice, locale)
            self.assertIn('dir="' + ("ltr" if locale == "en" else "rtl") + '"', html)
        with patch("apps.orders.documents.ASSETS", __import__("pathlib").Path("/nonexistent")):
            response = self.buyer_client.get(f"/api/v1/orders/buyer/invoices/{invoice.pk}/pdf/?locale=en")
        self.assertEqual(response.status_code, 503, response.content)
        self.assertEqual(Invoice.objects.count(), 1)

    def test_query_and_unknown_identifier_fail_closed(self):
        for suffix in ["?page=0", "?page=1&page=2", "?search=secret"]:
            self.assertEqual(self.buyer_client.get("/api/v1/orders/buyer/orders/" + suffix).status_code, 400)
        self.assertEqual(
            self.buyer_client.get("/api/v1/orders/buyer/orders/" + str(uuid.uuid4()) + "/").status_code, 404
        )


@override_settings(OWNER_MFA_REQUIRED=False)
class CommerceBoundaryTests(CommerceFixture, TestCase):
    def verified_buyer(self):
        from apps.organizations.models import BusinessProfile
        from apps.verification.models import ReviewCase

        profile = BusinessProfile.objects.create(
            account=self.buyer.account, kind="business", display_name="Synthetic business buyer"
        )
        ReviewCase.objects.create(profile=profile, status="approved", snapshot={"display_name": "Reviewed buyer"})
        return profile

    def test_current_price_no_reconfirmation_frozen_after_catalogue_change(self):
        self.add()
        data = self.packet()
        line = CartLine.objects.get()
        data["shown_prices"] = [{"line": line.pk, "price": "12.50"}]
        Variant.objects.filter(pk=self.variant.pk).update(retail=Decimal("13.01"))
        result = orders.submit(self.buyer, data)
        self.assertFalse(result["pending"])
        frozen = OrderLine.objects.get()
        self.assertTrue(frozen.snapshot["price_changed"])
        self.assertEqual(frozen.goods_amount, Decimal("13.01"))
        Variant.objects.filter(pk=self.variant.pk).update(retail=Decimal("15.00"))
        self.assertEqual(orders.submit(self.buyer, data), result)
        frozen.refresh_from_db()
        self.assertEqual(frozen.unit_price, Decimal("13.01"))

    def test_rounding_and_zero_rounded_amount(self):
        from apps.orders.validation import money

        self.assertEqual(money(Decimal(".04"), Decimal(".125")), Decimal(".01"))
        with self.assertRaises(ValidationError):
            money(Decimal(".01"), Decimal(".125"))
        self.add(quantity="0.125")
        result = orders.submit(self.buyer, self.packet())
        self.assertFalse(result["pending"])
        self.assertEqual(SellerOrder.objects.get().goods_total, Decimal("1.56"))

    def test_verified_wholesale_minimum_not_pooled_with_retail(self):
        self.verified_buyer()
        self.add(tier="retail", quantity="1.000")
        self.add(tier="wholesale", quantity="0.500")
        result = orders.submit(self.buyer, self.packet())
        self.assertEqual(result["outcomes"][0]["code"], "wholesale_minimum")
        self.assertEqual(CartLine.objects.count(), 2)
        self.assertFalse(Invoice.objects.exists())
        self.add(tier="wholesale", quantity="1.000")
        orders.submit(self.buyer, self.packet())
        self.assertEqual(OrderLine.objects.count(), 2)

    def test_business_evidence_outage_pending_missing_evidence_terminal(self):
        from apps.verification.models import ReviewCase, Evidence

        bp = self.verified_buyer()
        case = ReviewCase.objects.get(profile=bp)
        Evidence.objects.create(
            case=case,
            category="business",
            storage_alias="private_local",
            key="synthetic-missing",
            content_type="image/jpeg",
            size=1,
            sha256="0" * 64,
        )
        self.add(tier="wholesale")
        with patch("apps.orders.access.storages") as storage:
            storage.__getitem__.return_value.exists.side_effect = OSError("synthetic storage")
            result = orders.submit(self.buyer, self.packet())
        self.assertTrue(result["pending"])
        self.assertEqual(result["outcomes"][0]["code"], "dependency_unavailable")
        result = orders.submit(
            self.buyer, {**CheckoutSubmission.objects.get().payload, "command_id": CheckoutSubmission.objects.get().key}
        )
        self.assertEqual(result["outcomes"][0]["code"], "wholesale_verification")

    def test_combined_tier_stock_aggregate_and_inventory_snapshot(self):
        self.verified_buyer()
        self.add(quantity="60.000")
        self.add(tier="wholesale", quantity="50.000")
        before = self.inventory_state()
        result = orders.submit(self.buyer, self.packet())
        self.assertEqual(result["outcomes"][0]["code"], "stock_shortage")
        self.assertEqual(self.inventory_state(), before)

    def test_terms_disabled_destination_method_version_and_owner_guard(self):
        from apps.orders.models import SellerCheckoutTerms

        current = orders.terms(self.profile)
        with self.assertRaises(PermissionDenied):
            orders.set_terms(self.other_buyer, self.profile.pk, {**current, "reason": "forged"})
        change = {k: current[k] for k in ["version", "enabled", "destinations", "methods"]}
        change.update(
            methods=["cod"],
            destinations=[{"country": "AF", "all_cities": False, "cities": [" Kabul "]}],
            reason="Restrict synthetic destination",
        )
        result = orders.set_terms(self.seller, self.profile.pk, change)
        self.assertEqual(result["destinations"][0]["cities"], ["kabul"])
        with self.assertRaises(orders.CommandConflict):
            orders.set_terms(self.seller, self.profile.pk, change)
        self.add()
        result = orders.submit(self.buyer, self.packet())
        self.assertEqual(result["outcomes"][0]["code"], "method_unavailable")
        data = self.packet("cod")
        data["choices"][0]["city"] = "Herat"
        result = orders.submit(self.buyer, data)
        self.assertEqual(result["outcomes"][0]["code"], "destination_unavailable")
        terms = SellerCheckoutTerms.objects.get()
        orders.set_terms(self.seller, self.profile.pk, {**change, "version": terms.version, "enabled": False})
        self.assertFalse(orders.terms(self.profile)["enabled"])

    def test_guest_expiry_no_get_growth_and_no_account_cleanup(self):
        from django.utils import timezone
        from datetime import timedelta

        client = APIClient(enforce_csrf_checks=True)
        for _ in range(3):
            self.assertEqual(client.get("/api/v1/cart/guest/").status_code, 200)
        self.assertFalse(Cart.objects.exists())
        expired = Cart.objects.create(guest_key=uuid.uuid4(), expires_at=timezone.now() - timedelta(days=1))
        active = Cart.objects.create(guest_key=uuid.uuid4(), expires_at=timezone.now() + timedelta(days=1))
        self.add()
        cart.expire_guests()
        self.assertFalse(Cart.objects.filter(pk=expired.pk).exists())
        self.assertTrue(Cart.objects.filter(pk=active.pk).exists())
        self.assertTrue(Cart.objects.filter(account=self.buyer.account).exists())

    def test_guest_merged_identity_cannot_move_to_another_buyer(self):
        from django.utils import timezone
        from datetime import timedelta

        key = uuid.uuid4()
        guest = Cart.objects.create(guest_key=key, expires_at=timezone.now() + timedelta(days=1))
        CartLine.objects.create(cart=guest, variant=self.variant, tier="retail", quantity=1)
        self.buyer.request.COOKIES = {cart.SESSION_KEY: str(key)}
        self.other_buyer.request.COOKIES = {cart.SESSION_KEY: str(key)}
        cart.merge(self.buyer.request, self.buyer, {"command_id": uuid.uuid4(), "version": 0, "guest_version": 0})
        with self.assertRaises(orders.CommandConflict):
            cart.merge(
                self.other_buyer.request,
                self.other_buyer,
                {"command_id": uuid.uuid4(), "version": 0, "guest_version": 0},
            )
        self.assertFalse(CartLine.objects.filter(cart__account=self.other_buyer.account).exists())

    def test_unknown_future_routes_and_mutations_are_not_executable(self):
        self.add()
        orders.submit(self.buyer, self.packet())
        order = SellerOrder.objects.get()
        for action in ["pay", "dispatch", "cancel", "refund", "amend", "complete", "negotiate"]:
            self.assertEqual(
                self.post(self.buyer_client, f"orders/buyer/orders/{order.pk}/{action}/", {}).status_code, 404
            )
        self.assertEqual(
            self.post(
                self.buyer_client, f"orders/buyer/orders/{order.pk}/", {"status": "paid"}, method="patch"
            ).status_code,
            405,
        )
        self.assertEqual(self.root_client.get("/api/v1/orders/staff/orders/").status_code, 404)

    def test_audit_failure_prevents_invoice_render_and_cross_account_storage(self):
        self.add()
        orders.submit(self.buyer, self.packet())
        invoice = Invoice.objects.get()
        with (
            patch("apps.orders.queries.AuditEvent.objects.create", side_effect=DatabaseError("synthetic audit")),
            patch("apps.orders.documents.pdf_bytes") as render,
        ):
            with self.assertRaises(DatabaseError):
                queries.document(self.buyer, invoice.pk)
            render.assert_not_called()
        with patch("apps.orders.documents.pdf_bytes") as render:
            self.assertEqual(self.other_client.get(f"/api/v1/orders/buyer/invoices/{invoice.pk}/pdf/").status_code, 404)
            render.assert_not_called()

    def test_order_notice_read_and_message_counter_are_independent(self):
        from apps.notifications import services as notices

        self.add()
        data = self.packet()
        orders.submit(self.buyer, data)
        orders.submit(self.buyer, data)
        self.assertEqual(notices.counts(self.buyer), {"unread_threads": 0, "unread_notices": 1})
        n = notices.notices(self.buyer)["results"][0]
        self.assertIsNone(n["conversation"])
        self.assertIsNotNone(n["invoice"])
        notices.read_notice(self.buyer, n["id"])
        self.assertEqual(notices.counts(self.buyer)["unread_notices"], 0)
        self.room()
        self.assertEqual(notices.counts(self.seller)["unread_threads"], 1)

    def test_company_capability_matrix_native_permissions_and_revocation(self):
        from apps.organizations.models import Membership
        from apps.orders import access
        from django.contrib.auth.models import Permission
        from django.http import Http404

        company = self.company("orders-company")
        self.profile = company
        self.variant = Variant.objects.get(product=self.product)
        self.seed_stock(self.variant)
        orders.set_terms(
            self.seller,
            company.pk,
            {
                "version": 0,
                "enabled": True,
                "destinations": [{"country": "AF", "all_cities": True, "cities": []}],
                "methods": ["cod"],
                "reason": "Company synthetic terms",
            },
        )
        self.add()
        orders.submit(self.buyer, self.packet("cod"))
        invoice = Invoice.objects.get()
        for bundle, allow_orders, allow_invoice in [
            ("orders_negotiation", True, True),
            ("payments_refunds", False, True),
            ("catalogue", False, False),
            ("fulfilment", False, False),
            ("messaging", False, False),
        ]:
            member, _client = self.connected("seller", "bundle-" + bundle)
            membership = Membership.objects.create(company=company, account=member.account, bundles=[bundle])
            self.assertEqual(access.scope(member).exists(), allow_orders)
            self.assertEqual(access.scope(member, invoices=True).exists(), allow_invoice)
            if allow_invoice:
                queries.document(member, invoice.pk)
            else:
                with self.assertRaises(Http404):
                    queries.document(member, invoice.pk)
            with self.assertRaises(PermissionDenied):
                orders.set_terms(
                    member,
                    company.pk,
                    {"version": 1, "enabled": False, "methods": [], "destinations": [], "reason": "denied"},
                )
            membership.active = False
            membership.save()
            self.assertFalse(access.scope(member, invoices=True).exists())
        self.group.permissions.add(Permission.objects.get(content_type__app_label="orders", codename="read_invoices"))
        self.assertEqual(self.staff_client.get("/admin/orders/invoice/").status_code, 200)
        self.assertEqual(self.staff_client.get("/admin/orders/sellerorder/").status_code, 403)
        self.assertEqual(self.staff_client.get(f"/admin/orders/invoice/{invoice.pk}/document/").status_code, 200)
        self.group.permissions.clear()
        self.assertEqual(self.staff_client.get(f"/admin/orders/invoice/{invoice.pk}/pdf/").status_code, 403)

    def test_policy_native_root_only_versioned_and_old_due_unchanged(self):
        self.add()
        orders.submit(self.buyer, self.packet())
        old = SellerOrder.objects.get().due_at
        with self.assertRaises(PermissionDenied):
            orders.set_policy(self.staff, 1, 48, "forbidden")
        orders.set_policy(self.root, 1, 48, "Synthetic owner policy")
        self.add()
        orders.submit(self.buyer, self.packet())
        self.assertEqual(SellerOrder.objects.order_by("accepted_at").first().due_at, old)
        newest = SellerOrder.objects.order_by("-accepted_at").first()
        self.assertEqual((newest.due_at - newest.accepted_at).total_seconds(), 48 * 3600)

    def test_scoped_evidence_bounded_queries_and_line_limit(self):
        from django.test.utils import CaptureQueriesContext
        from django.db import connection
        from apps.verification.models import Evidence, ReviewCase
        from apps.organizations.models import BusinessProfile

        other = BusinessProfile.objects.create(account=self.seller.account, kind="company", display_name="Unrelated")
        case = ReviewCase.objects.create(profile=other, status="approved", snapshot={})
        Evidence.objects.create(
            case=case,
            category="identity",
            storage_alias="private_local",
            key="UNRELATED",
            content_type="image/jpeg",
            size=1,
            sha256="0" * 64,
        )
        self.add()
        with patch("apps.marketplace.access.storages") as storage, CaptureQueriesContext(connection) as query:
            result = cart.projection(cart.buyer(self.buyer), "en")
        storage.__getitem__.assert_not_called()
        self.assertEqual(len(result["lines"]), 1)
        self.assertLess(len(query), 15)

    def test_bounded_durable_order_notice_fanout_and_revoked_recipient(self):
        from apps.accounts.models import User, Account
        from apps.organizations.models import Membership
        from apps.notifications.models import OrderNoticeCursor
        from apps.notifications.order_events import sweep_orders

        company = self.company("large-notice-company")
        self.variant = Variant.objects.get(product=self.product)
        self.seed_stock(self.variant)
        orders.set_terms(
            self.seller,
            company.pk,
            {
                "version": 0,
                "enabled": True,
                "destinations": [{"country": "AF", "all_cities": True, "cities": []}],
                "methods": ["cod"],
                "reason": "Synthetic bulk recipients",
            },
        )
        for i in range(104):
            user = User.objects.create_user(
                f"fanout-{i}@example.test", "synthetic", display_name="Synthetic recipient", email_verified=True
            )
            account = Account.objects.create(user=user, context="seller")
            Membership.objects.create(company=company, account=account, bundles=["orders_negotiation"])
        self.add()
        orders.submit(self.buyer, self.packet("cod"))
        cursor = OrderNoticeCursor.objects.get()
        self.assertFalse(cursor.complete)
        self.assertEqual(Notice.objects.filter(order__isnull=False).count(), 101)
        revoked = Membership.objects.filter(
            company=company, account_id__gt=cursor.after_account, is_owner=False
        ).first()
        self.assertIsNotNone(revoked)
        revoked.active = False
        revoked.save()
        sweep_orders()
        cursor.refresh_from_db()
        self.assertTrue(cursor.complete)
        self.assertFalse(Notice.objects.filter(account=revoked.account).exists())
        before = Notice.objects.count()
        sweep_orders()
        self.assertEqual(Notice.objects.count(), before)

    def test_resume_and_command_lookup_are_exact_buyer_scope(self):
        self.add()
        data = self.packet()
        result = orders.submit(self.buyer, data)
        path = f"/api/v1/orders/buyer/checkouts/by-command/{data['command_id']}/"
        self.assertEqual(self.buyer_client.get(path).json()["id"], result["id"])
        self.assertEqual(self.other_client.get(path).status_code, 404)
        self.assertEqual(
            self.post(self.other_client, f"orders/buyer/checkouts/{result['id']}/resume/", {}).status_code, 404
        )
        self.assertEqual(
            self.post(
                self.buyer_client, f"orders/buyer/checkouts/{result['id']}/resume/", {"currency": "USD"}
            ).status_code,
            400,
        )

    def test_merge_overflow_and_line_cap_preserve_both_cart_versions(self):
        from datetime import timedelta
        from django.utils import timezone

        self.add(quantity="999999999.875")
        guest = Cart.objects.create(guest_key=uuid.uuid4(), expires_at=timezone.now() + timedelta(days=1))
        CartLine.objects.create(cart=guest, variant=self.variant, tier="retail", quantity="1.000")
        self.buyer.request.COOKIES = {cart.SESSION_KEY: str(guest.guest_key)}
        data = {"command_id": uuid.uuid4(), "version": 1, "guest_version": 0}
        with self.assertRaises(ValidationError):
            cart.merge(self.buyer.request, self.buyer, data)
        self.assertEqual(cart.buyer(self.buyer).version, 1)
        guest.refresh_from_db()
        self.assertIsNone(guest.consumed_by_id)
        self.assertEqual(guest.version, 0)
        target = cart.buyer(self.buyer)
        CartLine.objects.filter(cart=target).delete()
        variants = [
            Variant(
                product=self.product,
                sku=f"RETIRED-{i}",
                definition={"pack_size": str(i)},
                unit=self.variant.unit,
                quantity_increment="0.125",
                minimum_wholesale="1.000",
                retail="12.50",
                wholesale="10.00",
            )
            for i in range(100)
        ]
        Variant.objects.bulk_create(variants)
        CartLine.objects.bulk_create(
            [CartLine(cart=target, variant=v, tier="retail", quantity="1.000") for v in variants]
        )
        with self.assertRaises(ValidationError):
            cart.merge(self.buyer.request, self.buyer, data)
        self.assertEqual(CartLine.objects.filter(cart=target).count(), 100)
        self.assertEqual(cart.buyer(self.buyer).version, 1)

    def test_batch_stock_expiry_through_kabul_midnight_and_no_writes(self):
        from datetime import datetime, timezone
        from apps.inventory.acceptance import available

        variant = Variant.objects.create(
            product=self.product,
            sku="HISTORICAL-BATCH",
            definition={"pack_size": "batch"},
            unit=self.variant.unit,
            quantity_increment="0.125",
            minimum_wholesale="1.000",
            retail="12.50",
            wholesale="10.00",
        )
        stock.configure(
            self.seller,
            self.profile.pk,
            variant.pk,
            {
                "token": str(uuid.uuid4()),
                "reason": "Synthetic batch policy",
                "version": 0,
                "tracking": "batch",
                "expiry_required": True,
                "threshold": "1.000",
            },
        )
        stock.manual(
            self.seller,
            self.profile.pk,
            variant.pk,
            {
                "token": str(uuid.uuid4()),
                "reason": "Synthetic expiring stock",
                "version": Position.objects.get(pk=variant.pk).version,
                "quantity": "5.000",
                "batch_code": "EXP-TEST",
                "expires_on": "2026-10-29",
            },
            now=datetime(2026, 10, 29, 0, 0, tzinfo=timezone.utc),
        )
        before = self.inventory_state()
        self.assertEqual(
            available({variant.pk: Decimal("5.000")}, now=datetime(2026, 10, 29, 19, 29, 59, tzinfo=timezone.utc)), ""
        )
        self.assertEqual(
            available({variant.pk: Decimal("0.125")}, now=datetime(2026, 10, 29, 19, 30, tzinfo=timezone.utc)),
            "stock_shortage",
        )
        self.assertEqual(self.inventory_state(), before)

    def test_cart_rate_limits_are_scoped_to_buyer_or_guest_not_global_anonymous(self):
        for _ in range(100):
            self.assertEqual(self.buyer_client.get("/api/v1/cart/buyer/").status_code, 200)
        self.assertEqual(self.buyer_client.get("/api/v1/cart/buyer/").status_code, 429)
        self.assertEqual(self.other_client.get("/api/v1/cart/buyer/").status_code, 200)
        for _ in range(100):
            response = APIClient().get("/api/v1/cart/guest/", REMOTE_ADDR="192.0.2.10")
            self.assertEqual(response.status_code, 200)
        self.assertEqual(APIClient().get("/api/v1/cart/guest/", REMOTE_ADDR="192.0.2.10").status_code, 429)
        self.assertEqual(APIClient().get("/api/v1/cart/guest/", REMOTE_ADDR="192.0.2.20").status_code, 200)
        self.assertFalse(Cart.objects.exists())

    def test_document_accept_headers_reach_authorized_renderer_and_keep_errors_json(self):
        self.add()
        orders.submit(self.buyer, self.packet())
        invoice = Invoice.objects.get()
        for suffix, accept, expected in [
            ("pdf/", "application/pdf", b"%PDF-"),
            ("print/", "text/html", b"<!doctype html>"),
        ]:
            path = f"/api/v1/orders/buyer/invoices/{invoice.pk}/{suffix}?locale=en"
            response = self.buyer_client.get(path, HTTP_ACCEPT=accept)
            self.assertEqual(response.status_code, 200, response.content[:120])
            self.assertTrue(response.content.startswith(expected))
            self.assertIn("no-store", response["Cache-Control"])
            denied = self.other_client.get(path, HTTP_ACCEPT=accept)
            self.assertEqual(denied.status_code, 404)
            self.assertTrue(denied["Content-Type"].startswith("application/json"))
            self.assertEqual(self.buyer_client.head(path, HTTP_ACCEPT=accept).status_code, 200)

    def test_private_and_inactive_variant_rejected_before_evidence_storage(self):
        from apps.catalogue.models import Product

        private = Product.objects.create(seller=self.profile, currency="AFN", pricing_mode="fixed")
        for product, sku in [(private, "PRIVATE-ONLY"), (self.product, "UNPUBLISHED-VARIANT")]:
            variant = Variant.objects.create(
                product=product,
                sku=sku,
                definition={"pack_size": sku},
                unit=self.variant.unit,
                quantity_increment="0.125",
                minimum_wholesale="1.000",
                retail="12.50",
                wholesale="10.00",
            )
            with patch("apps.marketplace.access.storages") as storage:
                storage.__getitem__.side_effect = OSError("Unrelated evidence must not be opened")
                response = self.post(
                    self.buyer_client,
                    "cart/buyer/",
                    {
                        "command_id": str(uuid.uuid4()),
                        "version": 0,
                        "action": "set",
                        "variant": str(variant.pk),
                        "tier": "retail",
                        "quantity": "1.000",
                    },
                )
            self.assertEqual(response.status_code, 404, response.content)
            storage.__getitem__.assert_not_called()
        self.assertFalse(CartLine.objects.exists())


@override_settings(OWNER_MFA_REQUIRED=False)
class CommerceConcurrencyTests(CommerceFixture, TransactionTestCase):
    reset_sequences = False

    def worker(self, actor, data, barrier=None):
        from tests.test_messaging import request_actor

        try:
            if barrier:
                barrier.wait(timeout=10)
            fresh = request_actor(
                self.buyer_client if actor.account.pk == self.buyer.account.pk else self.other_client,
                "buyer",
                actor.user,
            )
            return orders.submit(fresh, data)
        finally:
            connections.close_all()

    def test_concurrent_duplicate_command_and_number_allocation(self):
        self.add()
        data = self.packet()
        barrier = Barrier(2)
        before = self.inventory_state()
        with ThreadPoolExecutor(2) as pool:
            first = pool.submit(self.worker, self.buyer, data, barrier)
            second = pool.submit(self.worker, self.buyer, data, barrier)
            self.assertEqual(first.result(timeout=20), second.result(timeout=20))
        self.assertEqual(
            (Invoice.objects.count(), SellerOrder.objects.count(), CheckoutSubmission.objects.count()), (1, 1, 1)
        )
        self.assertEqual(self.inventory_state(), before)

    def test_concurrent_different_buyers_unique_invoices_without_holds(self):
        self.add()
        first = self.packet()
        self.add(actor=self.other_buyer)
        row = cart.buyer(self.other_buyer)
        second = {
            **first,
            "command_id": uuid.uuid4(),
            "version": row.version,
            "lines": list(row.lines.values_list("pk", flat=True)),
        }
        barrier = Barrier(2)
        with ThreadPoolExecutor(2) as pool:
            a = pool.submit(self.worker, self.buyer, first, barrier)
            b = pool.submit(self.worker, self.other_buyer, second, barrier)
            a.result(timeout=20)
            b.result(timeout=20)
        self.assertEqual(Invoice.objects.values("number").distinct().count(), 2)
        self.assertEqual(Bucket.objects.get().held, 0)

    def test_concurrent_guest_merge_contributes_once(self):
        from datetime import timedelta
        from django.utils import timezone

        guest = Cart.objects.create(guest_key=uuid.uuid4(), expires_at=timezone.now() + timedelta(days=1))
        CartLine.objects.create(cart=guest, variant=self.variant, tier="retail", quantity=1)
        self.buyer.request.COOKIES = {cart.SESSION_KEY: str(guest.guest_key)}
        barrier = Barrier(2)
        data = {"command_id": uuid.uuid4(), "version": 0, "guest_version": 0}

        def merge():
            try:
                barrier.wait(timeout=10)
                return cart.merge(self.buyer.request, self.buyer, data)
            finally:
                connections.close_all()

        with ThreadPoolExecutor(2) as pool:
            a = pool.submit(merge)
            b = pool.submit(merge)
            self.assertEqual(a.result(timeout=20), b.result(timeout=20))
        self.assertEqual(CartLine.objects.get(cart__account=self.buyer.account).quantity, 1)
        self.assertEqual(MergeReceipt.objects.count(), 1)

    def race_seller(self, change):
        from apps.organizations.models import BusinessProfile

        self.add(quantity="2.000")
        data = self.packet()
        entered, proceed = ThreadEvent(), ThreadEvent()
        original = orders.accept_seller

        def waiting(*args, **kwargs):
            entered.set()
            if not proceed.wait(10):
                raise RuntimeError("Synthetic barrier timed out")
            return original(*args, **kwargs)

        with ThreadPoolExecutor(1) as pool, patch("apps.orders.services.accept_seller", side_effect=waiting):
            future = pool.submit(self.worker, self.buyer, data)
            try:
                self.assertTrue(entered.wait(10))
                with transaction.atomic():
                    BusinessProfile.objects.select_for_update().get(pk=self.profile.pk)
                    proceed.set()
                    change()
                return future.result(timeout=20)
            finally:
                proceed.set()

    def test_terms_change_after_lock_wait_is_rechecked(self):
        def change():
            value = orders.terms(self.profile)
            orders.set_terms(
                self.seller,
                self.profile.pk,
                {
                    **{k: value[k] for k in ["version", "enabled", "destinations", "methods"]},
                    "enabled": False,
                    "reason": "Synthetic change during checkout",
                },
            )

        result = self.race_seller(change)
        self.assertEqual(result["outcomes"][0]["code"], "terms_unconfigured")
        self.assertFalse(Invoice.objects.exists())

    def test_price_change_after_lock_wait_uses_current_price(self):
        result = self.race_seller(lambda: Variant.objects.filter(pk=self.variant.pk).update(retail=Decimal("15.00")))
        self.assertEqual(result["outcomes"][0]["state"], "accepted")
        self.assertEqual(SellerOrder.objects.get().goods_total, 30)

    def test_stock_adjustment_after_lock_wait_checks_new_stock(self):
        def change():
            stock.manual(
                self.seller,
                self.profile.pk,
                self.variant.pk,
                {
                    "token": str(uuid.uuid4()),
                    "reason": "Synthetic concurrent counted stock",
                    "version": Position.objects.get(pk=self.variant.pk).version,
                    "quantity": "-99.000",
                },
                adjustment=True,
            )

        result = self.race_seller(change)
        self.assertEqual(result["outcomes"][0]["code"], "stock_shortage")
        self.assertEqual(Bucket.objects.get().physical, 1)
        self.assertEqual(Bucket.objects.get().held, 0)

    def test_concurrent_new_cart_quantity_is_not_erased(self):
        result = self.race_seller(lambda: self.add(quantity="3.000"))
        self.assertEqual(result["outcomes"][0]["code"], "cart_changed")
        self.assertEqual(CartLine.objects.get().quantity, 3)
        self.assertFalse(Invoice.objects.exists())

    def test_buyer_revocation_after_user_lock_wait_rechecks_fresh_grant(self):
        from apps.accounts.models import User, Account

        self.add()
        data = self.packet()
        entered = ThreadEvent()
        original = orders.lock_actor

        def waiting(actor, *args, **kwargs):
            entered.set()
            return original(actor, *args, **kwargs)

        with ThreadPoolExecutor(1) as pool, patch("apps.orders.services.lock_actor", side_effect=waiting):
            with transaction.atomic():
                User.objects.select_for_update().get(pk=self.buyer.user.pk)
                future = pool.submit(self.worker, self.buyer, data)
                self.assertTrue(entered.wait(10))
                Account.objects.filter(pk=self.buyer.account.pk).update(status="suspended")
            with self.assertRaises((PermissionDenied, AuthFailure)):
                future.result(timeout=20)
        self.assertFalse(CheckoutSubmission.objects.exists())
        self.assertFalse(Invoice.objects.exists())

    def two_sellers(self):
        original = self.variant
        self.add()
        company = self.company("independent-order")
        self.variant = Variant.objects.get(product=self.product)
        self.seed_stock(self.variant)
        orders.set_terms(
            self.seller,
            company.pk,
            {
                "version": 0,
                "enabled": True,
                "destinations": [{"country": "AF", "all_cities": True, "cities": []}],
                "methods": ["advance", "cod"],
                "reason": "Independent synthetic seller",
            },
        )
        self.add()
        return original, self.packet()

    def test_crash_immediately_after_first_seller_commit_resumes_retained_truth(self):
        original, data = self.two_sellers()
        with patch("apps.orders.services.after_seller_commit", side_effect=RuntimeError("synthetic lost response")):
            with self.assertRaises(RuntimeError):
                orders.submit(self.buyer, data)
        accepted = SellerOrder.objects.get()
        identity = (accepted.pk, accepted.goods_total, accepted.invoice.number)
        self.assertEqual(CheckoutOutcome.objects.filter(state="pending").count(), 1)
        Variant.objects.filter(pk__in=[original.pk, self.variant.pk]).update(retail=Decimal("19.00"))
        result = orders.submit(self.buyer, data)
        accepted.refresh_from_db()
        self.assertFalse(result["pending"])
        self.assertEqual(Invoice.objects.count(), 2)
        self.assertEqual((accepted.pk, accepted.goods_total, accepted.invoice.number), identity)

    def test_later_seller_outage_and_terminal_failure_do_not_rollback_first(self):
        _variant, data = self.two_sellers()
        original = orders.accept_seller

        def outage(actor, parent, pk):
            child = CheckoutOutcome.objects.get(pk=pk)
            if child.seller_id == max(
                CheckoutOutcome.objects.filter(submission=parent).values_list("seller_id", flat=True)
            ):
                raise StorageUnavailable()
            return original(actor, parent, pk)

        with patch("apps.orders.services.accept_seller", side_effect=outage):
            result = orders.submit(self.buyer, data)
        self.assertTrue(result["pending"])
        self.assertEqual(Invoice.objects.count(), 1)
        self.assertEqual(CartLine.objects.count(), 1)
        result = orders.submit(self.buyer, data)
        self.assertFalse(result["pending"])
        self.assertEqual(Invoice.objects.count(), 2)

    def test_seller_approval_change_while_waiting_is_rechecked(self):
        from apps.verification.models import ReviewCase

        result = self.race_seller(lambda: ReviewCase.objects.filter(profile=self.profile).update(status="rejected"))
        self.assertEqual(result["outcomes"][0]["code"], "seller_unavailable")
        self.assertFalse(Invoice.objects.exists())

    def test_document_membership_revocation_before_bytes_after_profile_wait(self):
        from apps.organizations.models import BusinessProfile, Membership
        from apps.orders import access
        from django.http import Http404

        company = self.company("document-revocation")
        self.variant = Variant.objects.get(product=self.product)
        self.seed_stock(self.variant)
        orders.set_terms(
            self.seller,
            company.pk,
            {
                "version": 0,
                "enabled": True,
                "destinations": [{"country": "AF", "all_cities": True, "cities": []}],
                "methods": ["cod"],
                "reason": "Synthetic document terms",
            },
        )
        self.add()
        orders.submit(self.buyer, self.packet("cod"))
        invoice = Invoice.objects.get()
        member, _client = self.connected("seller", "document-finance")
        membership = Membership.objects.create(company=company, account=member.account, bundles=["payments_refunds"])
        entered = ThreadEvent()
        original = access.lock_actor

        def lock(*args, **kwargs):
            entered.set()
            return original(*args, **kwargs)

        def read():
            try:
                return queries.document(member, invoice.pk)
            finally:
                connections.close_all()

        with ThreadPoolExecutor(1) as pool, patch("apps.orders.access.lock_actor", side_effect=lock):
            with transaction.atomic():
                BusinessProfile.objects.select_for_update().get(pk=company.pk)
                future = pool.submit(read)
                self.assertTrue(entered.wait(10))
                membership.active = False
                membership.save()
            with self.assertRaises(Http404):
                future.result(timeout=20)

    def test_database_commit_requires_acceptance_audit_and_complete_outcome(self):
        self.add()
        data = self.packet()
        parent = orders.create_submission(self.buyer, data)
        child = parent.outcomes.get()
        with self.assertRaises(DatabaseError), transaction.atomic(), patch("apps.orders.services.event"):
            orders.accept_seller(self.buyer, parent.pk, child.pk)
        self.assertFalse(SellerOrder.objects.exists())
        self.assertFalse(Invoice.objects.exists())
        child.refresh_from_db()
        self.assertEqual(child.state, "pending")
        self.assertEqual(CartLine.objects.count(), 1)
        result = orders.submit(self.buyer, data)
        self.assertEqual(result["outcomes"][0]["state"], "accepted")

    def test_new_wholesale_profile_uses_pending_recheck_instead_of_late_lock(self):
        from apps.organizations.models import BusinessProfile
        from apps.verification.models import ReviewCase

        self.add(tier="wholesale")
        data = self.packet()
        entered, proceed = ThreadEvent(), ThreadEvent()
        original = orders.buyer_business
        first = True

        def changing(actor, **kwargs):
            nonlocal first
            row = original(actor, **kwargs)
            if first:
                first = False
                entered.set()
                if not proceed.wait(10):
                    raise RuntimeError("Synthetic barrier timed out")
            return row

        with ThreadPoolExecutor(1) as pool, patch("apps.orders.services.buyer_business", side_effect=changing):
            future = pool.submit(self.worker, self.buyer, data)
            try:
                self.assertTrue(entered.wait(10))
                profile = BusinessProfile.objects.create(
                    account=self.buyer.account, kind="business", display_name="Synthetic new buyer business"
                )
                ReviewCase.objects.create(
                    profile=profile, status="approved", snapshot={"display_name": "Reviewed new business"}
                )
            finally:
                proceed.set()
            result = future.result(timeout=20)
        self.assertTrue(result["pending"])
        self.assertEqual(result["outcomes"][0]["code"], "state_changed")
        self.assertFalse(Invoice.objects.exists())
        result = orders.submit(self.buyer, data)
        self.assertEqual(result["outcomes"][0]["state"], "accepted")
        self.assertEqual(SellerOrder.objects.get().snapshot["buyer"], "Reviewed new business")


@override_settings(OWNER_MFA_REQUIRED=False)
class LongInvoiceRowsTests(TestCase):
    def test_permitted_long_single_line_continues_without_duplicating_amounts(self):
        from types import SimpleNamespace as NS
        from datetime import datetime, timezone
        from io import BytesIO
        from pypdf import PdfReader

        values = {"attribute" + str(i): "Mixed specimen ABC 123 " + "طویل " * 35 for i in range(24)}
        values["attribute23"] = "LASTFIELD-SENTINEL " + "طویل " * 35
        self.assertTrue(all(len(value) <= 200 for value in values.values()))
        line = NS(
            snapshot={
                "titles": {"en": "Long permitted product"},
                "source_locale": "en",
                "definition": {"attributes": values},
                "sku": "LONG-VALID-1",
                "unit": "piece",
                "unit_labels": {"en": "Piece"},
                "attribute_labels": {},
            },
            tier="retail",
            quantity=Decimal("1.000"),
            unit_price=Decimal("12.50"),
            goods_amount=Decimal("12.50"),
        )
        order = NS(
            lines=NS(all=lambda: [line]),
            currency="AFN",
            goods_total=Decimal("12.50"),
            payment_method="cod",
            due_at=None,
            snapshot={
                "buyer": "Synthetic buyer",
                "seller": "Synthetic seller",
                "terms": {"destination": {"country": "AF", "city": "kabul"}, "version": 1},
            },
        )
        invoice = NS(order=order, number="BR-SYNTHETIC-LONG", issued_at=datetime.now(timezone.utc))
        for locale in ["fa-AF", "ps", "ar", "en"]:
            with self.subTest(locale=locale):
                value = documents.pdf_bytes(invoice, locale)
                reader = PdfReader(BytesIO(value))
                self.assertGreaterEqual(len(reader.pages), 2)
                text = "\n".join(page.extract_text() for page in reader.pages)
                self.assertIn("LASTFIELD-SENTINEL", text)
                self.assertEqual(text.count("1.000"), 1)
                self.assertEqual(text.count("12.50"), 3)
