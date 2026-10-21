"""Catalogue outcomes in an owned PostgreSQL database, without live providers."""

import copy
import io
import json
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from decimal import Decimal
from threading import Event
from types import SimpleNamespace
from unittest.mock import patch
from PIL import Image
from django.conf import settings
from django.http import Http404
from django.contrib.auth.models import Group, Permission
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.files.storage import storages
from django.core.management import call_command
from django.db import connection, connections, transaction
from django.db.migrations.executor import MigrationExecutor
from django.test import TestCase, TransactionTestCase, RequestFactory, override_settings
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError, NotFound
from rest_framework.test import APIClient
from apps.accounts.models import User, Account, Authenticator
from apps.organizations.access import Actor, Conflict
from apps.organizations.models import BusinessProfile, Membership
from apps.verification.models import ReviewCase
from apps.catalogue import services, translations, taxonomy, access
from apps.catalogue.contracts import CatalogueSave
from apps.catalogue.models import (
    Product,
    SourceRevision,
    ProductImage,
    Variant,
    Translation,
    TranslationJob,
    Category,
    PriceChange,
)
from apps.catalogue.queries import public, public_image
from apps.catalogue.media import upload, StorageUnavailable
from apps.catalogue.translation_provider import translate, provider_status
from tests.test_identity import PASSWORD, signin, post, code, ORIGIN
from config.testing import assert_owned_database


def image_file():
    buffer = io.BytesIO()
    Image.new("RGB", (64, 48), "blue").save(buffer, format="PNG")
    return SimpleUploadedFile("synthetic.png", buffer.getvalue(), content_type="image/png")


class CatalogueFixture:
    def setUp(self):
        call_command("setup_catalogue", verbosity=0)
        self.grants = patch("apps.organizations.access.get_grant", side_effect=lambda request, context: request.account)
        self.grants.start()
        self.addCleanup(self.grants.stop)
        self.seller = self.actor("seller", "seller")
        self.reviewer = self.actor("staff", "reviewer")
        group = Group.objects.create(name="Synthetic catalogue full")
        group.permissions.set(Permission.objects.filter(content_type__app_label="catalogue"))
        self.reviewer.account.permission_groups.add(group)
        self.profile = BusinessProfile.objects.create(
            account=self.seller.account,
            kind="individual",
            display_name="Synthetic seller",
            contact_phone="PRIVATE-CONTACT",
        )
        ReviewCase.objects.create(profile=self.profile, snapshot={}, status="approved")
        result = services.create(self.seller, {"seller": self.profile.pk, "currency": "AFN", "pricing_mode": "fixed"})
        self.product = Product.objects.get(pk=result["id"])
        uploaded = upload(self.seller, self.product.pk, self.product.version, image_file())
        self.product.refresh_from_db()
        self.image = ProductImage.objects.get(pk=uploaded["id"])
        self.body = {
            "title": "Synthetic product",
            "description": "Synthetic reviewed source",
            "brand": "",
            "locale": "fa-AF",
            "category": "food",
            "attributes": {"grade": "A"},
            "variants": [
                {
                    "sku": "SYN-1",
                    "unit": "kg",
                    "increment": "0.125",
                    "minimum": "1.000",
                    "contents": "",
                    "attributes": {},
                    "active": True,
                    "retail": "12.50",
                    "wholesale": "10.00",
                }
            ],
            "images": [{"id": str(self.image.pk), "alt": "Synthetic safe image", "variant": None}],
        }

    def actor(self, context, name):
        user = User.objects.create_user(
            name + "@example.test", PASSWORD, display_name="Synthetic " + name, email_verified=True
        )
        account = Account.objects.create(user=user, context=context)
        return Actor(SimpleNamespace(user=user, account=account), context)

    def save(self, body=None):
        self.product.refresh_from_db()
        contract = CatalogueSave(data={"version": self.product.version, "body": body or self.body})
        contract.is_valid(raise_exception=True)
        value = services.save(self.seller, self.product.pk, contract.validated_data)
        return SourceRevision.objects.get(pk=value["revision"])

    def action(self, revision, action, actor=None, version=None):
        self.product.refresh_from_db()
        return services.transition(
            actor or (self.seller if action in {"submit", "withdraw"} else self.reviewer),
            self.product.pk,
            {
                "version": version or self.product.version,
                "revision": revision.pk,
                "action": action,
                "reason": "Synthetic decision",
            },
        )

    def publish(self, revision):
        self.action(revision, "submit")
        self.action(revision, "publish")

    def translation(self, revision, action, locale="en", version=1, **extra):
        current = Translation.objects.filter(revision=revision, locale=locale).first()
        if current and action in {"approve", "reject"}:
            extra = {
                "title": current.title,
                "description": current.description,
                "image_alts": current.image_alts,
                **extra,
            }
        return translations.edit(
            self.reviewer,
            self.product.pk,
            revision.pk,
            locale,
            {
                "version": version,
                "action": action,
                "title": "Synthetic translation",
                "description": "Synthetic translated text",
                "image_alts": {str(self.image.pk): "Synthetic translated image"},
                "reason": "Synthetic translation decision",
                **extra,
            },
        )


