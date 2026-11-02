import uuid
from datetime import timedelta
from decimal import Decimal
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from django.db import connections
from django.utils import timezone
from django.test import TransactionTestCase
from rest_framework.exceptions import ValidationError
from apps.messaging.services import CommandConflict
from apps.cart.models import CartCommand, CartLine, MergeReceipt
from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from apps.cart import services as cart
from apps.cart.models import Cart
from tests.test_commerce import CommerceFixture


@override_settings(OWNER_MFA_REQUIRED=False)
class CartCorrectionTests(CommerceFixture, TestCase):
    def test_guest_reads_never_emit_identity_cookies_or_allocate_rows(self):
        for _ in range(2):
            response = APIClient().get("/api/v1/cart/guest/")
            self.assertEqual(response.status_code, 200)
            self.assertNotIn(cart.SESSION_KEY, response.cookies)
            self.assertFalse(response.json()["initialized"])
        self.assertFalse(Cart.objects.exists())

    def command(self, quantity="2.000", version=0):
        return {
            "command_id": uuid.uuid4(),
            "version": version,
            "action": "set",
            "variant": self.variant.pk,
            "tier": "retail",
            "quantity": quantity,
        }

    def test_explicit_initialization_csrf_flags_and_no_read_time_growth(self):
        client = APIClient(enforce_csrf_checks=True)
        self.assertEqual(client.post("/api/v1/cart/guest/initialize/", {}, format="json").status_code, 403)
        response = self.post(client, "cart/guest/initialize/", {})
        self.assertEqual(response.status_code, 200, response.content)
        cookie = response.cookies[cart.SESSION_KEY]
        self.assertTrue(cookie["httponly"])
        self.assertEqual(cookie["samesite"], "Lax")
        self.assertEqual(cookie["path"], "/api/v1/cart/")
        self.assertNotIn("sessionid", response.cookies)
        with override_settings(SESSION_COOKIE_SECURE=True):
            fresh = APIClient(enforce_csrf_checks=True)
            self.assertTrue(self.post(fresh, "cart/guest/initialize/", {}).cookies[cart.SESSION_KEY]["secure"])
        for _ in range(4):
            self.assertTrue(client.get("/api/v1/cart/guest/").json()["initialized"])
            self.assertNotIn(cart.SESSION_KEY, self.post(client, "cart/guest/initialize/", {}).cookies)
        self.assertFalse(Cart.objects.exists())
        self.assertEqual(self.post(self.buyer_client, "cart/guest/initialize/", {}).status_code, 403)
        self.assertEqual(self.post(client, "cart/guest/initialize/", {"cart": "forged"}).status_code, 400)

    def test_expired_and_consumed_reads_cannot_rotate_cookie(self):
        for consumed in [False, True]:
            row = Cart.objects.create(
                guest_key=uuid.uuid4(),
                expires_at=timezone.now() + timedelta(days=1) if consumed else timezone.now() - timedelta(days=1),
                consumed_by=self.buyer.account if consumed else None,
            )
            client = APIClient(enforce_csrf_checks=True)
            client.cookies[cart.SESSION_KEY] = str(row.guest_key)
            response = client.get("/api/v1/cart/guest/")
            self.assertFalse(response.json()["initialized"])
            self.assertNotIn(cart.SESSION_KEY, response.cookies)
            denied = self.post(client, "cart/guest/", self.command())
            self.assertEqual(denied.status_code, 409)
            self.assertNotIn(cart.SESSION_KEY, denied.cookies)
            new = self.post(client, "cart/guest/initialize/", {})
            self.assertNotEqual(new.cookies[cart.SESSION_KEY].value, str(row.guest_key))
            self.assertTrue(Cart.objects.filter(pk=row.pk).exists())
            self.assertNotIn(cart.SESSION_KEY, self.post(client, "cart/guest/initialize/", {}).cookies)

    def test_reconcile_fences_a_late_rejected_add_before_edit(self):
        data = self.command()
        self.assertEqual(cart.reconcile(self.request, self.buyer, data)["state"], "rejected")
        with self.assertRaises(CommandConflict):
            cart.mutate(self.request, self.buyer, data)
        self.assertFalse(CartLine.objects.exists())
        self.assertEqual(cart.reconcile(self.request, self.buyer, data)["state"], "rejected")
        cart.mutate(self.request, self.buyer, self.command(quantity="4.000"))
        self.assertEqual(CartLine.objects.get().quantity, Decimal("4.000"))

    def test_committed_outcome_is_not_inferred_from_current_quantity(self):
        data = self.command()
        cart.mutate(self.request, self.buyer, data)
        cart.mutate(self.request, self.buyer, self.command("6.000", version=1))
        self.assertEqual(cart.reconcile(self.request, self.buyer, data), {"state": "applied", "version": 1})
        cart.mutate(self.request, self.buyer, data)
        self.assertEqual(CartLine.objects.get().quantity, Decimal("6.000"))
        self.assertEqual(CartCommand.objects.count(), 2)
        with self.assertRaises(CommandConflict):
            cart.reconcile(self.request, self.buyer, {**data, "quantity": "8.000"})

    def test_invalid_increment_and_stale_version_can_be_fenced_then_corrected(self):
        from copy import deepcopy
        from apps.catalogue.models import Variant

        body = deepcopy(self.body)
        body["variants"] = [
            {
                **body["variants"][0],
                "sku": "STEP-2",
                "increment": "2.000",
                "minimum": "2.000",
                "contents": "Two-unit specimen",
            }
        ]
        self.publish(self.save(body))
        self.variant = Variant.objects.get(product=self.product, sku="STEP-2")
        invalid = self.command("1.000")
        with self.assertRaises(ValidationError):
            cart.mutate(self.request, self.buyer, invalid)
        self.assertEqual(cart.reconcile(self.request, self.buyer, invalid)["state"], "rejected")
        cart.mutate(self.request, self.buyer, self.command("2.000"))
        stale = self.command("4.000")
        with self.assertRaises(CommandConflict):
            cart.mutate(self.request, self.buyer, stale)
        self.assertEqual(cart.reconcile(self.request, self.buyer, stale)["state"], "rejected")
        cart.mutate(self.request, self.buyer, self.command("4.000", version=1))
        self.assertEqual(CartLine.objects.get().quantity, Decimal("4.000"))

    def test_reconciliation_is_exact_buyer_or_guest_cookie_and_csrf_scoped(self):
        data = self.command()
        cart.mutate(self.request, self.buyer, data)
        other = cart.reconcile(self.other_buyer.request, self.other_buyer, data)
        self.assertEqual(other["state"], "rejected")
        self.assertEqual(CartLine.objects.count(), 1)
        client = APIClient(enforce_csrf_checks=True)
        self.post(client, "cart/guest/initialize/", {})
        guestdata = {**self.command(), "guest_scope": client.get("/api/v1/cart/guest/").json()["guest_scope"]}
        self.assertEqual(
            client.post("/api/v1/cart/guest/commands/reconcile/", guestdata, format="json").status_code, 403
        )
        self.assertEqual(self.post(client, "cart/guest/", guestdata).status_code, 200)
        applied = self.post(client, "cart/guest/commands/reconcile/", guestdata)
        self.assertEqual(applied.json()["state"], "applied")
        stranger = APIClient(enforce_csrf_checks=True)
        self.post(stranger, "cart/guest/initialize/", {})
        self.assertEqual(
            self.post(
                stranger,
                "cart/guest/commands/reconcile/",
                {
                    "command_id": str(guestdata["command_id"]),
                    "guest_scope": stranger.get("/api/v1/cart/guest/").json()["guest_scope"],
                },
            ).json()["state"],
            "rejected",
        )
        self.assertIn("no-store", applied["Cache-Control"])
        self.assertNotIn("cart", applied.json())

    def test_consumed_history_and_merge_cannot_move_to_another_buyer(self):
        key = uuid.uuid4()
        self.request.COOKIES = {cart.SESSION_KEY: str(key)}
        data = {**self.command(), "guest_scope": cart.guest_scope(self.request)}
        cart.mutate(self.request, None, data)
        receipt = cart.merge(self.request, self.buyer, {"command_id": uuid.uuid4(), "version": 0, "guest_version": 1})
        self.assertEqual(cart.reconcile(self.request, None, data)["state"], "applied")
        self.other_buyer.request.COOKIES = {cart.SESSION_KEY: str(key)}
        with self.assertRaises(CommandConflict):
            cart.merge(
                self.other_buyer.request,
                self.other_buyer,
                {"command_id": uuid.uuid4(), "version": 0, "guest_version": 1},
            )
        with self.assertRaises(CommandConflict):
            cart.reconcile(self.request, None, self.command())
        self.assertEqual(MergeReceipt.objects.count(), 1)
        self.assertEqual(CartLine.objects.get(cart__account=self.buyer.account).quantity, Decimal("2.000"))
        self.assertTrue(receipt["merged"])

    def test_reference_only_recovery_proves_commit_or_fences_the_original_key(self):
        original = self.command()
        cart.mutate(self.request, self.buyer, original)
        self.assertEqual(
            cart.reconcile(self.request, self.buyer, {"command_id": original["command_id"]})["state"], "applied"
        )
        missing = self.command("4.000", version=1)
        self.assertEqual(
            cart.reconcile(self.request, self.buyer, {"command_id": missing["command_id"]})["state"], "rejected"
        )
        with self.assertRaises(CommandConflict):
            cart.mutate(self.request, self.buyer, missing)
        self.assertEqual(CartLine.objects.get().quantity, Decimal("2.000"))
        response = self.post(
            self.buyer_client, "cart/buyer/commands/reconcile/", {"command_id": str(original["command_id"])}
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["state"], "applied")
        self.assertEqual(
            self.post(
                self.buyer_client,
                "cart/buyer/commands/reconcile/",
                {"command_id": str(original["command_id"]), "cart": str(cart.buyer(self.buyer).pk)},
            ).status_code,
            400,
        )

    def test_partial_reconciliation_packets_are_rejected_without_history(self):
        for partial in [
            {"version": 0},
            {"action": "set", "variant": str(self.variant.pk), "tier": "retail", "quantity": "2.000"},
            {"version": 0, "action": "set"},
        ]:
            response = self.post(
                self.buyer_client, "cart/buyer/commands/reconcile/",
                {"command_id": str(uuid.uuid4()), **partial},
            )
            self.assertEqual(response.status_code, 400, response.content)
        self.assertFalse(CartCommand.objects.exists())
        self.assertFalse(CartLine.objects.exists())

    def test_uncertain_guest_command_cannot_replay_after_merge_and_cookie_rotation(self):
        import hashlib

        old = uuid.uuid4()
        self.request.COOKIES = {cart.SESSION_KEY: str(old)}
        packet = {**self.command(), "guest_scope": hashlib.sha256(("guest-cart:" + str(old)).encode()).hexdigest()}
        cart.mutate(self.request, None, packet)
        cart.merge(self.request, self.buyer, {"command_id": uuid.uuid4(), "version": 0, "guest_version": 1})
        self.request.COOKIES = {cart.SESSION_KEY: str(uuid.uuid4())}
        with self.assertRaises(CommandConflict):
            cart.mutate(self.request, None, packet)
        with self.assertRaises(CommandConflict):
            cart.reconcile(self.request, None, packet)
        self.assertEqual(CartLine.objects.filter(cart__account__isnull=True, cart__consumed_by__isnull=True).count(), 0)
        self.assertEqual(CartLine.objects.get(cart__account=self.buyer.account).quantity, Decimal("2.000"))


