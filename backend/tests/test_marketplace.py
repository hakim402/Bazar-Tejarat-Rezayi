"""Public gates and exact, independent store publication on disposable PostgreSQL."""

import copy
import json
from decimal import Decimal
from datetime import date, datetime, timezone
from unittest.mock import patch
from uuid import uuid4
from django.core.exceptions import SuspiciousFileOperation
from django.core.files.storage.handler import InvalidStorageError
from django.contrib.auth.models import Group, Permission
from django.core.exceptions import ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.files.storage import storages
from django.http import Http404, QueryDict
from django.test import TestCase, TransactionTestCase, override_settings
from django.test.utils import CaptureQueriesContext
from django.db import connection, transaction, DatabaseError, close_old_connections
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError as Invalid
from rest_framework.test import APIClient
from apps.marketplace import queries, services, validation
from apps.marketplace.models import Store, StoreEvent, StoreRevision
from apps.organizations.access import Conflict
from apps.organizations.models import BusinessProfile, Membership
from apps.verification.models import ReviewCase, Evidence
from apps.accounts.models import User
from apps.organizations.access import Actor
from types import SimpleNamespace
from apps.catalogue.models import Product, ProductImage, Variant
from apps.catalogue import services as catalogue
from apps.catalogue.media import upload
from tests.test_catalogue import CatalogueFixture, image_file
from tests.test_inventory import StockFixture, command
from tests.test_staff_admin import admin_signin, admin_post


