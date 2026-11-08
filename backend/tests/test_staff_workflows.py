"""Native admin replacements exercise the existing guarded services and fixtures."""

import json
from django.contrib.auth.models import Permission
from django.test import TransactionTestCase, override_settings
from rest_framework.test import APIClient
from apps.accounts.models import AuditEvent
from apps.catalogue.models import Translation, Product, TranslationJob
from apps.verification.services import upload_evidence, application_action
from apps.organizations.profiles import create_profile, current_case
from tests.test_staff_admin import admin_signin, admin_post, role_user
from tests.test_organizations import identity, ServiceActor, profile_values, image_file
from tests.test_inventory import StockFixture
from tests.test_catalogue import CatalogueFixture


class VerificationAdminTests(TransactionTestCase):
    def setUp(self):
        self.user, self.account, self.group = role_user(
            "case-reviewer", "verification", ["view_queue", "assign_review", "read_evidence", "decide_review"]
        )
        self.client = APIClient(enforce_csrf_checks=True)
        admin_signin(self.client, self.user)
        actor = ServiceActor(identity("native-applicant"))
        self.profile = create_profile(actor, profile_values("individual"))
        upload_evidence(actor, self.profile.pk, image_file(), "identity", current_case(self.profile).version)
        self.case = application_action(
            actor, self.profile.pk, {"action": "submit", "version": current_case(self.profile).version}
        )
        self.path = f"/admin/verification/reviewcase/{self.case.pk}/workflow/"

    def test_assignment_decision_download_stale_revocation_and_unassigned_isolation(self):
        data = {
            "action": "assign",
            "assigned_to": str(self.account.pk),
            "version": self.case.version,
            "reason": "Synthetic independent assignment",
        }
        self.assertEqual(admin_post(self.client, self.path, data).status_code, 302)
        self.case.refresh_from_db()
        page = self.client.get(self.path)
        self.assertContains(page, "Synthetic Company")
        evidence = self.case.evidence.get()
        download = f"/admin/verification/evidence/{evidence.pk}/download/"
        self.assertEqual(self.client.get(download).status_code, 200)
        other, _, _ = role_user("other-reviewer", "verification", ["read_evidence", "decide_review"])
        other_client = APIClient(enforce_csrf_checks=True)
        admin_signin(other_client, other)
        self.assertEqual(other_client.get(self.path).status_code, 404)
        self.assertEqual(other_client.get(download).status_code, 404)
        decision = {"action": "approved", "version": self.case.version, "reason": "Synthetic reasoned approval"}
        self.assertContains(
            admin_post(self.client, self.path, {**decision, "version": self.case.version - 1}), "This record changed"
        )
        self.assertEqual(admin_post(self.client, self.path, decision).status_code, 302)
        self.case.refresh_from_db()
        self.assertEqual(self.case.status, "approved")
        self.assertTrue(
            AuditEvent.objects.filter(actor=self.user, context="staff", action="verification_approved").exists()
        )
        self.group.permissions.clear()
        self.assertIn(admin_post(self.client, self.path, decision).status_code, [403, 404])
        self.assertEqual(self.client.get(download).status_code, 404)