@override_settings(OWNER_MFA_REQUIRED=False)
class CartRecoveryRaceTests(CommerceFixture, TransactionTestCase):
    def test_original_add_and_reconciliation_serialize_to_one_terminal_outcome(self):
        from tests.test_messaging import request_actor

        data = {
            "command_id": uuid.uuid4(),
            "version": 0,
            "action": "set",
            "variant": self.variant.pk,
            "tier": "retail",
            "quantity": "2.000",
        }
        cart.buyer(self.buyer, create=True)
        barrier = Barrier(2)

        def worker(recover):
            try:
                actor = request_actor(self.buyer_client, "buyer", self.buyer.user)
                barrier.wait(timeout=10)
                try:
                    return (
                        cart.reconcile(actor.request, actor, data)
                        if recover
                        else cart.mutate(actor.request, actor, data)
                    )
                except CommandConflict:
                    return {"state": "rejected"}
            finally:
                connections.close_all()

        with ThreadPoolExecutor(2) as pool:
            a = pool.submit(worker, False)
            b = pool.submit(worker, True)
            first = a.result(timeout=20)
            second = b.result(timeout=20)
        self.assertEqual(CartCommand.objects.count(), 1)
        self.assertIn(second["state"], ["applied", "rejected"])
        self.assertEqual(CartLine.objects.count(), 1 if second["state"] == "applied" else 0)
        if CartLine.objects.exists():
            self.assertEqual(CartLine.objects.get().quantity, Decimal("2.000"))
        self.assertTrue(first)