class CatalogueTests(CatalogueFixture, TestCase):
    def test_draft_and_image_private_publication_fresh_and_contact_private(self):
        revision = self.save()
        with self.assertRaises((NotFound, Http404)):
            public(self.product.pk, "en")
        with self.assertRaises((NotFound, Http404)):
            public_image(self.image.pk)
        self.publish(revision)
        value = public(self.product.pk, "en")
        self.assertTrue(value["source_fallback"])
        self.assertEqual(value["variants"][0]["retail"], "12.50")
        self.assertEqual(value["variants"][0]["wholesale"], "10.00")
        self.assertNotIn("PRIVATE-CONTACT", json.dumps(value, default=str))
        self.assertNotIn(self.seller.user.email, json.dumps(value, default=str))
        self.assertNotIn("storage_alias", json.dumps(value, default=str))
        self.assertEqual(public_image(self.image.pk).pk, self.image.pk)
        stream = APIClient().get(f"/api/v1/catalogue/images/{self.image.pk}/")
        self.assertEqual(stream.status_code, 200)
        self.assertNotIn(self.image.key, str(dict(stream.items())))
        self.assertNotIn(self.image.key.rsplit("/", 1)[-1], str(dict(stream.items())))
        self.assertIn(str(self.image.pk), stream["Content-Disposition"])
        self.assertTrue(b"".join(stream.streaming_content).startswith(b"\xff\xd8"))
        self.action(revision, "unpublish")
        with self.assertRaises((NotFound, Http404)):
            public_image(self.image.pk)
        self.assertTrue(SourceRevision.objects.filter(pk=revision.pk).exists())

    def test_replacement_keeps_approved_content_and_does_not_restore_price(self):
        first = self.save()
        self.publish(first)
        body = copy.deepcopy(first.body)
        body["title"] = "Private replacement"
        replacement = self.save(body)
        self.action(replacement, "submit")
        self.product.refresh_from_db()
        services.change_prices(
            self.seller,
            self.product.pk,
            {
                "version": self.product.version,
                "prices": [{"id": uuid.UUID(first.body["variants"][0]["id"]), "retail": "19.75", "wholesale": None}],
            },
        )
        self.assertEqual(public(self.product.pk, "en")["body"]["title"], first.body["title"])
        self.action(replacement, "publish")
        self.assertEqual(public(self.product.pk, "en")["body"]["title"], "Private replacement")
        self.assertEqual(public(self.product.pk, "en")["variants"][0]["retail"], "19.75")
        self.assertEqual(PriceChange.objects.count(), 2)
        self.assertNotIn("retail", replacement.body["variants"][0])

    def test_source_translation_exact_matching_and_price_change_no_jobs(self):
        source = self.save()
        self.publish(source)
        self.translation(source, "save")
        t = Translation.objects.get(revision=source, locale="en")
        self.translation(source, "approve", version=t.version)
        self.assertFalse(public(self.product.pk, "en")["source_fallback"])
        from apps.catalogue.models import CatalogueEvent

        decision = CatalogueEvent.objects.filter(action="translation_approve").latest("pk")
        self.assertIsNotNone(decision.translation_id)
        self.assertEqual(decision.translation_version, decision.translation.version)
        for locale in ("fa-AF", "ps", "ar"):
            self.assertEqual(public(self.product.pk, locale)["resolved_locale"], "fa-AF")
        replacement = self.save(source.body)
        self.publish(replacement)
        self.assertTrue(public(self.product.pk, "en")["source_fallback"])
        with self.assertRaises(Conflict):
            self.translation(source, "approve", version=t.version + 1)
        self.assertEqual(TranslationJob.objects.count(), 0)

    def test_all_source_languages_and_missing_translation_fallback(self):
        for locale in ("fa-AF", "en", "ps", "ar"):
            body = copy.deepcopy(self.body)
            if self.product.variants.exists():
                body["variants"] = copy.deepcopy(self.product.revisions.last().body["variants"])
            body["locale"] = locale
            revision = self.save(body)
            self.publish(revision)
            for requested in ("fa-AF", "en", "ps", "ar"):
                self.assertEqual(public(self.product.pk, requested)["resolved_locale"], locale)

    def test_numeric_rejection_no_rounding_and_no_partial_records(self):
        for value in ("NaN", "Infinity", "-1", "0", "1.001", "1000000000", "1e3", 12.5):
            with self.subTest(value=value):
                body = copy.deepcopy(self.body)
                body["variants"][0]["retail"] = value
                with self.assertRaises(ValidationError):
                    self.save(body)
                self.assertEqual(Variant.objects.count(), 0)
        body = copy.deepcopy(self.body)
        body["variants"][0]["minimum"] = "1.001"
        with self.assertRaises(ValidationError):
            self.save(body)
        body["variants"][0]["minimum"] = "1.0000"
        with self.assertRaises(ValidationError):
            self.save(body)

    def test_equivalent_decimal_variant_options_cannot_bypass_combination_uniqueness(self):
        category = Category.objects.get(pk="food")
        category.attributes = [{"code": "capacity", "labels": category.labels, "type": "decimal", "variant": True}]
        category.save()
        body = copy.deepcopy(self.body)
        body["attributes"] = {}
        body["variants"][0]["attributes"] = {"capacity": "1.0"}
        body["variants"].append({**body["variants"][0], "sku": "SYN-SECOND", "attributes": {"capacity": "1.000"}})
        with self.assertRaises(ValidationError):
            self.save(body)
        self.assertEqual(Variant.objects.count(), 0)

    def test_missing_and_zero_prices_are_distinct(self):
        body = copy.deepcopy(self.body)
        body["variants"][0]["retail"] = None
        revision = self.save(body)
        variant = Variant.objects.get(pk=revision.body["variants"][0]["id"])
        self.assertIsNone(variant.retail)
        self.assertEqual(variant.wholesale, Decimal("10.00"))
        self.product.refresh_from_db()
        with self.assertRaises(ValidationError):
            services.change_prices(
                self.seller,
                self.product.pk,
                {"version": self.product.version, "prices": [{"id": variant.pk, "retail": None, "wholesale": None}]},
            )
        variant.refresh_from_db()
        self.assertEqual(variant.wholesale, Decimal("10.00"))

    def test_invalid_category_attributes_combinations_unit_and_pack_contents(self):
        for mutation in ("unknown", "unit", "combo", "pack", "discrete", "wrong_type"):
            body = copy.deepcopy(self.body)
            if mutation == "unknown":
                body["attributes"] = {"bad": "x"}
            if mutation == "unit":
                body["variants"][0]["unit"] = "ml"
            if mutation == "combo":
                body["variants"].append({**body["variants"][0], "sku": "SYN-2"})
            if mutation == "pack":
                body["variants"][0]["unit"] = "pack"
            if mutation == "discrete":
                body["variants"][0]["unit"] = "piece"
            if mutation == "wrong_type":
                body["attributes"] = {"grade": False}
            with self.subTest(mutation=mutation), self.assertRaises(ValidationError):
                self.save(body)
        body = copy.deepcopy(self.body)
        body["category"] = "electronics"
        body["attributes"] = {"model": "M1"}
        body["variants"][0].update(unit="piece", increment="1", minimum="2", attributes={"condition": "new"})
        self.assertEqual(self.save(body).body["category"], "electronics")

    def test_schema_types_required_and_duplicate_validation(self):
        category = Category.objects.get(pk="food")
        category.attributes = [
            {"code": "grade", "labels": category.labels, "type": "enum", "choices": ["A"], "required": True},
            {"code": "organic", "labels": category.labels, "type": "boolean", "required": True},
        ]
        category.save()
        for values in ({}, {"grade": "B", "organic": True}, {"grade": "A", "organic": "yes"}):
            body = copy.deepcopy(self.body)
            body["attributes"] = values
            with self.assertRaises(ValidationError):
                self.save(body)
        body["attributes"] = {"grade": "A", "organic": False}
        self.assertEqual(self.save(body).body["attributes"]["organic"], False)

    def test_published_variant_definition_immutable_and_sku_never_recycled(self):
        revision = self.save()
        self.publish(revision)
        body = copy.deepcopy(revision.body)
        body["variants"][0]["unit"] = "g"
        with self.assertRaises(ValidationError):
            self.save(body)
        body = copy.deepcopy(self.body)
        with self.assertRaises(ValidationError):
            self.save(body)
        self.assertEqual(Variant.objects.count(), 1)

    def test_new_variant_private_until_approved_and_price_only_not_structural(self):
        body = copy.deepcopy(self.body)
        body["category"] = "clothing"
        body["attributes"] = {}
        body["variants"][0].update(unit="piece", increment="1", minimum="5", attributes={"size": "M", "color": "blue"})
        source = self.save(body)
        self.publish(source)
        body = copy.deepcopy(source.body)
        body["variants"].append(
            {
                "sku": "SYN-2",
                "unit": "piece",
                "increment": "1",
                "minimum": "5",
                "contents": "",
                "attributes": {"size": "L", "color": "blue"},
                "active": True,
                "retail": "20",
                "wholesale": "15",
            }
        )
        new = self.save(body)
        self.assertEqual(len(public(self.product.pk, "en")["variants"]), 1)
        self.publish(new)
        self.assertEqual(len(public(self.product.pk, "en")["variants"]), 2)

    def test_rejection_correction_withdraw_and_stale_versions(self):
        revision = self.save()
        self.action(revision, "submit")
        self.action(revision, "reject")
        revision.refresh_from_db()
        self.assertEqual(revision.state, "rejected")
        self.assertEqual(revision.reason, "Synthetic decision")
        correction = self.save(revision.body)
        self.action(correction, "submit")
        self.action(correction, "withdraw")
        with self.assertRaises(Conflict):
            self.action(correction, "publish")
        with self.assertRaises(Conflict):
            self.action(revision, "submit", version=1)

    def test_submitted_revision_remains_immutable_when_new_draft_saved(self):
        revision = self.save()
        self.action(revision, "submit")
        body = copy.deepcopy(revision.body)
        body["title"] = "New buffer"
        newer = self.save(body)
        revision.refresh_from_db()
        self.assertEqual(revision.body["title"], "Synthetic product")
        with self.assertRaises(Conflict):
            self.action(newer, "submit")
        self.action(revision, "publish")
        self.assertEqual(public(self.product.pk, "en")["body"]["title"], "Synthetic product")

    def test_unverified_suspended_or_missing_evidence_never_publish_or_read(self):
        revision = self.save()
        self.action(revision, "submit")
        ReviewCase.objects.filter(profile=self.profile).update(status="suspended")
        with self.assertRaises(PermissionDenied):
            self.action(revision, "publish")
        with self.assertRaises(PermissionDenied):
            self.save()
        with self.assertRaises((NotFound, Http404)):
            public(self.product.pk, "en")

    def test_seller_suspension_removes_published_visibility_and_images(self):
        source = self.save()
        self.publish(source)
        Account.objects.filter(pk=self.seller.account.pk).update(status="suspended")
        with self.assertRaises((NotFound, Http404)):
            public(self.product.pk, "en")
        with self.assertRaises((NotFound, Http404)):
            public_image(self.image.pk)
        with self.assertRaises(PermissionDenied):
            self.action(source, "unpublish", self.seller)

    def test_other_seller_and_self_review_denied(self):
        unrelated = self.actor("seller", "unrelated")
        with self.assertRaises((NotFound, Http404)):
            access.resource(unrelated, self.product.pk)
        source = self.save()
        self.action(source, "submit")
        self.profile.account = Account.objects.create(user=self.reviewer.user, context="seller")
        self.profile.save()
        with self.assertRaises(PermissionDenied):
            self.action(source, "publish")

    def test_company_bundle_revocation_next_operation(self):
        self.profile.kind = "company"
        self.profile.save()
        membership = Membership.objects.create(
            company=self.profile, account=self.seller.account, active=True, bundles=["catalogue"]
        )
        self.save()
        membership.bundles = []
        membership.save()
        with self.assertRaises((NotFound, Http404)):
            access.resource(self.seller, self.product.pk)
        with self.assertRaises(PermissionDenied):
            services.create(self.seller, {"seller": self.profile.pk, "currency": "AFN", "pricing_mode": "fixed"})

    def test_staff_permissions_scoped_to_catalogue(self):
        source = self.save()
        self.action(source, "submit")
        group = self.reviewer.account.permission_groups.first()
        group.permissions.clear()
        group.permissions.add(Permission.objects.get(content_type__app_label="verification", codename="decide_review"))
        with self.assertRaises(PermissionDenied):
            self.action(source, "publish")

    def test_taxonomy_cycle_deactivation_and_setup_preserves_values(self):
        row = taxonomy.taxonomy()["categories"][0]
        row["parent"] = None
        taxonomy.save_category(self.reviewer, row)
        category = Category.objects.get(pk=row["code"])
        category.labels["en"] = "Custom approved label"
        category.save()
        call_command("setup_catalogue", verbosity=0)
        category.refresh_from_db()
        self.assertEqual(category.labels["en"], "Custom approved label")
        row = taxonomy.taxonomy()["categories"][0]
        row["parent"] = row["code"]
        with self.assertRaises(ValidationError):
            taxonomy.save_category(self.reviewer, row)
        source = self.save()
        self.action(source, "submit")
        Category.objects.filter(pk="food").update(active=False)
        with self.assertRaises(ValidationError):
            self.action(source, "publish")
        self.assertTrue(SourceRevision.objects.filter(pk=source.pk).exists())

    def test_image_validation_metadata_and_no_direct_url(self):
        buffer = io.BytesIO()
        Image.new("RGB", (50, 50)).save(buffer, format="JPEG", exif=b"Exif\x00\x00PRIVATE")
        self.product.refresh_from_db()
        result = upload(
            self.seller, self.product.pk, self.product.version, SimpleUploadedFile("safe.jpg", buffer.getvalue())
        )
        image = ProductImage.objects.get(pk=result["id"])
        with storages[image.storage_alias].open(image.key, "rb") as file:
            self.assertNotIn(b"PRIVATE", file.read())
        for data in (b"<svg/>", b"<html/>", b"bad"):
            self.product.refresh_from_db()
            with self.assertRaises(ValidationError):
                upload(self.seller, self.product.pk, self.product.version, SimpleUploadedFile("x.jpg", data))
        with self.assertRaises(Exception):
            storages["catalogue_local"].url(self.image.key)

    def test_storage_failure_has_no_local_fallback_or_database_record(self):
        self.product.refresh_from_db()
        version = self.product.version
        with patch.object(storages["catalogue_local"], "save", side_effect=OSError("private-detail")):
            with self.assertRaises(StorageUnavailable):
                upload(self.seller, self.product.pk, version, image_file())
        self.product.refresh_from_db()
        self.assertEqual(self.product.version, version)
        self.assertEqual(ProductImage.objects.count(), 1)

    def test_database_failure_cleans_only_new_file(self):
        self.product.refresh_from_db()
        backend = storages["catalogue_local"]
        old = self.image.key
        with (
            patch("apps.catalogue.media.ProductImage.objects.create", side_effect=ValueError("db-failed")),
            patch.object(backend, "delete", wraps=backend.delete) as removed,
        ):
            with self.assertRaises(StorageUnavailable):
                upload(self.seller, self.product.pk, self.product.version, image_file())
            self.assertEqual(removed.call_count, 1)
            self.assertNotEqual(removed.call_args.args[0], old)
        self.assertTrue(backend.exists(old))

    def test_recorded_backend_switch_keeps_old_file_without_migration(self):
        from apps.foundation.storage import FileLocation
        from tempfile import TemporaryDirectory

        with TemporaryDirectory() as folder:
            configs = copy.deepcopy(settings.STORAGES)
            configs["catalogue_s3"] = {
                "BACKEND": "apps.foundation.storage.PrivateFileStorage",
                "OPTIONS": {"location": folder},
            }
            with override_settings(STORAGES=configs, CATALOGUE_STORAGE_ALIAS="catalogue_s3"):
                self.product.refresh_from_db()
                result = upload(self.seller, self.product.pk, self.product.version, image_file())
                new = ProductImage.objects.get(pk=result["id"])
                self.assertEqual(new.storage_alias, "catalogue_s3")
                with FileLocation(self.image.storage_alias, self.image.key).open() as old:
                    self.assertTrue(old.read(1))
                with FileLocation(new.storage_alias, new.key).open() as file:
                    self.assertTrue(file.read(1))
                self.assertEqual(self.image.storage_alias, "catalogue_local")

    def test_translation_disabled_durable_and_never_false_completed(self):
        source = self.save()
        self.publish(source)
        with (
            self.captureOnCommitCallbacks(execute=True),
            patch("apps.catalogue.tasks.generate_translation.apply_async", side_effect=OSError("broker-private")),
        ):
            self.translation(source, "generate")
        job = TranslationJob.objects.get(translation__revision=source, translation__locale="en")
        self.assertEqual(job.status, "blocked")
        self.assertEqual(job.error_code, "provider_disabled")
        self.assertEqual(provider_status(), "groq_unconfigured")
        self.assertEqual(Translation.objects.get(revision=source, locale="en").title, "")

    @override_settings(CATALOGUE_TRANSLATION_ADAPTER="deterministic", CATALOGUE_TRANSLATION_ENABLED=True)
    def test_translation_worker_idempotent_not_automatically_approved(self):
        source = self.save()
        self.publish(source)
        self.translation(source, "generate")
        job = TranslationJob.objects.get(translation__revision=source, translation__locale="en")
        translations.generate(job.pk)
        translations.generate(job.pk)
        job.refresh_from_db()
        self.assertEqual(job.status, "completed")
        self.assertEqual(job.attempts, 1)
        self.assertTrue(public(self.product.pk, "en")["source_fallback"])
        t = Translation.objects.get(revision=source, locale="en")
        self.translation(source, "approve", version=t.version)
        self.assertFalse(public(self.product.pk, "en")["source_fallback"])
        from apps.catalogue.models import CatalogueEvent

        decision = CatalogueEvent.objects.filter(action="translation_approve").latest("pk")
        self.assertIsNotNone(decision.translation_id)
        self.assertEqual(decision.translation_version, decision.translation.version)

    @override_settings(CATALOGUE_TRANSLATION_ADAPTER="deterministic", CATALOGUE_TRANSLATION_ENABLED=True)
    def test_translation_failure_retry_bounds_and_recovery(self):
        source = self.save()
        self.publish(source)
        self.translation(source, "generate")
        job = TranslationJob.objects.get(translation__revision=source, translation__locale="en")
        for attempt in range(3):
            TranslationJob.objects.filter(pk=job.pk).update(next_attempt_at=timezone.now() - timedelta(seconds=1))
            with patch("apps.catalogue.translations.translate", side_effect=OSError("provider-private")):
                translations.generate(job.pk)
        job.refresh_from_db()
        self.assertEqual(job.attempts, 3)
        self.assertEqual(job.status, "failed")
        self.assertEqual(job.error_code, "provider_failed")
        with self.assertRaises(Conflict):
            self.translation(source, "retry")

    @override_settings(CATALOGUE_TRANSLATION_ADAPTER="deterministic", CATALOGUE_TRANSLATION_ENABLED=True)
    def test_human_edits_and_new_source_make_queued_jobs_stale(self):
        source = self.save()
        self.publish(source)
        self.translation(source, "generate")
        job = TranslationJob.objects.get(translation__revision=source, translation__locale="en")
        self.translation(source, "save")
        translations.generate(job.pk)
        job.refresh_from_db()
        self.assertEqual(job.status, "stale")
        self.assertEqual(Translation.objects.get(revision=source, locale="en").title, "Synthetic translation")

    @override_settings(
        CATALOGUE_TRANSLATION_ENABLED=True,
        GROQ_API_KEY="synthetic-unit-test",
        GROQ_MODEL="synthetic-model",
        GROQ_DAILY_CALL_LIMIT=1,
        GROQ_DAILY_CHARACTER_LIMIT=10000,
        GROQ_TRANSLATION_LOCALES=("en",),
        CATALOGUE_TRANSLATION_ADAPTER="groq",
    )
    def test_groq_adapter_bounded_request_untrusted_response(self):
        response = SimpleNamespace(
            raise_for_status=lambda: None,
            iter_content=lambda size: iter(
                [
                    json.dumps(
                        {
                            "choices": [
                                {
                                    "message": {
                                        "content": json.dumps(
                                            {
                                                "title": "Safe",
                                                "description": "Safe text",
                                                "image_alts": {str(self.image.pk): "Safe alt"},
                                            }
                                        )
                                    }
                                }
                            ]
                        }
                    ).encode()
                ]
            ),
        )
        with patch("apps.catalogue.translation_provider.requests.post") as request:
            request.return_value.__enter__.return_value = response
            result = translate(self.body, "en")
            self.assertEqual(result["title"], "Safe")
            kwargs = request.call_args.kwargs
            self.assertEqual(kwargs["timeout"], (5, 20))
            self.assertNotIn("variants", kwargs["json"]["messages"][1]["content"])
        with self.assertRaises(RuntimeError):
            translate(self.body, "ps")

    @override_settings(
        CATALOGUE_TRANSLATION_ENABLED=True,
        GROQ_API_KEY="synthetic-unit-test",
        GROQ_MODEL="synthetic-model",
        GROQ_DAILY_CALL_LIMIT=1,
        GROQ_DAILY_CHARACTER_LIMIT=10000,
        GROQ_TRANSLATION_LOCALES=("en", "ps"),
        CATALOGUE_TRANSLATION_ADAPTER="groq",
    )
    def test_database_budget_reservations_bound_generation_and_retries(self):
        source = self.save()
        self.publish(source)
        self.translation(source, "generate", locale="en")
        first = TranslationJob.objects.get(translation__locale="en")
        output = {
            "title": "Synthetic generated",
            "description": "Synthetic generated body",
            "image_alts": {str(self.image.pk): "Synthetic generated alt"},
        }
        with patch("apps.catalogue.translations.translate", return_value=output) as provider:
            translations.generate(first.pk)
            translations.generate(first.pk)  # duplicate delivery cannot reserve another provider call
            self.translation(source, "generate", locale="ps")
            second = TranslationJob.objects.get(translation__locale="ps")
            translations.generate(second.pk)
            self.assertEqual(provider.call_count, 1)
        second.refresh_from_db()
        self.assertEqual(second.status, "blocked")
        self.assertEqual(second.error_code, "usage_limit")
        from apps.catalogue.models import TranslationBudget

        self.assertEqual(TranslationBudget.objects.get().calls, 1)

    def test_anonymous_api_csrf_and_upload_body_limits(self):
        self.grants.stop()
        client = APIClient(enforce_csrf_checks=True)
        self.assertEqual(client.get(f"/api/v1/catalogue/seller/products/{self.product.pk}/").status_code, 403)
        for image_id in (self.image.pk, uuid.uuid4()):
            self.assertEqual(client.get(f"/api/v1/catalogue/seller/images/{image_id}/").status_code, 403)
        response = client.post("/api/v1/catalogue/seller/products/", {}, format="json")
        self.assertEqual(response.status_code, 403)
        response = client.post(
            f"/api/v1/catalogue/seller/products/{self.product.pk}/images/",
            b"x",
            content_type="application/octet-stream",
            CONTENT_LENGTH=str(9 * 1024 * 1024),
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(ProductImage.objects.count(), 1)

    @override_settings(CATALOGUE_TRANSLATION_ADAPTER="deterministic", CATALOGUE_TRANSLATION_ENABLED=True)
    def test_broker_failure_leaves_queued_job_for_dispatch_recovery(self):
        source = self.save()
        with (
            self.captureOnCommitCallbacks(execute=True),
            patch(
                "apps.catalogue.tasks.generate_translation.apply_async", side_effect=OSError("synthetic broker failure")
            ),
        ):
            self.publish(source)
        job = TranslationJob.objects.get(translation__revision=source, translation__locale="en")
        self.assertEqual(job.status, "queued")
        with patch("apps.catalogue.tasks.generate_translation.apply_async") as enqueue:
            translations.dispatch()
            self.assertEqual(enqueue.call_count, 3)
        translations.generate(job.pk)
        job.refresh_from_db()
        self.assertEqual(job.status, "completed")

    @override_settings(CATALOGUE_TRANSLATION_ADAPTER="deterministic", CATALOGUE_TRANSLATION_ENABLED=True)
    def test_delayed_job_after_source_replacement_never_writes_translation(self):
        source = self.save()
        self.publish(source)
        self.translation(source, "generate")
        job = TranslationJob.objects.get(translation__revision=source, translation__locale="en")
        replacement = self.save(source.body)
        self.publish(replacement)
        translations.generate(job.pk)
        job.refresh_from_db()
        self.assertEqual(job.status, "stale")
        self.assertEqual(Translation.objects.get(pk=job.translation_id).title, "")
        self.assertEqual(TranslationJob.objects.filter(translation__revision=replacement).count(), 3)

    def test_oversize_dimensions_truncated_image_and_foreign_media_refused(self):
        for dimensions in ((6001, 32), (31, 40)):
            buffer = io.BytesIO()
            Image.new("RGB", dimensions).save(buffer, format="PNG")
            self.product.refresh_from_db()
            with self.assertRaises(ValidationError):
                upload(
                    self.seller,
                    self.product.pk,
                    self.product.version,
                    SimpleUploadedFile("synthetic.png", buffer.getvalue()),
                )
        buffer = io.BytesIO()
        Image.new("RGB", (128, 128)).save(buffer, format="JPEG")
        self.product.refresh_from_db()
        with self.assertRaises(ValidationError):
            upload(
                self.seller,
                self.product.pk,
                self.product.version,
                SimpleUploadedFile("truncated.jpg", buffer.getvalue()[:80]),
            )
        body = copy.deepcopy(self.body)
        body["images"][0]["id"] = str(uuid.uuid4())
        with self.assertRaises(ValidationError):
            self.save(body)
        self.assertEqual(ProductImage.objects.count(), 1)

    def test_translation_field_errors_and_ordinary_publication_save_guards(self):
        from django.core.exceptions import ValidationError as ModelValidationError

        source = self.save()
        self.publish(source)
        with self.assertRaises(ValidationError) as invalid:
            self.translation(source, "save", image_alts={str(self.image.pk): ""})
        self.assertIn("image_alts.0", invalid.exception.get_codes())
        self.translation(source, "save")
        translated = Translation.objects.get(revision=source, locale="en")
        with self.assertRaises(Conflict):
            self.translation(source, "approve", version=translated.version, title="UNSAVED TRANSLATION")
        self.assertTrue(public(self.product.pk, "en")["source_fallback"])
        translated.approved_body = {"title": "Bypass"}
        with self.assertRaises(ModelValidationError):
            translated.save()
        replacement = self.save(source.body)
        self.product.refresh_from_db()
        self.product.published = replacement
        with self.assertRaises(ModelValidationError):
            self.product.save()
        replacement.state = "published"
        with self.assertRaises(ModelValidationError):
            replacement.save()
        self.assertEqual(public(self.product.pk, "en")["revision"], source.pk)

    def test_owner_ordinary_save_and_bulk_actions_cannot_bypass_workflows(self):
        from apps.catalogue.admin import ProductAdmin, CategoryAdmin, ReviewForm
        from apps.catalogue.owner_copy import localize
        from unfold.widgets import UnfoldAdminSelectWidget, UnfoldAdminTextareaWidget
        from apps.accounts.admin import owner_site

        source = self.save()
        admin = ProductAdmin(Product, owner_site)
        self.assertFalse(admin.has_add_permission(self.reviewer.request))
        self.assertFalse(admin.has_delete_permission(self.reviewer.request, self.product))
        self.assertEqual(admin.actions, [])
        category_admin = CategoryAdmin(Category, owner_site)
        self.assertIn("units", category_admin.get_readonly_fields(self.reviewer.request))
        owner_form = ReviewForm()
        localize(owner_form, "fa-AF")
        self.assertIsInstance(owner_form.fields["revision"].widget, UnfoldAdminSelectWidget)
        self.assertIsInstance(owner_form.fields["reason"].widget, UnfoldAdminTextareaWidget)
        self.assertTrue(owner_form.fields["version"].widget.is_hidden)
        item = Product.objects.get(pk=self.product.pk)
        item.published = source
        admin.save_model(self.reviewer.request, item, None, True)
        self.product.refresh_from_db()
        self.assertIsNone(self.product.published_id)
        self.product.currency = "USD"
        from django.core.exceptions import ValidationError as ModelValidationError

        with self.assertRaises(ModelValidationError):
            self.product.save()
        source.body["title"] = "Attempted immutable edit"
        with self.assertRaises(ModelValidationError):
            source.save()

    def test_real_session_seller_and_staff_mfa_api_permissions(self):
        self.grants.stop()
        client = APIClient(enforce_csrf_checks=True)
        signin(client, "seller", self.seller.user.email)
        self.assertEqual(client.get(f"/api/v1/catalogue/seller/products/{self.product.pk}/").status_code, 200)
        staff = APIClient(enforce_csrf_checks=True)
        signin(staff, "staff", self.reviewer.user.email)
        self.assertEqual(staff.get("/api/v1/catalogue/staff/products/").status_code, 403)
        post(staff, "mfa/enroll/")
        post(staff, "mfa/challenge/", {"code": code(Authenticator.objects.get(user=self.reviewer.user))})
        self.assertEqual(staff.get("/api/v1/catalogue/staff/products/").status_code, 200)
        token = staff.get("/api/v1/auth/csrf/").json()["csrf_token"]
        response = staff.post(
            f"/api/v1/catalogue/staff/products/{self.product.pk}/",
            {},
            format="json",
            HTTP_X_CSRFTOKEN=token,
            HTTP_ORIGIN=ORIGIN,
        )
        self.assertEqual(response.status_code, 400)
        self.grants.start()


class CatalogueConcurrencyTests(CatalogueFixture, TransactionTestCase):
    def threaded(self, fn):
        try:
            assert_owned_database(connection)
            return fn()
        except Conflict:
            return "conflict"
        finally:
            connections.close_all()

    @override_settings(CATALOGUE_TRANSLATION_ADAPTER="deterministic", CATALOGUE_TRANSLATION_ENABLED=True)
    def test_competing_reviewers_publish_one_transition(self):
        source = self.save()
        self.action(source, "submit")
        self.product.refresh_from_db()
        version = self.product.version

        def decision():
            return services.transition(
                self.reviewer,
                self.product.pk,
                {"version": version, "revision": source.pk, "action": "publish", "reason": ""},
            )

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: self.threaded(decision), range(2)))
        self.assertEqual(sum(value == "conflict" for value in results), 1)
        self.assertEqual(self.product.events.filter(action="publish").count(), 1)
        self.assertEqual(TranslationJob.objects.filter(translation__revision=source).count(), 3)

    @override_settings(CATALOGUE_TRANSLATION_ADAPTER="deterministic", CATALOGUE_TRANSLATION_ENABLED=True)
    def test_human_edit_wins_against_running_provider(self):
        source = self.save()
        self.publish(source)
        self.translation(source, "generate")
        job = TranslationJob.objects.get(translation__revision=source, translation__locale="en")
        started, release = Event(), Event()

        def provider(body, target):
            started.set()
            self.assertTrue(release.wait(10))
            return {
                "title": "Delayed provider",
                "description": "Delayed text",
                "image_alts": {str(self.image.pk): "Delayed image"},
            }

        with (
            patch("apps.catalogue.translations.translate", side_effect=provider),
            ThreadPoolExecutor(max_workers=1) as pool,
        ):
            future = pool.submit(lambda: self.threaded(lambda: translations.generate(job.pk)))
            self.assertTrue(started.wait(10))
            self.translation(source, "save")
            release.set()
            future.result(timeout=10)
        job.refresh_from_db()
        self.assertEqual(job.status, "stale")
        self.assertEqual(Translation.objects.get(revision=source, locale="en").title, "Synthetic translation")

    def test_price_races_approval_retry_preserves_both_histories(self):
        source = self.save()
        self.publish(source)
        replacement = self.save(source.body)
        self.action(replacement, "submit")
        self.product.refresh_from_db()
        version = self.product.version
        variant = Variant.objects.get(product=self.product)

        def price():
            return services.change_prices(
                self.seller,
                self.product.pk,
                {"version": version, "prices": [{"id": variant.pk, "retail": "77.25", "wholesale": "65"}]},
            )

        def publish():
            return services.transition(
                self.reviewer,
                self.product.pk,
                {"version": version, "revision": replacement.pk, "action": "publish", "reason": ""},
            )

        with ThreadPoolExecutor(max_workers=2) as pool:
            a = pool.submit(self.threaded, price)
            b = pool.submit(self.threaded, publish)
            results = [a.result(), b.result()]
        self.assertEqual(results.count("conflict"), 1)
        if results[0] == "conflict":
            self.product.refresh_from_db()
            services.change_prices(
                self.seller,
                self.product.pk,
                {"version": self.product.version, "prices": [{"id": variant.pk, "retail": "77.25", "wholesale": "65"}]},
            )
        else:
            self.action(replacement, "publish")
        self.assertEqual(public(self.product.pk, "en")["variants"][0]["retail"], "77.25")


