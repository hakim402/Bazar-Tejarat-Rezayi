"""Stock-domain proofs against disposable PostgreSQL, including real competing transactions."""

import copy
import json
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from decimal import Decimal
from threading import Barrier
from unittest.mock import patch
from django.core.exceptions import ValidationError as ModelError
from django.db import connections, connection, DatabaseError, transaction
from django.db.migrations.executor import MigrationExecutor
from django.http import QueryDict, Http404
from django.test import TestCase, TransactionTestCase
from rest_framework.exceptions import PermissionDenied, ValidationError
from apps.catalogue.models import Variant
from apps.organizations.access import Conflict
from apps.organizations.models import BusinessProfile, Membership
from apps.inventory import services as s, queries, access
from apps.inventory.models import Position, Bucket, Movement, Operation, Allocation, Shortage, Recovery
from tests.test_catalogue import CatalogueFixture


def command(**values):
    return {"token": str(uuid.uuid4()), "reason": "Synthetic counted stock", **values}


class StockFixture(CatalogueFixture):
    def setUp(self):
        CatalogueFixture.setUp(self)
        self.body["variants"].append({**self.body["variants"][0], "sku": "SYN-2", "attributes": {"pack_size": "large"}})
        revision = self.save()
        self.publish(revision)
        self.body = copy.deepcopy(revision.body)
        self.variants = list(Variant.objects.filter(product=self.product).order_by("sku"))
        self.variant = self.variants[0]

    def configure(self, variant=None, **extra):
        variant = variant or self.variant
        position = Position.objects.filter(pk=variant.pk).first()
        return s.configure(
            self.seller,
            self.profile.pk,
            variant.pk,
            command(
                version=position.version if position else 0,
                tracking="plain",
                expiry_required=False,
                threshold="1.000",
                **extra,
            ),
        )

    def receive(self, quantity="10.000", variant=None, **extra):
        variant = variant or self.variant
        return s.manual(
            self.seller,
            self.profile.pk,
            variant.pk,
            command(version=Position.objects.get(pk=variant.pk).version, quantity=quantity, **extra),
        )

    def allocation(self, quantity="2.000", **extra):
        return command(
            reference="synthetic-" + str(uuid.uuid4()),
            lines=[{"variant": str(self.variant.pk), "quantity": quantity}],
            **extra,
        )