class CatalogueAdminTests(CatalogueFixture, TransactionTestCase):
    def test_native_source_translation_private_media_and_taxonomy_permissions(self):
        revision = self.save()
        self.action(revision, "submit")
        self.grants.stop()
        self.client = APIClient(enforce_csrf_checks=True)
        admin_signin(self.client, self.reviewer.user)
        path = f"/admin/catalogue/product/{self.product.pk}/workflow/"
        image = f"/admin/catalogue/productimage/{self.image.pk}/download/"
        self.assertEqual(self.client.get(image).status_code, 200)
        self.product.refresh_from_db()
        self.assertEqual(
            admin_post(
                self.client,
                path,
                {
                    "version": self.product.version,
                    "revision": str(revision.pk),
                    "action": "publish",
                    "reason": "Synthetic native source review",
                },
            ).status_code,
            302,
        )
        self.product.refresh_from_db()
        self.assertEqual(self.product.published_id, revision.pk)
        group = self.reviewer.user.groups.get()
        group.permissions.set(
            Permission.objects.filter(content_type__app_label="catalogue", codename="review_translation")
        )
        self.assertEqual(self.client.get(path).status_code, 302)
        selection = path + f"?translation=1&revision={revision.pk}&target=en"
        with override_settings(CATALOGUE_TRANSLATION_ENABLED=True, CATALOGUE_TEST_ADAPTER_ALLOWED=True,
                               CATALOGUE_TRANSLATION_ADAPTER="deterministic"):
            self.assertContains(self.client.get(selection), "Automatic draft provider enabled")
        with override_settings(CATALOGUE_TRANSLATION_ENABLED=False, CATALOGUE_TRANSLATION_ADAPTER="disabled"):
            self.assertContains(self.client.get(selection), "Automatic draft provider disabled")
        self.assertEqual(
            admin_post(
                self.client,
                path,
                {
                    "version": self.product.version,
                    "revision": str(revision.pk),
                    "action": "unpublish",
                    "reason": "Cannot gain source rights",
                },
            ).status_code,
            403,
        )
        trans = Translation.objects.filter(revision=revision, locale="en").first()
        data = {
            "form": "translation",
            "revision": str(revision.pk),
            "locale": "en",
            "version": trans.version if trans else 1,
            "action": "save",
            "title": "Native manual English",
            "description": "Synthetic translated description",
            "image_alts": json.dumps({str(self.image.pk): "Synthetic English image"}),
            "reason": "Synthetic manual draft",
        }
        self.assertEqual(admin_post(self.client, path + "?translation=1", data).status_code, 302)
        trans = Translation.objects.get(revision=revision, locale="en")
        self.assertEqual(
            admin_post(
                self.client, path + "?translation=1", {**data, "version": trans.version, "action": "approve"}
            ).status_code,
            302,
        )
        trans.refresh_from_db()
        self.assertEqual(trans.state, "approved")
        self.assertEqual(self.client.get("/admin/catalogue/category/food/workflow/").status_code, 403)
        group.permissions.set(
            Permission.objects.filter(content_type__app_label="catalogue", codename="manage_taxonomy")
        )
        self.assertEqual(self.client.get("/admin/catalogue/category/food/workflow/").status_code, 200)
        self.assertEqual(self.client.get(image).status_code, 404)
        self.assertEqual(self.client.get(path).status_code, 404)
        self.assertIsNotNone(Product.objects.get(pk=self.product.pk).published_id)
        self.assertGreaterEqual(TranslationJob.objects.count(), 0)


class StockAdminTests(StockFixture, TransactionTestCase):
    def test_shortage_projection_history_and_read_only_role(self):
        from apps.inventory import services
        from apps.inventory.models import Shortage

        self.configure()
        result = services.allocate(self.seller, self.profile.pk, self.allocation())
        shortage = Shortage.objects.get(pk=result["shortage"])
        self.grants.stop()
        user, _, group = role_user("stock-reader", "inventory", ["read_shortages"])
        client = APIClient(enforce_csrf_checks=True)
        admin_signin(client, user)
        path = f"/admin/inventory/shortage/{shortage.pk}/change/"
        page = client.get(path)
        self.assertContains(page, self.variant.sku)
        self.assertContains(page, "Requested")
        self.assertContains(page, "Available")
        self.assertNotContains(page, "PRIVATE-CONTACT")
        self.assertNotContains(page, 'name="_save"')
        self.assertEqual(admin_post(client, path, {"lines": "[]"}).status_code, 403)
        self.assertEqual(client.get("/admin/inventory/operation/").status_code, 403)
        self.assertEqual(client.get("/admin/inventory/shortage/?q=SYN&operation__action=reserve").status_code, 200)
        group.permissions.clear()
        self.assertEqual(client.get(path).status_code, 403)