class CatalogueMigrationTests(TransactionTestCase):
    def test_phase05_upgrade_preserves_accounts_and_content(self):
        assert_owned_database(connection)
        executor = MigrationExecutor(connection)
        latest = executor.loader.graph.leaf_nodes()
        try:
            executor.migrate([("catalogue", None)])
            user = User.objects.create_user("catalogue-upgrade@example.test", PASSWORD, email_verified=True)
            from apps.content.models import ContentItem, ContentRevision

            item = ContentItem.objects.create(key="phase-six-preserve", kind="article")
            revision = ContentRevision.objects.create(
                item=item, number=1, locale="fa-AF", payload={"title": "Preserved"}, author=user
            )
            password = user.password
            before = set(connection.introspection.table_names())
            MigrationExecutor(connection).migrate(latest)
            user.refresh_from_db()
            revision.refresh_from_db()
            self.assertEqual(user.password, password)
            self.assertEqual(revision.payload, {"title": "Preserved"})
            self.assertTrue(before.issubset(set(connection.introspection.table_names())))
        finally:
            MigrationExecutor(connection).migrate(latest)


@override_settings(CATALOGUE_TRANSLATION_ADAPTER="deterministic", CATALOGUE_TRANSLATION_ENABLED=True)
class CatalogueReviewFixTests(CatalogueFixture, TestCase):
    def test_publication_schedules_three_targets_after_commit_without_translation_permission(self):
        only_source = Group.objects.create(name="Synthetic source only")
        only_source.permissions.set(Permission.objects.filter(content_type__app_label="catalogue", codename="review_source"))
        self.reviewer.account.permission_groups.set([only_source])
        source = self.save()
        with patch("apps.catalogue.translations.enqueue") as enqueue:
            with self.captureOnCommitCallbacks(execute=True):
                self.publish(source)
                self.assertEqual(enqueue.call_count, 0)
                self.assertEqual(set(source.translations.values_list("locale", flat=True)), {"en", "ps", "ar"})
                self.assertEqual(TranslationJob.objects.count(), 3)
            self.assertEqual(enqueue.call_count, 3)
        self.assertTrue(public(self.product.pk, "en")["source_fallback"])
        with self.assertRaises(PermissionDenied):
            self.translation(source, "save")

    def test_all_source_languages_schedule_only_other_locales(self):
        for locale in ("fa-AF", "en", "ps", "ar"):
            body = copy.deepcopy(self.product.revisions.first().body if self.product.revisions.exists() else self.body)
            body["locale"] = locale
            source = self.save(body)
            self.publish(source)
            self.assertEqual(set(source.translations.values_list("locale", flat=True)), {"fa-AF", "en", "ps", "ar"} - {locale})
            self.assertEqual(TranslationJob.objects.filter(translation__revision=source).count(), 3)

    @override_settings(CATALOGUE_TRANSLATION_ADAPTER="groq", GROQ_API_KEY="synthetic", GROQ_MODEL="synthetic", GROQ_DAILY_CALL_LIMIT=3, GROQ_DAILY_CHARACTER_LIMIT=30000, GROQ_TRANSLATION_LOCALES=("fa-AF", "ps"))
    def test_configured_targets_exclude_source_and_do_not_call_provider_on_publication(self):
        with patch("apps.catalogue.translation_provider.requests.post") as provider:
            source = self.save()
            self.publish(source)
            self.assertEqual(list(source.translations.values_list("locale", flat=True)), ["ps"])
            provider.assert_not_called()

    def test_replacement_has_own_targets_preserves_previous_approval_and_prices_do_not_schedule(self):
        source = self.save()
        self.publish(source)
        self.translation(source, "save")
        self.translation(source, "approve", version=2)
        job = TranslationJob.objects.get(translation__revision=source, translation__locale="en")
        replacement = self.save({**source.body, "title": "New reviewed source"})
        self.assertEqual(public(self.product.pk, "en")["body"]["title"], "Synthetic translation")
        self.product.refresh_from_db()
        services.change_prices(self.seller, self.product.pk, {"version": self.product.version, "prices": [{"id": self.product.variants.get().pk, "retail": "27.00", "wholesale": None}]})
        self.assertEqual(TranslationJob.objects.count(), 3)
        self.publish(replacement)
        self.assertEqual(TranslationJob.objects.count(), 6)
        self.assertTrue(public(self.product.pk, "en")["source_fallback"])
        self.assertEqual(public(self.product.pk, "en")["variants"][0]["retail"], "27.00")
        translations.generate(job.pk)
        job.refresh_from_db()
        self.assertEqual(job.status, "stale")
        self.assertEqual(Translation.objects.get(revision=source, locale="en").approved_body["title"], "Synthetic translation")

    def test_repeated_scheduling_and_generate_keep_attempts_results_and_human_text(self):
        source = self.save()
        self.publish(source)
        job = TranslationJob.objects.get(translation__revision=source, translation__locale="en")
        translations.generate(job.pk)
        self.translation(source, "generate", version=2)
        self.product.refresh_from_db()
        with transaction.atomic():
            locked = Product.objects.select_for_update().get(pk=self.product.pk)
            translations.schedule_publication(locked, source)
        job.refresh_from_db()
        self.assertEqual(job.attempts, 1)
        self.assertEqual(job.status, "completed")
        self.assertEqual(TranslationJob.objects.count(), 3)
        self.translation(source, "save", version=2)
        self.translation(source, "approve", version=3)
        with transaction.atomic():
            translations.schedule_publication(Product.objects.select_for_update().get(pk=self.product.pk), source)
        self.assertEqual(Translation.objects.get(pk=job.translation_id).version, 4)
        self.assertEqual(TranslationJob.objects.count(), 3)
        with self.assertRaises(Conflict):
            self.action(source, "publish")

    def test_publication_rollback_does_not_leave_jobs_or_enqueue(self):
        source = self.save()
        with patch("apps.catalogue.translations.enqueue") as enqueue:
            with self.captureOnCommitCallbacks(execute=True):
                with self.assertRaises(RuntimeError), transaction.atomic():
                    self.publish(source)
                    raise RuntimeError("Synthetic rollback")
            enqueue.assert_not_called()
        self.assertFalse(TranslationJob.objects.exists())
        self.product.refresh_from_db()
        self.assertIsNone(self.product.published_id)

    @override_settings(CATALOGUE_TRANSLATION_ENABLED=False)
    def test_disabled_publication_no_jobs_explicit_request_blocked_then_retry(self):
        source = self.save()
        with patch("apps.catalogue.translation_provider.requests.post") as provider:
            self.publish(source)
            self.assertFalse(TranslationJob.objects.exists())
            self.translation(source, "generate")
            job = TranslationJob.objects.get()
            self.assertEqual(job.status, "blocked")
            with override_settings(CATALOGUE_TRANSLATION_ENABLED=True):
                self.translation(source, "retry")
                translations.generate(job.pk)
            provider.assert_not_called()
        job.refresh_from_db()
        self.assertEqual(job.status, "completed")
        self.assertEqual(job.translation.state, "draft")

    @override_settings(CATALOGUE_TRANSLATION_ADAPTER="groq")
    def test_unconfigured_publication_never_creates_intent(self):
        source = self.save()
        self.publish(source)
        self.assertEqual(provider_status(), "groq_unconfigured")
        self.assertFalse(TranslationJob.objects.exists())

    def test_price_paths_and_atomic_rollback_in_later_row(self):
        second = Variant.objects.create(product=self.product, sku="SYN-2", definition={}, unit_id="kg", quantity_increment="1", minimum_wholesale="1", retail="11", wholesale="9")
        source = self.save()
        self.publish(source)
        first = self.product.variants.get(sku="SYN-1")
        for values, expected, code_name in [
            ({"retail": "0", "wholesale": "9"}, "prices.1.retail", "positive"),
            ({"retail": "2", "wholesale": "0"}, "prices.1.wholesale", "positive"),
            ({"retail": None, "wholesale": None}, "prices.1", "one_price"),
            ({"retail": 12, "wholesale": None}, "prices.1.retail", "decimal"),
        ]:
            with self.subTest(expected=expected, code=code_name):
                self.product.refresh_from_db()
                previous = PriceChange.objects.count()
                with self.assertRaises(ValidationError) as invalid:
                    services.change_prices(self.seller, self.product.pk, {"version": self.product.version, "prices": [{"id": first.pk, "retail": "99", "wholesale": None}, {"id": second.pk, **values}]})
                self.assertEqual(invalid.exception.get_codes()[expected], [code_name])
                from apps.foundation.errors import validation_violations

                self.assertEqual(validation_violations(invalid.exception), [{"path": expected, "code": code_name}])
                first.refresh_from_db()
                self.assertEqual(str(first.retail), "12.50")
                self.assertEqual(PriceChange.objects.count(), previous)
        with self.assertRaises(ValidationError) as duplicate:
            services.change_prices(self.seller, self.product.pk, {"version": self.product.version, "prices": [{"id": first.pk, "retail": "2"}, {"id": first.pk, "retail": "3"}]})
        self.assertIn("prices.1", duplicate.exception.get_codes())

    def test_first_price_row_paths(self):
        self.save()
        self.product.refresh_from_db()
        for field in ("retail", "wholesale"):
            with self.assertRaises(ValidationError) as invalid:
                services.change_prices(self.seller, self.product.pk, {"version": self.product.version, "prices": [{"id": self.product.variants.get().pk, field: "0"}]})
            self.assertIn(f"prices.0.{field}", invalid.exception.get_codes())

    def owner_context(self, request):
        from apps.catalogue.admin import ProductAdmin
        from apps.accounts.admin import owner_site
        request.user, request.account = self.reviewer.user, self.reviewer.account
        with patch("apps.catalogue.admin.render", side_effect=lambda request, template, context: context), patch.object(owner_site, "each_context", return_value={}):
            return ProductAdmin(Product, owner_site).workflow(request, self.product.pk)

    def test_owner_initial_and_selected_versions_never_use_product_version(self):
        source = self.save()
        self.publish(source)
        self.translation(source, "save", locale="en")
        factory = RequestFactory()
        for target, version in (("en", 2), ("ps", 1)):
            context = self.owner_context(factory.get("/workflow/", {"translation": "1", "locale": "en", "revision": str(source.pk), "target": target}))
            self.assertEqual(context["form"].initial["version"], version)
            self.assertEqual(context["selection"]["target"].label, "Target language")
            self.assertTrue(context["form"].fields["version"].widget.is_hidden)
            self.assertEqual(str(context["form"].initial["revision"].pk), str(source.pk))
        replacement = self.save(source.body)
        context = self.owner_context(factory.get("/workflow/", {"translation": "1", "revision": str(replacement.pk), "target": "en"}))
        self.assertEqual(context["form"].initial["version"], 1)
        context = self.owner_context(factory.get("/workflow/"))
        self.product.refresh_from_db()
        self.assertEqual(context["form"].initial["version"], self.product.version)

    def test_owner_automatic_empty_draft_has_alt_placeholders_and_saves_with_loaded_token(self):
        source = self.save()
        self.publish(source)
        context = self.owner_context(RequestFactory().get("/workflow/", {"translation": "1", "locale": "en", "target": "en"}))
        initial = context["form"].initial
        self.assertEqual(initial["version"], 1)
        self.assertEqual(initial["image_alts"], {str(self.image.pk): ""})
        response = self.owner_context(RequestFactory().post("/workflow/?locale=en", {
            "form": "translation", "version": initial["version"], "revision": str(initial["revision"].pk),
            "locale": initial["locale"], "action": "save", "title": "Owner manual draft before worker",
            "description": "Synthetic owner description", "image_alts": json.dumps({str(self.image.pk): "Owner translated image"}),
        }))
        self.assertEqual(response.status_code, 302)
        translated = Translation.objects.get(revision=source, locale="en")
        self.assertEqual(translated.version, 2)
        self.assertTrue(translated.human_edited)
        job = TranslationJob.objects.get(translation=translated)
        translations.generate(job.pk)
        job.refresh_from_db()
        self.assertEqual(job.status, "stale")
        translated.refresh_from_db()
        self.assertEqual(translated.title, "Owner manual draft before worker")

    def test_owner_stale_post_retains_submitted_token_and_text(self):
        source = self.save()
        self.publish(source)
        self.translation(source, "save")
        context = self.owner_context(RequestFactory().post("/workflow/?locale=en", {"form": "translation", "version": "1", "revision": str(source.pk), "locale": "en", "action": "save", "title": "Retain my stale input", "description": "Retain description", "image_alts": json.dumps({str(self.image.pk): "Retain alt"})}))
        self.assertTrue(context["form"].non_field_errors())
        self.assertEqual(context["form"]["version"].value(), "1")
        self.assertIn("Your input is retained", str(context["form"].non_field_errors()))
        self.assertEqual(context["form"]["title"].value(), "Retain my stale input")
        self.assertEqual(Translation.objects.get(revision=source, locale="en").version, 2)