class InventoryTests(StockFixture, TestCase):
    def test_get_never_creates_position_and_allocation_does_not_publish_draft(self):
        value = queries.overview(self.seller, self.profile.pk, QueryDict(""))
        self.assertEqual(value["counts"]["unconfigured"], 2)
        self.assertIsNone(value["results"][0]["available"])
        self.assertFalse(Position.objects.exists())
        before = Operation.objects.count()
        self.assertFalse(s.availability(self.seller, self.profile.pk, self.allocation()["lines"])["available"])
        self.assertEqual(Operation.objects.count(), before)
        self.assertFalse(Allocation.objects.exists())

    def test_receipt_adjustment_retry_and_ledger_reconstruction(self):
        configured = self.configure()
        data = command(version=configured["version"], quantity="10.125")
        first = s.manual(self.seller, self.profile.pk, self.variant.pk, data)
        self.assertEqual(first, s.manual(self.seller, self.profile.pk, self.variant.pk, data))
        with self.assertRaises(Conflict):
            s.manual(self.seller, self.profile.pk, self.variant.pk, {**data, "quantity": "12.000"})
        adjusted = command(version=first["version"], quantity="-0.125")
        s.manual(self.seller, self.profile.pk, self.variant.pk, adjusted, adjustment=True)
        self.assertEqual(Bucket.objects.get().physical, Decimal("10.000"))
        self.assertEqual(sum(m.physical_delta for m in Movement.objects.all()), Bucket.objects.get().physical)
        self.assertEqual(Movement.objects.count(), 2)
        with self.assertRaises(Conflict):
            s.manual(self.seller, self.profile.pk, self.variant.pk, command(version=1, quantity="1.000"))
        self.assertEqual(queries.detail(self.seller, self.profile.pk, self.variant.pk)["physical"], "10.000")

    def test_decimal_and_increment_rejections_roll_back(self):
        self.configure()
        for value in ["NaN", "Infinity", 1.0, "1e2", "-1", "0", "0.1234", "0.124", "1000000000.000", " 1", "+1"]:
            with self.subTest(value=value), self.assertRaises(ValidationError):
                self.receive(value)
        self.assertFalse(Movement.objects.exists())
        self.assertEqual(Bucket.objects.get().physical, 0)
        self.receive("0.125")
        self.assertEqual(Bucket.objects.get().physical, Decimal("0.125"))
        self.variant.unit.fractional = False
        self.variant.unit.save()
        with self.assertRaises(ValidationError):
            self.receive("0.125")

    def test_configuration_token_scopes_variant_and_policy_is_frozen(self):
        data = command(version=0, tracking="plain", expiry_required=False)
        s.configure(self.seller, self.profile.pk, self.variant.pk, data)
        self.assertEqual(s.configure(self.seller, self.profile.pk, self.variant.pk, data)["version"], 1)
        with self.assertRaises(Conflict):
            s.configure(self.seller, self.profile.pk, self.variants[1].pk, data)
        self.receive()
        with self.assertRaises(Conflict):
            s.configure(
                self.seller,
                self.profile.pk,
                self.variant.pk,
                command(version=2, tracking="batch", expiry_required=True),
            )

    def test_reserve_release_consume_and_cod_are_exactly_once(self):
        self.configure()
        self.receive()
        data = self.allocation()
        allocated = s.allocate(self.seller, self.profile.pk, data)
        self.assertEqual(s.allocate(self.seller, self.profile.pk, data), allocated)
        self.assertEqual(Bucket.objects.get().held, 2)
        with self.assertRaises(Conflict):
            s.allocate(self.seller, self.profile.pk, {**data, "token": str(uuid.uuid4())})
        consumed = command(reference="synthetic-consume")
        result = s.settle(self.seller, self.profile.pk, allocated["allocation"], consumed)
        self.assertEqual(s.settle(self.seller, self.profile.pk, allocated["allocation"], consumed), result)
        with self.assertRaises(Conflict):
            s.settle(self.seller, self.profile.pk, allocated["allocation"], command())
        self.assertEqual(Bucket.objects.get().physical, 8)
        self.assertEqual(Bucket.objects.get().held, 0)
        allocated = s.allocate(self.seller, self.profile.pk, self.allocation())
        released = command()
        s.settle(self.seller, self.profile.pk, allocated["allocation"], released, release=True)
        s.settle(self.seller, self.profile.pk, allocated["allocation"], released, release=True)
        self.assertEqual(Bucket.objects.get().physical, 8)
        direct = self.allocation()
        s.allocate(self.seller, self.profile.pk, direct, cod=True)
        s.allocate(self.seller, self.profile.pk, direct, cod=True)
        self.assertEqual(Bucket.objects.get().physical, 6)
        self.assertEqual(sum(m.held_delta for m in Movement.objects.all()), 0)

    def test_whole_operation_shortage_is_stable_after_replenishment_and_recovery_linked(self):
        self.configure()
        self.receive()
        self.configure(self.variants[1])
        data = self.allocation()
        data["lines"].append({"variant": str(self.variants[1].pk), "quantity": "3.000"})
        before = Movement.objects.count()
        result = s.allocate(self.seller, self.profile.pk, data)
        self.assertEqual(result["status"], "shortage")
        self.assertEqual(Movement.objects.count(), before)
        self.assertEqual(Bucket.objects.get(position=self.variant.pk).held, 0)
        self.receive(variant=self.variants[1])
        self.assertEqual(s.allocate(self.seller, self.profile.pk, data), result)
        recovered = {
            **data,
            "token": str(uuid.uuid4()),
            "reference": "synthetic-recovery",
            "recovery_of": result["shortage"],
        }
        success = s.allocate(self.seller, self.profile.pk, recovered)
        self.assertEqual(success["status"], "completed")
        self.assertEqual(Recovery.objects.get().shortage_id, uuid.UUID(result["shortage"]))
        with self.assertRaises(Conflict):
            s.allocate(
                self.seller,
                self.profile.pk,
                {**recovered, "token": str(uuid.uuid4()), "reference": "synthetic-second-recovery"},
            )
        self.assertEqual(Shortage.objects.count(), 1)

    def test_held_stock_cannot_be_removed_by_adjustment(self):
        self.configure()
        self.receive()
        s.allocate(self.seller, self.profile.pk, self.allocation("8.000"))
        with self.assertRaises(ValidationError):
            s.manual(
                self.seller, self.profile.pk, self.variant.pk, command(version=3, quantity="-3.000"), adjustment=True
            )
        self.assertEqual(Bucket.objects.get().physical, 10)
        self.assertEqual(Bucket.objects.get().held, 8)

    def test_batch_expiry_kabul_and_expired_reserved_overlap(self):
        s.configure(
            self.seller, self.profile.pk, self.variant.pk, command(version=0, tracking="batch", expiry_required=True)
        )
        with self.assertRaises(ValidationError):
            self.receive(batch_code="missing")
        before = datetime(2026, 10, 25, 19, 29, 59, tzinfo=timezone.utc)
        after = datetime(2026, 10, 25, 19, 30, tzinfo=timezone.utc)
        data = command(version=1, quantity="5.000", batch_code="LATE", expires_on="2026-10-25")
        s.manual(self.seller, self.profile.pk, self.variant.pk, data, now=before)
        bucket = Bucket.objects.get()
        self.assertFalse(s.expired(bucket, before))
        self.assertTrue(s.expired(bucket, after))
        selected = command(
            reference="synthetic-advance",
            lines=[{"variant": str(self.variant.pk), "batch": str(bucket.batch_id), "quantity": "3.000"}],
        )
        reserved = s.allocate(self.seller, self.profile.pk, selected, now=before)
        with patch("apps.inventory.services.timezone.now", return_value=after):
            view = queries.detail(self.seller, self.profile.pk, self.variant.pk)
            self.assertEqual(
                (view["physical"], view["held"], view["expired"], view["available"]),
                ("5.000", "3.000", "5.000", "0.000"),
            )
        with self.assertRaises(ValidationError):
            s.settle(self.seller, self.profile.pk, reserved["allocation"], command(), now=after)
        self.assertEqual(Bucket.objects.get().held, 3)
        s.settle(self.seller, self.profile.pk, reserved["allocation"], command(), release=True, now=after)
        with self.assertRaises(ValidationError):
            s.manual(
                self.seller,
                self.profile.pk,
                self.variant.pk,
                command(version=4, quantity="1.000", batch=str(bucket.batch_id)),
                now=after,
            )
        with self.assertRaises(ValueError):
            s.today(datetime(2026, 10, 25))

    def test_seller_selects_non_earliest_and_multi_batch_without_substitution(self):
        s.configure(
            self.seller, self.profile.pk, self.variant.pk, command(version=0, tracking="batch", expiry_required=True)
        )
        self.receive("3.000", batch_code="EARLY", expires_on="2098-01-01")
        self.receive("4.000", batch_code="LATE", expires_on="2099-01-01")
        buckets = list(Bucket.objects.order_by("batch__code"))
        data = command(
            reference="synthetic-two-batches",
            lines=[{"variant": str(self.variant.pk), "batch": str(b.batch_id), "quantity": "2.000"} for b in buckets],
        )
        s.allocate(self.seller, self.profile.pk, data, cod=True)
        self.assertEqual(
            list(Bucket.objects.order_by("batch__code").values_list("physical", flat=True)), [Decimal(1), Decimal(2)]
        )
        s.configure(
            self.seller,
            self.profile.pk,
            self.variants[1].pk,
            command(version=0, tracking="batch", expiry_required=True),
        )
        with self.assertRaises(Http404):
            s.manual(
                self.seller,
                self.profile.pk,
                self.variants[1].pk,
                command(version=1, quantity="1.000", batch=str(buckets[0].batch_id)),
            )

    def test_draft_receipt_stays_ineligible_and_fulfilment_sees_only_approved_source(self):
        body = copy.deepcopy(self.body)
        body["title"] = "PRIVATE replacement title"
        body["variants"].append(
            {
                **body["variants"][0],
                "id": None,
                "sku": "DRAFT-ONLY",
                "retail": "12.00",
                "wholesale": "10.00",
                "attributes": {"pack_size": "draft"},
            }
        )
        self.save(body)
        draft = Variant.objects.get(sku="DRAFT-ONLY")
        self.configure(draft)
        self.receive("2.000", draft)
        self.assertFalse(
            s.availability(self.seller, self.profile.pk, [{"variant": str(draft.pk), "quantity": "1.000"}])["available"]
        )
        self.assertEqual(queries.detail(self.seller, self.profile.pk, draft.pk)["physical"], "2.000")
        company = BusinessProfile.objects.create(
            account=self.seller.account, kind="company", display_name="Synthetic scope"
        )
        from apps.verification.models import ReviewCase

        ReviewCase.objects.create(profile=company, snapshot={}, status="approved")
        Membership.objects.create(company=company, account=self.seller.account, bundles=["fulfilment"], is_owner=True)
        from apps.catalogue.models import Product

        Product.objects.filter(pk=self.product.pk).update(seller=company)
        visible = queries.overview(self.seller, company.pk, QueryDict(""))
        self.assertEqual(visible["count"], 2)
        self.assertEqual(queries.overview(self.seller, company.pk, QueryDict("q=PRIVATE"))["count"], 0)
        self.assertNotIn("PRIVATE replacement title", json.dumps(visible, default=str))
        with self.assertRaises(Http404):
            queries.detail(self.seller, company.pk, draft.pk)
        with self.assertRaises(PermissionDenied):
            access.authorize(self.seller, company.pk, True)

    def test_history_is_immutable_and_owner_admin_is_read_only(self):
        self.configure()
        self.receive()
        movement = Movement.objects.get()
        with self.assertRaises(DatabaseError), transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute("UPDATE inventory_movement SET physical_delta=99 WHERE id=%s", [movement.pk])

        with self.assertRaises(ModelError):
            movement.save()
        with self.assertRaises(ModelError):
            movement.delete()
        with self.assertRaises(ModelError):
            Movement.objects.update(reason="rewrite")
        from apps.accounts.admin import owner_site

        admin = owner_site._registry[Movement]
        self.assertFalse(admin.has_add_permission(self.seller.request))
        self.assertFalse(admin.has_change_permission(self.seller.request))
        self.assertFalse(admin.has_delete_permission(self.seller.request))

    def test_full_filtered_counts_pagination_and_private_scope(self):
        self.configure()
        self.receive("0.125")
        value = queries.overview(self.seller, self.profile.pk, QueryDict("page=1&q=SYN"))
        self.assertEqual(value["counts"]["variants"], 2)
        self.assertEqual(value["counts"]["low"], 1)
        other = self.actor("seller", "other-stock")
        with self.assertRaises(Http404):
            queries.overview(other, self.profile.pk, QueryDict(""))
        for query in ["page=0", "sort=random", "seller=a&seller=b", "secret=1"]:
            with self.assertRaises(ValidationError):
                queries.overview(self.seller, self.profile.pk, QueryDict(query))
        response = json.dumps(value, default=str)
        self.assertNotIn("PRIVATE-CONTACT", response)
        self.assertNotIn("storage", response)

    def test_company_bundles_and_next_action_revocation(self):
        company = BusinessProfile.objects.create(
            account=self.seller.account, kind="company", display_name="Synthetic company"
        )
        from apps.verification.models import ReviewCase

        ReviewCase.objects.create(profile=company, snapshot={}, status="approved")
        member = Membership.objects.create(company=company, account=self.seller.account, bundles=["fulfilment"])
        self.assertEqual(access.capabilities(self.seller, company), {"read": True, "write": False})
        with self.assertRaises(PermissionDenied):
            access.authorize(self.seller, company.pk, True)
        member.bundles = ["catalogue"]
        member.save()
        access.authorize(self.seller, company.pk, True)
        member.active = False
        member.save()
        with self.assertRaises(Http404):
            access.authorize(self.seller, company.pk)
        self.seller.account.status = "suspended"
        self.seller.account.save()
        with self.assertRaises(PermissionDenied):
            access.authorize(self.seller, self.profile.pk)

    def test_staff_requires_explicit_shortage_permission(self):
        with self.assertRaises(PermissionDenied):
            queries.shortages(self.reviewer)
        from django.contrib.auth.models import Permission, Group

        group = Group.objects.create(name="Synthetic stock shortage reader")
        group.permissions.add(Permission.objects.get(content_type__app_label="inventory", codename="read_shortages"))
        self.reviewer.user.groups.add(group)
        self.assertEqual(queries.shortages(self.reviewer)["count"], 0)
        group.permissions.clear()
        with self.assertRaises(PermissionDenied):
            queries.shortages(self.reviewer)

    def test_explicit_staff_group_setup_preserves_existing_assignments_and_exposes_only_assigned_codes(self):
        from django.core.management import call_command
        from django.contrib.auth.models import Group
        from apps.accounts.services import permission_codes

        before = list(self.reviewer.user.groups.values_list("pk", flat=True))
        call_command("setup_inventory_groups", verbosity=0)
        call_command("setup_inventory_groups", verbosity=0)
        self.assertEqual(list(self.reviewer.user.groups.values_list("pk", flat=True)), before)
        self.assertNotIn("read_shortages", permission_codes(self.reviewer.account))
        self.reviewer.user.groups.add(Group.objects.get(name="Rezayi: Inventory shortages"))
        self.assertIn("read_shortages", permission_codes(self.reviewer.account))

    def test_draft_and_pending_replacement_do_not_change_approved_activity_or_prices(self):
        self.configure()
        self.receive()
        prices = list(Variant.objects.values("id", "retail", "wholesale"))
        changed = copy.deepcopy(self.body)
        changed["title"] = "Replacement"
        changed["variants"][0]["active"] = False
        self.save(changed)
        self.assertTrue(s.availability(self.seller, self.profile.pk, self.allocation()["lines"])["available"])
        self.assertEqual(list(Variant.objects.values("id", "retail", "wholesale")), prices)