class MarketplaceTests(CatalogueFixture, TestCase):
    def setUp(self):
        super().setUp()
        ReviewCase.objects.filter(profile=self.profile).update(snapshot={"display_name": "Reviewed identity", "contact_phone": "PRIVATE-SNAPSHOT"})
        group = Group.objects.create(name="Synthetic store reviewer")
        group.permissions.set(Permission.objects.filter(content_type__app_label="marketplace"))
        self.reviewer.user.groups.add(group)
        self.payload = {"source_locale": "fa-AF", "editions": {"fa-AF": {"description": "Reviewed store description", "logo_alt": "", "banner_alt": ""}}, "country": "Afghanistan", "city": "Kabul", "logo": None, "banner": None}

    def draft(self, body=None):
        store = Store.objects.filter(pk=self.profile.pk).first()
        result = services.save(self.seller, self.profile.pk, {"version": store.version if store else 0, "body": body or self.payload})
        return result.revisions.order_by("-number").first()

    def submit_store(self, revision):
        store = Store.objects.get(pk=self.profile.pk)
        services.seller_action(self.seller, self.profile.pk, {"version": store.version, "revision": revision.pk, "action": "submit"})

    def decide(self, revision, action, **extra):
        store = Store.objects.get(pk=self.profile.pk)
        return services.review(self.reviewer, revision.pk, {"version": store.version, "action": action, "reason": "Synthetic decision", **extra})

    def approve_store(self, revision):
        self.submit_store(revision)
        self.decide(revision, "assign", assigned_to=self.reviewer.account.pk)
        self.decide(revision, "approve")

    def test_minimal_empty_store_identity_and_no_public_writes(self):
        gate = queries.PublicGate("en")
        before = (Store.objects.count(), StoreRevision.objects.count(), StoreEvent.objects.count())
        value = gate.store(self.profile.pk)
        self.assertEqual(value["name"], "Reviewed identity")
        self.assertEqual(value["product_count"], 0)
        self.assertEqual(value["description"], "")
        self.assertNotIn("PRIVATE", json.dumps(value))
        self.assertNotIn(self.seller.user.email, json.dumps(value))
        self.assertEqual(before, (Store.objects.count(), StoreRevision.objects.count(), StoreEvent.objects.count()))

    def test_store_exact_revision_retention_rejection_moderation_and_stale(self):
        revision = self.draft()
        self.assertEqual(queries.PublicGate("en").store(self.profile.pk)["description"], "")
        self.approve_store(revision)
        self.assertTrue(queries.PublicGate("en").store(self.profile.pk)["source_fallback"])
        changed = copy.deepcopy(self.payload)
        changed["editions"]["fa-AF"]["description"] = "Pending private text"
        pending = self.draft(changed)
        self.submit_store(pending)
        self.assertEqual(queries.PublicGate("en").store(self.profile.pk)["description"], "Reviewed store description")
        self.decide(pending, "assign", assigned_to=self.reviewer.account.pk)
        self.decide(pending, "reject")
        self.assertNotIn("Pending private text", json.dumps(queries.PublicGate("en").home()))
        store = Store.objects.get(pk=self.profile.pk)
        events = StoreEvent.objects.count()
        with self.assertRaises(Conflict):
            services.save(self.seller, self.profile.pk, {"version": store.version - 1, "body": changed})
        self.assertEqual(StoreEvent.objects.count(), events)
        self.decide(revision, "withdraw_content")
        self.assertEqual(queries.PublicGate("en").store(self.profile.pk)["description"], "")
        revision.refresh_from_db()
        self.assertEqual(revision.body, self.payload)
        self.assertEqual(revision.state, "withdrawn")
        self.assertEqual(revision.reason, "Synthetic decision")

    def test_assignment_fresh_groups_independence_and_generic_crud_denied(self):
        revision = self.draft()
        self.submit_store(revision)
        with self.assertRaises(PermissionDenied):
            self.decide(revision, "approve")
        self.decide(revision, "assign", assigned_to=self.reviewer.account.pk)
        self.reviewer.user.groups.clear()
        with self.assertRaises(PermissionDenied):
            self.decide(revision, "approve")
        with self.assertRaises(ValidationError):
            StoreRevision.objects.filter(pk=revision.pk).update(state="approved")
        with self.assertRaises(ValidationError):
            revision.delete()
        revision.body["city"] = "Changed"
        with self.assertRaises(ValidationError):
            services.persist(revision)

    def test_uploaded_media_is_private_and_retained(self):
        media, store = services.upload(self.seller, self.profile.pk, 0, image_file())
        with self.assertRaises((Http404, NotFound)):
            queries.public_media(media.pk)
        self.assertTrue(storages[media.storage_alias].exists(media.key))

    def test_media_rejects_active_content_cross_store_and_withdrawn_references(self):
        for file in [SimpleUploadedFile("bad.svg", b'<svg onload="alert(1)"/>', content_type="image/svg+xml"), SimpleUploadedFile("fake.jpg", b"not an image", content_type="image/jpeg")]:
            with self.assertRaises(Invalid):
                services.upload(self.seller, self.profile.pk, 0, file)
        media, _ = services.upload(self.seller, self.profile.pk, 0, image_file())
        other = self.actor("seller", "other-store")
        profile = BusinessProfile.objects.create(account=other.account, kind="individual", display_name="Other")
        ReviewCase.objects.create(profile=profile, snapshot={"display_name": "Other"}, status="approved")
        payload = copy.deepcopy(self.payload)
        payload["logo"] = str(media.pk)
        payload["editions"]["fa-AF"]["logo_alt"] = "Copied logo"
        with self.assertRaises(Invalid):
            services.save(other, profile.pk, {"version": 0, "body": payload})
        body = copy.deepcopy(self.payload)
        body["logo"] = str(media.pk)
        body["editions"]["fa-AF"]["logo_alt"] = "Safe logo"
        revision = self.draft(body)
        self.approve_store(revision)
        self.assertEqual(queries.public_media(media.pk).pk, media.pk)
        self.decide(revision, "withdraw_content")
        with self.assertRaises((Http404, NotFound)):
            queries.public_media(media.pk)
        self.assertTrue(storages[media.storage_alias].exists(media.key))

    def test_published_product_prices_stock_and_shared_eligibility(self):
        self.publish(self.save())
        gate = queries.PublicGate("en")
        filters = validation.query(QueryDict("currency=AFN&tier=retail&min_price=12.50&availability=unknown"))
        value = gate.products_page(filters)
        self.assertEqual(value["count"], 1)
        self.assertEqual(value["results"][0]["variants"][0]["retail"], "12.50")
        self.assertEqual(value["results"][0]["variants"][0]["availability"], "unknown")
        self.assertEqual(gate.products_page(validation.query(QueryDict("availability=available")))["count"], 0)
        Variant.objects.filter(product=self.product).update(retail=Decimal("9.25"))
        self.assertEqual(queries.PublicGate("en").product(self.product.pk)["variants"][0]["retail"], "9.25")
        self.seller.user.is_active = False
        self.seller.user.save(update_fields=["is_active"])
        self.assertEqual(queries.PublicGate("en").products_page(validation.query(QueryDict()))["count"], 0)
        self.assertEqual(APIClient().get(f"/api/v1/catalogue/images/{self.image.pk}/").status_code, 404)

    def test_query_vocabulary_and_pagination(self):
        self.publish(self.save())
        for query in ("page=0", "page=10001", "page=1&page=2", "currency=EUR", "min_price=1e2", "sort=price_asc", "internal=true", "q=%00", "max_price=-1"):
            with self.subTest(query=query), self.assertRaises(Invalid):
                validation.query(QueryDict(query))
        result = queries.PublicGate("en").products_page(validation.query(QueryDict("page=10000")))
        self.assertEqual((result["results"], result["count"], result["page"]), ([], 1, 10000))
        for text in ("contact@example.test", "+93700000000", "<b>text</b>", "https://example.test"):
            body = copy.deepcopy(self.payload)
            body["city"] = text
            with self.assertRaises(Invalid):
                validation.body(body)

    def test_api_allowlists_failures_and_four_locales(self):
        self.publish(self.save())
        client = APIClient()
        for locale in ("fa-AF", "en", "ps", "ar"):
            response = client.get(f"/api/v1/marketplace/public/{locale}/products/")
            self.assertEqual(response.status_code, 200, response.content)
            self.assertIn("no-store", response["Cache-Control"])
            self.assertNotIn("PRIVATE", response.content.decode())
            self.assertNotIn("storage_alias", response.content.decode())
        self.assertEqual(client.get("/api/v1/marketplace/public/fr/products/").status_code, 404)
        self.assertEqual(client.get("/api/v1/marketplace/public/en/products/?currency=AFN&currency=USD").status_code, 400)
        with patch("apps.marketplace.queries.PublicGate.home", side_effect=OSError("private")):
            response = client.get("/api/v1/marketplace/public/en/home/")
            self.assertEqual(response.status_code, 503)
            self.assertNotIn("private", response.content.decode())

    def test_page_hydration_query_growth_is_bounded(self):
        self.publish(self.save())
        with CaptureQueriesContext(connection) as single:
            queries.PublicGate("en").products_page(validation.query(QueryDict()))
        company = BusinessProfile.objects.create(account=self.seller.account, kind="company", display_name="Synthetic second store")
        Membership.objects.create(company=company, account=self.seller.account, is_owner=True, bundles=["catalogue"])
        ReviewCase.objects.create(profile=company, snapshot={"display_name": "Reviewed second store"}, status="approved")
        empty_actor = self.actor("seller", "empty-growth")
        empty = BusinessProfile.objects.create(account=empty_actor.account, kind="individual", display_name="Synthetic empty")
        ReviewCase.objects.create(profile=empty, snapshot={"display_name": "Reviewed empty store"}, status="approved")
        for index in range(44):
            result = catalogue.create(self.seller, {"seller": company.pk if index % 2 else self.profile.pk, "currency": "USD" if index % 2 else "AFN", "pricing_mode": "fixed"})
            self.product = Product.objects.get(pk=result["id"])
            uploaded = upload(self.seller, self.product.pk, self.product.version, image_file())
            self.image = ProductImage.objects.get(pk=uploaded["id"])
            self.body["images"] = [{"id": str(self.image.pk), "alt": "Safe synthetic image", "variant": None}]
            self.publish(self.save())
        with CaptureQueriesContext(connection) as many:
            result = queries.PublicGate("en").products_page(validation.query(QueryDict()))
        self.assertEqual((result["count"], len(result["results"])), (45, 20))
        self.assertLessEqual(len(many), len(single) + 2)
        print(f"Marketplace query bound: one-product/one-store={len(single)}; 45-products/three-stores={len(many)}; page hydration<=20 products.")
        buyer = self.actor("buyer", "nostore")
        BusinessProfile.objects.create(account=buyer.account, kind="business", display_name="Private buyer")
        self.assertEqual(queries.PublicGate("en").stores_page(validation.query(QueryDict(), scope="stores"))["count"], 3)

    def public_evidence(self, profile, key):
        return Evidence.objects.create(
            case=ReviewCase.objects.get(profile=profile, revision=profile.revision),
            category="identity", storage_alias="private_local", key=key,
            content_type="image/jpeg", size=1, sha256="0" * 64,
        )

    def scoped_public_paths(self, locale="en"):
        base = f"/api/v1/marketplace/public/{locale}"
        return [f"{base}/products/{self.product.pk}/", f"{base}/stores/{self.profile.pk}/",
                f"{base}/stores/{self.profile.pk}/products/",
                f"/api/v1/catalogue/published/{locale}/{self.product.pk}/",
                f"/api/v1/catalogue/images/{self.image.pk}/"]

    def test_scoped_reads_ignore_unrelated_evidence_storage_failures(self):
        self.publish(self.save())
        self.public_evidence(self.profile, "SYNTHETIC-OWN-EVIDENCE")
        other = self.actor("seller", "unrelated-storage")
        profile = BusinessProfile.objects.create(account=other.account, kind="individual", display_name="Unrelated seller")
        ReviewCase.objects.create(profile=profile, snapshot={}, status="approved")
        self.public_evidence(profile, "SYNTHETIC-UNRELATED-EVIDENCE")
        client = APIClient()
        for error in (OSError, SuspiciousFileOperation, InvalidStorageError):
            def exists(key):
                if key == "SYNTHETIC-UNRELATED-EVIDENCE":
                    raise error("PRIVATE-UNRELATED-FAILURE")
                return True
            for path in self.scoped_public_paths():
                with self.subTest(error=error.__name__, path=path), patch.object(storages["private_local"], "exists", side_effect=exists) as storage:
                    response = client.get(path)
                    try:
                        self.assertEqual(response.status_code, 200)
                        self.assertEqual([call.args[0] for call in storage.call_args_list], ["SYNTHETIC-OWN-EVIDENCE"])
                        if not response.streaming:
                            self.assertNotIn("PRIVATE", response.content.decode())
                    finally:
                        if response.streaming:
                            b"".join(response.streaming_content)

    def test_scoped_storage_work_stays_bounded_as_unrelated_sellers_grow(self):
        self.publish(self.save())
        self.public_evidence(self.profile, "SYNTHETIC-OWN-EVIDENCE")
        reads = [lambda: list(queries.PublicGate("en").filtered_products(validation.query(QueryDict()), seller_id=self.profile.pk)),
                 lambda: queries.PublicGate("en").product(self.product.pk),
                 lambda: queries.PublicGate("en").store(self.profile.pk),
                 lambda: queries.PublicGate("en").products_page(validation.query(QueryDict()), seller_id=self.profile.pk)]
        for size in (0, 12):
            if size:
                for index in range(size):
                    actor = self.actor("seller", f"unrelated-growth-{index}")
                    profile = BusinessProfile.objects.create(account=actor.account, kind="individual", display_name="Unrelated seller")
                    ReviewCase.objects.create(profile=profile, snapshot={}, status="approved")
                    for number in range(3):
                        self.public_evidence(profile, f"SYNTHETIC-UNRELATED-{index}-{number}")
            for read in reads:
                with self.subTest(unrelated_sellers=size), patch.object(storages["private_local"], "exists", return_value=True) as storage:
                    read()
                    self.assertEqual([call.args[0] for call in storage.call_args_list], ["SYNTHETIC-OWN-EVIDENCE"])
        client = APIClient()
        for locale in ("fa-AF", "en", "ps", "ar"):
            for path in self.scoped_public_paths(locale)[:3]:
                with self.subTest(locale=locale, path=path), patch.object(storages["private_local"], "exists", return_value=True) as storage:
                    response = client.get(path)
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(storage.call_count, 1)

    def test_scoped_reads_keep_own_evidence_missing_and_unavailable_denials(self):
        self.publish(self.save())
        self.public_evidence(self.profile, "SYNTHETIC-OWN-EVIDENCE")
        client = APIClient()
        for result, expected in ((False, 404), (OSError("PRIVATE-FAILURE"), 503),
                                 (SuspiciousFileOperation("PRIVATE-FAILURE"), 503),
                                 (InvalidStorageError("PRIVATE-FAILURE"), 503)):
            for path in self.scoped_public_paths():
                with self.subTest(expected=expected, path=path), patch.object(
                    storages["private_local"], "exists", **({"side_effect": result} if isinstance(result, Exception) else {"return_value": result})
                ):
                    response = client.get(path)
                    self.assertEqual(response.status_code, expected)
                    self.assertNotIn("PRIVATE-FAILURE", response.content.decode())

    def test_unknown_and_unpublished_resources_do_not_probe_other_evidence(self):
        self.public_evidence(self.profile, "SYNTHETIC-OWN-EVIDENCE")
        base = "/api/v1/marketplace/public/en"
        paths = [f"{base}/products/{uuid4()}/", f"{base}/stores/{uuid4()}/",
                 f"{base}/stores/{uuid4()}/products/", f"{base}/products/{self.product.pk}/"]
        for path in paths:
            with self.subTest(path=path), patch.object(storages["private_local"], "exists", side_effect=OSError("PRIVATE-FAILURE")) as storage:
                self.assertEqual(APIClient().get(path).status_code, 404)
                storage.assert_not_called()

    def test_current_business_case_binds_optional_details_and_evidence_failure(self):
        revision = self.draft()
        self.approve_store(revision)
        self.profile.revision += 1
        self.profile.save()
        self.assertFalse(queries.PublicGate("en").profiles.filter(pk=self.profile.pk).exists())
        ReviewCase.objects.create(profile=self.profile, revision=self.profile.revision, snapshot={"display_name": "New approved identity"}, status="approved")
        current = queries.PublicGate("en").store(self.profile.pk)
        self.assertEqual(current["name"], "New approved identity")
        self.assertEqual(current["description"], "")
        self.assertIsNone(current["logo"])
        case = ReviewCase.objects.get(profile=self.profile, revision=self.profile.revision)
        Evidence.objects.create(case=case, category="identity", storage_alias="private_local", key="PRIVATE-MISSING-EVIDENCE", content_type="image/jpeg", size=1, sha256="0" * 64)
        self.assertFalse(queries.PublicGate("en").profiles.filter(pk=self.profile.pk).exists())

    def test_feature_is_explicit_unique_versioned_and_cannot_bypass_eligibility(self):
        self.assertIsNone(queries.PublicGate("en").home()["featured_store"])
        owner = User.objects.create_superuser("synthetic-curator@example.test", "Synthetic-Unused-7!", display_name="Synthetic curator", email_verified=True)
        actor = Actor(SimpleNamespace(user=owner, account=None), "owner")
        featured = services.feature(actor, self.profile.pk, 0, "Synthetic explicit placement")
        self.assertEqual(queries.PublicGate("en").home()["featured_store"]["id"], str(self.profile.pk))
        with self.assertRaises(Conflict):
            services.feature(actor, self.profile.pk, 0, "Repeated stale placement")
        with self.assertRaises(PermissionDenied):
            services.feature(self.reviewer, self.profile.pk, featured.version, "Not owner")
        self.seller.user.is_active = False
        self.seller.user.save()
        self.assertIsNone(queries.PublicGate("en").home()["featured_store"])

    def test_company_owner_scope_and_historical_reviewer_conflicts(self):
        self.profile.kind = "company"
        self.profile.save()
        Membership.objects.create(company=self.profile, account=self.seller.account, is_owner=True)
        delegate = self.actor("seller", "delegate")
        membership = Membership.objects.create(company=self.profile, account=delegate.account, bundles=["catalogue", "fulfilment"])
        self.assertFalse(queries.private_store(delegate, self.profile.pk)["can_edit"])
        with self.assertRaises(PermissionDenied):
            services.save(delegate, self.profile.pk, {"version": 0, "body": self.payload})
        revision = self.draft()
        self.submit_store(revision)
        Membership.objects.create(company=self.profile, account=self.reviewer.account, active=False)
        with self.assertRaises(PermissionDenied):
            self.decide(revision, "assign", assigned_to=self.reviewer.account.pk)
        membership.active = False
        membership.save()
        with self.assertRaises((Http404, NotFound)):
            queries.private_store(delegate, self.profile.pk)

    def test_unicode_search_only_approved_content_and_optional_location(self):
        self.body["title"] = "Ｓｙｎｔｈｅｔｉｃ   محصول"
        published = self.save()
        self.publish(published)
        self.assertEqual(queries.PublicGate("en").products_page(validation.query(QueryDict("q=Synthetic+محصول")))["count"], 1)
        pending = copy.deepcopy(published.body)
        pending["title"] = "PRIVATE-DRAFT-MARKER"
        self.save(pending)
        for query in ("q=PRIVATE-DRAFT-MARKER", "q=PRIVATE-CONTACT", "city=Kabul"):
            self.assertEqual(queries.PublicGate("en").products_page(validation.query(QueryDict(query)))["count"], 0)
        self.approve_store(self.draft())
        self.assertEqual(queries.PublicGate("en").products_page(validation.query(QueryDict("city=Kabul")))["count"], 1)

    def test_raw_sql_cannot_rewrite_media_revision_or_audit(self):
        revision = self.draft()
        for sql, params in [("UPDATE marketplace_storerevision SET body='{}'::jsonb WHERE id=%s", [revision.pk]), ("DELETE FROM marketplace_storeevent WHERE store_id=%s", [self.profile.pk])]:
            with self.assertRaises(DatabaseError), transaction.atomic():
                connection.cursor().execute(sql, params)

    @override_settings(OWNER_MFA_REQUIRED=False)
    def test_native_admin_review_stale_revocation_and_generic_post(self):
        revision = self.draft()
        self.submit_store(revision)
        self.decide(revision, "assign", assigned_to=self.reviewer.account.pk)
        self.grants.stop()
        client = APIClient(enforce_csrf_checks=True)
        admin_signin(client, self.reviewer.user)
        path = f"/admin/marketplace/storerevision/{revision.pk}/review/"
        response = client.get(path)
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Reviewed store description")
        version = Store.objects.get(pk=self.profile.pk).version
        response = admin_post(client, path, {"version": version - 1, "action": "approve", "reason": "Retain stale input"})
        self.assertEqual(response.status_code, 409)
        self.assertContains(response, "Retain stale input", status_code=409)
        response = admin_post(client, path, {"version": version, "action": "approve", "reason": "Synthetic independent decision"})
        self.assertEqual(response.status_code, 302)
        self.assertEqual(Store.objects.get(pk=self.profile.pk).published_id, revision.pk)
        self.assertEqual(admin_post(client, f"/admin/marketplace/storerevision/{revision.pk}/change/", {"state": "approved"}).status_code, 403)
        self.reviewer.user.groups.clear()
        self.assertIn(client.get(path).status_code, (403, 404))

    @override_settings(OWNER_MFA_REQUIRED=False)
    def test_native_root_reads_own_store_but_cannot_decide_it(self):
        revision = self.draft()
        self.submit_store(revision)
        user = self.seller.user
        user.is_staff = user.is_superuser = user.owner_authority = True
        user.save()
        self.grants.stop()
        client = APIClient(enforce_csrf_checks=True)
        admin_signin(client, user)
        path = f"/admin/marketplace/storerevision/{revision.pk}/review/"
        response = client.get(path)
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "An independent reviewer")
        version = Store.objects.get(pk=self.profile.pk).version
        for action in ['approve', 'reject', 'assign', 'withdraw_content']:
            self.assertEqual(admin_post(client, path, {'version': version, 'action': action, 'reason': 'Self decision forbidden'}).status_code, 403)
        self.assertIsNone(Store.objects.get(pk=self.profile.pk).published_id)