class TransferAdminTests(TransactionTestCase):
    def test_native_transfer_review_stale_independence_and_actor_history(self):
        from apps.organizations.models import Membership
        from apps.organizations.transfers import request_transfer, transfer_action

        actor = ServiceActor(identity("native-transfer-owner"))
        company = create_profile(actor, profile_values("company"))
        recipient = identity("native-transfer-recipient")
        member = Membership.objects.create(company=company, account=recipient, bundles=["catalogue"])
        transfer = request_transfer(actor, company.pk, {"recipient": member.pk, "retained_bundles": []})
        transfer = transfer_action(
            ServiceActor(recipient), transfer.pk, {"action": "accept", "version": transfer.version}
        )
        user, _, _ = role_user("native-transfer-reviewer", "verification", ["review_transfer"])
        client = APIClient(enforce_csrf_checks=True)
        admin_signin(client, user)
        path = f"/admin/organizations/ownershiptransfer/{transfer.pk}/workflow/"
        self.assertEqual(client.get(path).status_code, 200)
        data = {"action": "approve", "version": transfer.version, "reason": "Synthetic independent transfer review"}
        response = admin_post(client, path, {**data, "version": transfer.version - 1})
        self.assertTrue(response.context["form"].errors)
        self.assertEqual(admin_post(client, path, data).status_code, 302)
        transfer.refresh_from_db()
        self.assertEqual(transfer.status, "approved")
        self.assertEqual(transfer.reviewer.user_id, user.pk)
        self.assertTrue(
            AuditEvent.objects.filter(
                resource_id=transfer.pk, actor=user, context="staff", action="ownership_transfer_approve"
            ).exists()
        )
        # A company participant with the same review permission remains ineligible.
        recipient.user.is_staff = True
        recipient.user.save()
        from apps.accounts.models import Account

        Account.objects.create(user=recipient.user, context="staff")
        recipient.user.groups.set(user.groups.all())
        conflicted = APIClient(enforce_csrf_checks=True)
        admin_signin(conflicted, recipient.user)
        self.assertEqual(conflicted.get(path).status_code, 404)


class TaxonomyCreationAdminTests(TransactionTestCase):
    def test_native_category_unit_creation_and_stale_update_need_only_explicit_taxonomy_role(self):
        from apps.catalogue.models import Category, SaleUnit

        user, _, _ = role_user("taxonomy-creation", "catalogue", ["manage_taxonomy"])
        client = APIClient(enforce_csrf_checks=True)
        admin_signin(client, user)
        labels = {f"label_{locale.lower().replace('-', '_')}": f"Synthetic unit {locale}" for locale in ["fa-AF", "ps", "ar", "en"]}
        unit = {
            "version": 0,
            "code": "synthetic-unit",
            **labels,
            "fractional": "on",
            "active": "on",
        }
        response = admin_post(client, "/admin/catalogue/saleunit/new/", unit)
        self.assertEqual(response.status_code, 302)
        self.assertTrue(SaleUnit.objects.filter(pk=unit["code"]).exists())
        category = {
            "version": 0,
            "code": "synthetic-category",
            **{f"label_{locale.lower().replace('-', '_')}": f"Synthetic category {locale}" for locale in ["fa-AF", "ps", "ar", "en"]},
            "parent": "",
            "attributes": "[]",
            "units": unit["code"],
            "active": "on",
        }
        response = admin_post(client, "/admin/catalogue/category/new/", category)
        self.assertEqual(response.status_code, 302)
        self.assertTrue(Category.objects.filter(pk=category["code"]).exists())
        response = admin_post(
            client, f"/admin/catalogue/category/{category['code']}/workflow/", category
        )
        self.assertTrue(response.context["form"].errors)
        self.assertContains(client.get("/admin/catalogue/category/"), "Create category")
        self.assertContains(client.get("/admin/catalogue/saleunit/"), "Create sale unit")
        self.assertEqual(client.get("/admin/catalogue/product/").status_code, 403)