class InventoryRaces(StockFixture, TransactionTestCase):
    reset_sequences = True

    def race(self, functions):
        barrier = Barrier(len(functions))

        def run(fn):
            connections.close_all()
            try:
                barrier.wait(timeout=10)
                try:
                    return fn()
                except (Conflict, ValidationError) as error:
                    return error
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=len(functions)) as pool:
            return list(pool.map(run, functions))

    def test_competing_cod_and_same_token_never_oversell(self):
        self.configure()
        self.receive("3.000")
        values = [self.allocation() for _ in range(2)]
        results = self.race([lambda d=d: s.allocate(self.seller, self.profile.pk, d, cod=True) for d in values])
        self.assertEqual(sorted(r["status"] for r in results), ["completed", "shortage"])
        self.assertEqual(Bucket.objects.get().physical, 1)
        data = self.allocation("1.000")
        results = self.race([lambda: s.allocate(self.seller, self.profile.pk, data) for _ in range(2)])
        self.assertEqual(results[0], results[1])
        self.assertEqual(Bucket.objects.get().held, 1)

    def test_different_tokens_cannot_race_the_same_logical_reservation(self):
        self.configure()
        self.receive()
        first = self.allocation()
        second = {**first, "token": str(uuid.uuid4())}
        results = self.race(
            [lambda data=data: s.allocate(self.seller, self.profile.pk, data) for data in [first, second]]
        )
        self.assertEqual(sum(isinstance(result, Conflict) for result in results), 1)
        self.assertEqual(Allocation.objects.count(), 1)
        self.assertEqual(Bucket.objects.get().held, 2)
        self.assertEqual(Movement.objects.count(), 2)

    def test_missing_position_setup_and_same_version_adjustments(self):
        data = command(version=0, tracking="plain", expiry_required=False)
        results = self.race(
            [lambda: s.configure(self.seller, self.profile.pk, self.variant.pk, data) for _ in range(2)]
        )
        self.assertEqual(results[0], results[1])
        self.assertEqual(Position.objects.count(), 1)
        self.receive()
        values = [command(version=2, quantity="-6.000") for _ in range(2)]
        results = self.race(
            [lambda d=d: s.manual(self.seller, self.profile.pk, self.variant.pk, d, adjustment=True) for d in values]
        )
        self.assertEqual(sum(isinstance(r, Conflict) for r in results), 1)
        self.assertEqual(Bucket.objects.get().physical, 4)

    def test_different_token_missing_position_race_and_reserve_adjustment_compete(self):
        values = [command(version=0, tracking="plain", expiry_required=False) for _ in range(2)]
        results = self.race([lambda d=d: s.configure(self.seller, self.profile.pk, self.variant.pk, d) for d in values])
        self.assertEqual(sum(isinstance(r, Conflict) for r in results), 1)
        self.assertEqual(Position.objects.count(), 1)
        self.receive("3.000")
        results = self.race(
            [
                lambda: s.allocate(self.seller, self.profile.pk, self.allocation("3.000")),
                lambda: s.manual(
                    self.seller,
                    self.profile.pk,
                    self.variant.pk,
                    command(version=2, quantity="-2.000"),
                    adjustment=True,
                ),
            ]
        )
        bucket = Bucket.objects.get()
        self.assertGreaterEqual(bucket.physical, bucket.held)
        self.assertGreaterEqual(bucket.physical, 0)
        self.assertEqual(sum(m.physical_delta for m in Movement.objects.all()), bucket.physical)
        self.assertEqual(sum(m.held_delta for m in Movement.objects.all()), bucket.held)
        self.assertEqual(len(results), 2)

    def test_consumption_rechecks_the_definition_after_waiting_for_publication_lock(self):
        from threading import Event
        from apps.catalogue.models import Product

        self.configure()
        self.receive()
        held = s.allocate(self.seller, self.profile.pk, self.allocation())
        body = copy.deepcopy(self.body)
        body["variants"][0]["active"] = False
        replacement = self.save(body)
        self.action(replacement, "submit")
        locked, reached = Event(), Event()
        original = s.locked_variant

        def after_snapshot(profile, pk):
            reached.set()
            return original(profile, pk)

        def publish():
            connections.close_all()
            try:
                with transaction.atomic():
                    Product.objects.select_for_update().get(pk=self.product.pk)
                    locked.set()
                    self.assertTrue(reached.wait(10))
                    self.action(replacement, "publish")
            finally:
                connections.close_all()

        def consume():
            connections.close_all()
            try:
                self.assertTrue(locked.wait(10))
                with self.assertRaises(ValidationError):
                    s.settle(self.seller, self.profile.pk, held["allocation"], command())
            finally:
                connections.close_all()

        with patch("apps.inventory.services.locked_variant", side_effect=after_snapshot):
            with ThreadPoolExecutor(max_workers=2) as pool:
                publication, consumption = pool.submit(publish), pool.submit(consume)
                publication.result(timeout=20)
                consumption.result(timeout=20)
        self.assertEqual(Bucket.objects.get().physical, 10)
        self.assertEqual(Bucket.objects.get().held, 2)

    def test_whole_multi_variant_competition_and_duplicate_consumption(self):
        for variant in self.variants:
            self.configure(variant)
            self.receive("3.000", variant)
        values = [
            command(
                reference=str(uuid.uuid4()), lines=[{"variant": str(v.pk), "quantity": "2.000"} for v in self.variants]
            )
            for _ in range(2)
        ]
        results = self.race([lambda d=d: s.allocate(self.seller, self.profile.pk, d) for d in values])
        self.assertEqual(sorted(r["status"] for r in results), ["completed", "shortage"])
        self.assertEqual(list(Bucket.objects.values_list("held", flat=True)), [Decimal(2), Decimal(2)])
        group = next(r["allocation"] for r in results if r["status"] == "completed")
        results = self.race([lambda: s.settle(self.seller, self.profile.pk, group, command()) for _ in range(2)])
        self.assertEqual(sum(isinstance(r, Conflict) for r in results), 1)
        self.assertEqual(list(Bucket.objects.values_list("physical", flat=True)), [Decimal(1), Decimal(1)])