class MarketplaceStockTests(StockFixture, TestCase):
    def test_same_variant_price_and_stock_no_writes_and_kabul_expiry(self):
        first, second = self.variants
        Variant.objects.filter(pk=first.pk).update(retail=Decimal("1.00"))
        Variant.objects.filter(pk=second.pk).update(retail=Decimal("99.00"))
        self.configure(first)
        self.configure(second)
        self.receive("10.000", second)
        from apps.inventory.models import Position, Operation, Movement
        before = (Position.objects.count(), Operation.objects.count(), Movement.objects.count())
        gate = queries.PublicGate("en")
        self.assertEqual(gate.products_page(validation.query(QueryDict("currency=AFN&tier=retail&max_price=2&availability=available")))["count"], 0)
        self.assertEqual(gate.products_page(validation.query(QueryDict("currency=AFN&tier=retail&min_price=90&availability=available")))["count"], 1)
        self.assertEqual(before, (Position.objects.count(), Operation.objects.count(), Movement.objects.count()))
        from apps.inventory import services as inventory
        third = first
        inventory.configure(self.seller, self.profile.pk, third.pk, command(version=Position.objects.get(pk=third.pk).version, tracking="batch", expiry_required=True, threshold="0"))
        now = datetime(2026, 10, 27, 12, tzinfo=timezone.utc)
        inventory.manual(self.seller, self.profile.pk, third.pk, command(version=Position.objects.get(pk=third.pk).version, quantity="5", batch_code="Synthetic-expiry", expires_on="2026-10-27"), now=now)
        with patch("apps.marketplace.queries.today", return_value=date(2026, 10, 27)):
            self.assertEqual(queries.PublicGate("en").product(self.product.pk)["variants"][0]["availability"], "available")
        with patch("apps.marketplace.queries.today", return_value=date(2026, 10, 28)):
            self.assertEqual(queries.PublicGate("en").product(self.product.pk)["variants"][0]["availability"], "unavailable")