class InventoryUpgrade(StockFixture, TransactionTestCase):
    def test_additive_upgrade_preserves_populated_predecessor_and_retained_legacy_table(self):
        from django.apps import apps

        executor = MigrationExecutor(connection)
        target = executor.loader.graph.leaf_nodes("inventory")
        executor.migrate([("inventory", None)])
        names = [
            m
            for m in apps.get_models()
            if m._meta.app_label in {"accounts", "organizations", "verification", "catalogue", "site"}
        ]

        def snapshot():
            return {
                m._meta.label: json.dumps(
                    list(m.objects.order_by(m._meta.pk.name).values()), default=str, sort_keys=True
                )
                for m in names
            }

        from tests.legacy_content import predecessor, fingerprints

        predecessor(self.seller.user)
        before = snapshot()
        legacy_before = fingerprints(("inventory",))
        with connection.cursor() as cursor:
            cursor.execute("CREATE TABLE content_phase7_preservation (id integer PRIMARY KEY, body text)")
            cursor.execute("INSERT INTO content_phase7_preservation VALUES (1, 'retained legacy CMS')")
        try:
            MigrationExecutor(connection).migrate(target)
            self.assertEqual(snapshot(), before)
            legacy_after = fingerprints(("inventory",))
            self.assertEqual(legacy_before, {key: legacy_after[key] for key in legacy_before})
            self.assertFalse(Position.objects.exists())
            with connection.cursor() as cursor:
                cursor.execute("SELECT body FROM content_phase7_preservation WHERE id=1")
                self.assertEqual(cursor.fetchone()[0], "retained legacy CMS")
        finally:
            with connection.cursor() as cursor:
                cursor.execute("DROP TABLE content_phase7_preservation")
            MigrationExecutor(connection).migrate(target)


class InventoryApiTests(StockFixture, TestCase):
    def setUp(self):
        super().setUp()
        self.grants.stop()
        from rest_framework.test import APIClient
        from tests.test_identity import signin

        self.client = APIClient(enforce_csrf_checks=True)
        self.assertEqual(signin(self.client, "seller", self.seller.user.email).status_code, 200)
        self.path = f"/api/v1/inventory/seller/variants/{self.variant.pk}/"
        self.scope = f"?seller={self.profile.pk}"

    def test_private_session_csrf_dto_and_mutation_scope(self):
        from tests.test_identity import ORIGIN

        data = command(version=0, tracking="plain", expiry_required=False)
        self.assertEqual(self.client.post(self.path + "settings/" + self.scope, data, format="json").status_code, 403)
        token = self.client.get("/api/v1/auth/csrf/").json()["csrf_token"]
        response = self.client.post(
            self.path + "settings/" + self.scope, data, format="json", HTTP_X_CSRFTOKEN=token, HTTP_ORIGIN=ORIGIN
        )
        self.assertEqual(response.status_code, 200, response.content)
        for quantity in [1, 1.125, True, "1.1234", "1e0", " 1"]:
            invalid = self.client.post(
                self.path + "receipts/" + self.scope,
                command(version=1, quantity=quantity),
                format="json",
                HTTP_X_CSRFTOKEN=token,
                HTTP_ORIGIN=ORIGIN,
            )
            self.assertEqual(invalid.status_code, 400)
        self.assertFalse(Movement.objects.exists())

        response = self.client.get(self.path + self.scope)
        self.assertEqual(response.status_code, 200)
        self.assertIn("no-store", response["Cache-Control"])
        self.assertIsNone(response.json()["threshold"])
        self.assertNotIn("PRIVATE-CONTACT", response.content.decode())
        self.assertEqual(self.client.get(self.path + "?seller=" + str(uuid.uuid4())).status_code, 404)
        self.assertEqual(
            self.client.post(
                "/api/v1/inventory/seller/reserve/", {}, format="json", HTTP_X_CSRFTOKEN=token, HTTP_ORIGIN=ORIGIN
            ).status_code,
            404,
        )
        self.assertEqual(self.client.get("/api/v1/inventory/staff/shortages/").status_code, 404)

    def test_buyer_context_never_uses_seller_inventory(self):
        from apps.accounts.models import Account
        from rest_framework.test import APIClient
        from tests.test_identity import signin

        Account.objects.create(user=self.seller.user, context="buyer")
        buyer = APIClient(enforce_csrf_checks=True)
        signin(buyer, "buyer", self.seller.user.email)
        self.assertEqual(buyer.get(self.path + self.scope).status_code, 403)
        self.assertEqual(APIClient().get(self.path + self.scope).status_code, 403)