class MarketplaceConcurrencyTests(CatalogueFixture, TransactionTestCase):
    def test_additive_replay_preserves_populated_catalogue_inventory_and_media(self):
        from django.db.migrations.executor import MigrationExecutor
        from apps.inventory import services as inventory
        from apps.foundation.storage import FileLocation
        self.publish(self.save())
        variant = Variant.objects.get(product=self.product)
        inventory.configure(self.seller, self.profile.pk, variant.pk, command(version=0, tracking="plain", expiry_required=False, threshold="0"))
        inventory.manual(self.seller, self.profile.pk, variant.pk, command(version=1, quantity="5"))
        tables = ["accounts_user", "accounts_account", "organizations_businessprofile", "verification_reviewcase", "catalogue_product", "catalogue_sourcerevision", "catalogue_variant", "catalogue_productimage", "inventory_position", "inventory_bucket", "inventory_operation", "inventory_movement"]
        def snapshot():
            with connection.cursor() as cursor:
                rows = {}
                for table in tables:
                    cursor.execute(f'SELECT to_jsonb(t) FROM "{table}" t ORDER BY to_jsonb(t)::text')
                    rows[table] = cursor.fetchall()
                cursor.execute("SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE 'inventory_%' ORDER BY tgname")
                rows["inventory_triggers"] = cursor.fetchall()
                return rows
        before = snapshot()
        with FileLocation(self.image.storage_alias, self.image.key).open() as file:
            image = file.read()
        try:
            MigrationExecutor(connection).migrate([("marketplace", None)])
            MigrationExecutor(connection).migrate([("marketplace", "0002_retained_history_guards")])
            self.assertEqual(snapshot(), before)
            with FileLocation(self.image.storage_alias, self.image.key).open() as file:
                self.assertEqual(file.read(), image)
        finally:
            executor = MigrationExecutor(connection)
            executor.migrate(executor.loader.graph.leaf_nodes())

    def test_concurrent_first_draft_serializes_and_rejects_stale_version(self):
        from concurrent.futures import ThreadPoolExecutor
        from threading import Barrier
        barrier = Barrier(2)
        payload = {"source_locale": "en", "editions": {"en": {"description": "Synthetic", "logo_alt": "", "banner_alt": ""}}, "country": "", "city": "", "logo": None, "banner": None}
        def save():
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                services.save(self.seller, self.profile.pk, {"version": 0, "body": payload})
                return "saved"
            except Conflict:
                return "stale"
            finally:
                close_old_connections()
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: save(), range(2)))
        self.assertCountEqual(results, ["saved", "stale"])
        self.assertEqual(StoreRevision.objects.count(), 1)
        self.assertEqual(StoreEvent.objects.count(), 1)
