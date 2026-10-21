"""Editorial publication, privacy, versioning and permissions in owned PostgreSQL."""

from concurrent.futures import ThreadPoolExecutor
from django.db import connection, connections
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase
from config.testing import assert_owned_database
import copy
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import patch
from django.contrib.auth.models import Group, Permission
from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework.exceptions import ValidationError, PermissionDenied
from apps.accounts.models import User, Account, Authenticator
from apps.content.models import ContentItem, ContentRevision, Publication, ContentEvent
from apps.content.services import save, transition
from apps.content.queries import resolved
from apps.content.validation import payload
from apps.content.drafts import draft
from apps.organizations.access import Conflict
from tests.test_identity import PASSWORD, signin, post, code, ORIGIN


class ContentTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            "editor@example.test",
            PASSWORD,
            display_name="Synthetic editor",
            email_verified=True,
        )
        self.account = Account.objects.create(user=self.user, context="staff")
        self.group = Group.objects.create(name="Synthetic editor")
        self.group.permissions.set(
            Permission.objects.filter(content_type__app_label="content")
        )
        self.account.permission_groups.add(self.group)
        self.client = APIClient(enforce_csrf_checks=True)
        signin(self.client, "staff", self.user.email)
        post(self.client, "mfa/enroll/")
        post(
            self.client,
            "mfa/challenge/",
            {"code": code(Authenticator.objects.get(user=self.user))},
        )
        self.request = SimpleNamespace(user=self.user)
        self.item = ContentItem.objects.create(key="about", kind="page")
        self.base = "/api/v1/content/editor/staff/items/"

    def service_save(self, item=None, locale="fa-AF", value=None, source=None):
        item = item or self.item
        item.refresh_from_db()
        with patch("apps.content.services.get_grant", return_value=self.account):
            result = save(
                self.request,
                "staff",
                item.key,
                {
                    "version": item.version,
                    "locale": locale,
                    "source": source,
                    "payload": value or draft(item.key),
                },
            )
        item.refresh_from_db()
        return ContentRevision.objects.get(pk=result["revision"])

    def action(self, revision, action, context="staff", **extra):
        item = revision.item
        item.refresh_from_db()
        with patch("apps.content.services.get_grant", return_value=self.account):
            return transition(
                self.request,
                context,
                item.key,
                {
                    "version": item.version,
                    "revision": revision.pk,
                    "action": action,
                    "reason": "Synthetic editorial decision",
                    **extra,
                },
            )

    def publish(self, revision, context="staff", **extra):
        self.action(revision, "submit")
        return self.action(revision, "publish", context, **extra)

    def api_post(self, path, data):
        token = self.client.get("/api/v1/auth/csrf/").json()["csrf_token"]
        return self.client.post(
            path, data, format="json", HTTP_X_CSRFTOKEN=token, HTTP_ORIGIN=ORIGIN
        )

    def test_draft_private_and_public_preview_flag_cannot_expose(self):
        self.service_save(value={"title": "PRIVATE DRAFT", "blocks": []})
        anonymous = APIClient()
        for path in [self.base, self.base + "about/"]:
            self.assertEqual(anonymous.get(path).status_code, 403)
        self.assertEqual(
            anonymous.get(
                "/api/v1/content/public/en/pages/about/?preview=1"
            ).status_code,
            404,
        )
        self.assertNotIn(
            "PRIVATE",
            anonymous.get("/api/v1/content/public/en/shell/").content.decode(),
        )

    def test_publish_replacement_draft_and_unpublish_fresh(self):
        a = self.service_save()
        self.publish(a)
        b = self.service_save(value={"title": "Replacement private", "blocks": []})
        self.assertEqual(resolved("about", "fa-AF")["revision"], a.pk)
        self.publish(b)
        self.assertEqual(resolved("about", "fa-AF")["revision"], b.pk)
        self.action(b, "unpublish")
        self.assertIsNone(resolved("about", "en"))
        self.assertTrue(ContentRevision.objects.filter(pk=a.pk).exists())

    def test_public_dto_and_cache_exclude_private_fields(self):
        r = self.service_save()
        self.publish(r)
        response = APIClient().get("/api/v1/content/public/en/pages/about/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Cache-Control"], "no-store")
        self.assertEqual(
            set(response.json()),
            {
                "key",
                "kind",
                "revision",
                "number",
                "requested_locale",
                "content_locale",
                "fallback",
                "available_locales",
                "published_at",
                "effective_date",
                "payload",
            },
        )
        self.assertNotIn(self.user.email, response.content.decode())

    def test_every_locale_source_fallback_and_translation_invalidation(self):
        a = self.service_save()
        self.publish(a)
        for locale in ["en", "ps", "ar"]:
            self.assertTrue(resolved("about", locale)["fallback"])
            translated = self.service_save(locale=locale, source=a.pk)
            self.publish(translated)
            self.assertFalse(resolved("about", locale)["fallback"])
        b = self.service_save()
        self.publish(b)
        for locale in ["en", "ps", "ar"]:
            self.assertTrue(resolved("about", locale)["fallback"])
            self.assertEqual(resolved("about", locale)["available_locales"], ["fa-AF"])
        self.action(b, "unpublish")
        for locale in ["fa-AF", "en", "ps", "ar"]:
            self.assertIsNone(resolved("about", locale))

    def test_stale_translation_and_structural_translation_rejected(self):
        a = self.service_save()
        self.publish(a)
        tr = self.service_save(locale="en", source=a.pk)
        b = self.service_save()
        self.publish(b)
        self.action(tr, "submit")
        with self.assertRaises(Conflict):
            self.action(tr, "publish")
        value = copy.deepcopy(a.payload)
        value["blocks"] = []
        with self.assertRaises(ValidationError):
            self.service_save(locale="ps", source=b.pk, value=value)

    def test_source_structure_cannot_be_reordered_in_translation(self):
        a = self.service_save()
        value = copy.deepcopy(a.payload)
        value["blocks"][0]["id"] = "changed"
        with self.assertRaises(ValidationError):
            self.service_save(locale="ar", source=a.pk, value=value)

    def test_settings_section_order_visibility_and_navigation_filtering(self):
        home = ContentItem.objects.create(key="home", kind="home")
        value = draft("home")
        value["blocks"][0]["enabled"] = False
        value["blocks"].reverse()
        revision = self.service_save(home, value=value)
        self.publish(revision)
        self.assertEqual(
            [b["id"] for b in resolved("home", "en")["payload"]["blocks"]],
            ["stores", "catalogue"],
        )
        nav = ContentItem.objects.create(key="navigation", kind="shell")
        value = {
            "title": "Links",
            "navigation": [
                {
                    "label": "Main",
                    "placement": "header",
                    "links": [{"label": "PRIVATE CHILD TITLE", "target": "/about"}],
                }
            ],
        }
        self.publish(self.service_save(nav, value=value))
        self.assertNotIn("PRIVATE CHILD TITLE", str(resolved("navigation", "en")))
        self.publish(self.service_save())
        self.assertIn("PRIVATE CHILD TITLE", str(resolved("navigation", "en")))

    def test_legal_requires_owner_exact_revision_explicit_approval_and_nonfuture_date(
        self,
    ):
        legal = ContentItem.objects.create(key="terms", kind="legal")
        r = self.service_save(
            legal, value={"title": "Synthetic private policy", "blocks": []}
        )
        self.action(r, "submit")
        with self.assertRaises(PermissionDenied):
            self.action(r, "publish")
        for options in [
            {},
            {
                "owner_approval": True,
                "effective_date": timezone.localdate() + timedelta(days=1),
            },
        ]:
            with self.assertRaises(ValidationError):
                self.action(r, "publish", "owner", **options)
        self.action(
            r,
            "publish",
            "owner",
            owner_approval=True,
            effective_date=timezone.localdate(),
        )
        self.assertEqual(Publication.objects.get(item=legal).revision_id, r.pk)
        with self.assertRaises(PermissionDenied):
            self.action(r, "unpublish")
        self.action(r, "unpublish", "owner")

    def test_stale_version_rejected_and_history_retained(self):
        self.service_save()
        response = self.api_post(
            self.base + "about/",
            {"version": 1, "locale": "fa-AF", "payload": {"title": "Retained input"}},
        )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.item.revisions.count(), 1)
        self.assertEqual(ContentEvent.objects.filter(item=self.item).count(), 1)

    def test_mutation_response_is_minimal_without_read_permission(self):
        self.group.permissions.remove(
            Permission.objects.get(
                content_type__app_label="content", codename="read_drafts"
            )
        )
        response = self.api_post(
            self.base + "about/",
            {"version": 1, "locale": "fa-AF", "payload": {"title": "PRIVATE"}},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(set(response.json()), {"id", "version", "revision", "state"})
        self.assertNotIn("PRIVATE", response.content.decode())
        self.assertEqual(self.client.get(self.base + "about/").status_code, 403)

    def test_fresh_revocation_blocks_active_session_read_preview_and_save(self):
        revision = self.service_save()
        self.assertEqual(self.client.get(self.base).status_code, 200)
        self.account.permission_groups.clear()
        self.assertEqual(self.client.get(self.base).status_code, 403)
        self.assertEqual(
            self.client.get(
                f"/api/v1/content/editor/staff/revisions/{revision.pk}/preview/"
            ).status_code,
            403,
        )
        response = self.api_post(
            self.base + "about/",
            {
                "version": self.item.version,
                "locale": "fa-AF",
                "payload": {"title": "PRIVATE"},
            },
        )
        self.assertEqual(response.status_code, 403)

    def test_editor_without_publisher_cannot_publish(self):
        revision = self.service_save()
        self.action(revision, "submit")
        self.group.permissions.remove(
            Permission.objects.get(
                content_type__app_label="content", codename="publish_content"
            )
        )
        response = self.api_post(
            self.base + "about/actions/",
            {
                "version": self.item.version,
                "revision": str(revision.pk),
                "action": "publish",
                "reason": "test",
            },
        )
        self.assertEqual(response.status_code, 403)
        self.assertFalse(Publication.objects.exists())

    def test_manage_settings_separate_from_ordinary_edit(self):
        home = ContentItem.objects.create(key="home", kind="home")
        self.group.permissions.remove(
            Permission.objects.get(
                content_type__app_label="content", codename="manage_settings"
            )
        )
        response = self.api_post(
            self.base + "home/",
            {"version": home.version, "locale": "fa-AF", "payload": draft("home")},
        )
        self.assertEqual(response.status_code, 403)
        self.assertNotIn(
            "home", [v["key"] for v in self.client.get(self.base).json()["results"]]
        )

    def test_buyer_seller_and_unrelated_staff_cannot_read(self):
        for context in ["buyer", "seller"]:
            user = User.objects.create_user(
                context + "@example.test", PASSWORD, email_verified=True
            )
            Account.objects.create(user=user, context=context)
            c = APIClient()
            signin(c, context, user.email)
            self.assertEqual(c.get(self.base).status_code, 403)
        self.account.permission_groups.clear()
        self.assertEqual(self.client.get(self.base).status_code, 403)

    def test_malicious_payloads_rejected(self):
        bad = [
            {"title": "<script>alert(1)</script>"},
            {"title": "bad\u202etext"},
            {"title": "bad\x00text"},
            {
                "title": "x",
                "blocks": [
                    {
                        "id": "a",
                        "type": "text",
                        "links": [{"label": "unsafe", "target": "//example.test"}],
                    }
                ],
            },
            {
                "title": "x",
                "blocks": [
                    {
                        "id": "a",
                        "type": "text",
                        "links": [{"label": "unsafe", "target": "javascript:alert(1)"}],
                    }
                ],
            },
            {"title": "x", "blocks": [{"id": "a", "type": "text", "asset": "welcome"}]},
            {"title": "x", "blocks": [{"id": "a", "type": "text", "unknown": "x"}]},
            {
                "title": "x",
                "blocks": [{"id": "a", "type": "catalogue", "items": ["fake product"]}],
            },
        ]
        for value in bad:
            with self.subTest(value=value):
                with self.assertRaises(ValidationError):
                    payload(value, "home")

    def test_bounded_payload_and_invalid_destinations(self):
        for target in [
            "/catalogue",
            "/admin/",
            "/auth/buyer-sign-in?next=https://evil.test",
            "/help/../private",
        ]:
            with self.assertRaises(ValidationError):
                payload(
                    {
                        "title": "Safe",
                        "blocks": [
                            {
                                "id": "a",
                                "type": "text",
                                "links": [{"label": "go", "target": target}],
                            }
                        ],
                    },
                    "page",
                )
        with self.assertRaises(ValidationError):
            payload(
                {
                    "title": "Safe",
                    "blocks": [{"id": "a", "type": "text", "text": "x" * 6001}],
                },
                "page",
            )

    def test_support_field_validation_and_translation_values(self):
        support = ContentItem.objects.create(key="support", kind="support")
        for values in [
            {"email": "bad"},
            {"phone": "private number"},
            {"website": "http://example.test"},
            {"website": "https://user:password@example.test"},
        ]:
            with self.assertRaises(ValidationError):
                payload({"title": "Support", "support": values}, "support")
        r = self.service_save(
            support,
            value={"title": "Support", "support": {"email": "help@example.test"}},
        )
        with self.assertRaises(ValidationError):
            self.service_save(
                support,
                locale="en",
                source=r.pk,
                value={
                    "title": "Support",
                    "support": {"email": "different@example.test"},
                },
            )

    def test_help_listing_only_published_paginated_bounded_queries(self):
        for i in range(14):
            item = ContentItem.objects.create(key=f"guide-{i}", kind="article")
            self.publish(
                self.service_save(item, value={"title": f"Guide {i}", "blocks": []})
            )
        with self.assertNumQueries(3):
            response = APIClient().get("/api/v1/content/public/en/help/")
        self.assertEqual(len(response.json()["results"]), 12)
        self.assertEqual(response.json()["count"], 14)
        self.assertEqual(
            len(
                APIClient()
                .get("/api/v1/content/public/en/help/?page=2")
                .json()["results"]
            ),
            2,
        )
        self.assertEqual(
            APIClient().get("/api/v1/content/public/en/help/?page=0").status_code, 400
        )

    def test_preview_private_no_store_and_raw_admin_no_bypass(self):
        r = self.service_save()
        response = self.client.get(
            f"/api/v1/content/editor/staff/revisions/{r.pk}/preview/"
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("no-store", response["Cache-Control"])
        self.assertNotEqual(
            self.client.get("/admin/content/contentitem/").status_code, 200
        )
        from apps.content.admin import ContentAdmin
        from apps.accounts.admin import owner_site

        admin = ContentAdmin(ContentItem, owner_site)
        self.assertFalse(admin.has_add_permission(self.request))
        self.assertFalse(admin.has_delete_permission(self.request, self.item))

    def test_identity_setup_reruns_preserve_authored_drafts_and_publications(self):
        r = self.service_save()
        self.publish(r)
        call_command("setup_content", verbosity=0)
        call_command("setup_content", verbosity=0)
        self.assertEqual(self.item.revisions.count(), 1)
        self.assertEqual(Publication.objects.get(item=self.item).revision_id, r.pk)

    def test_invalid_locale_unknown_identity_and_revision_return_404(self):
        self.assertEqual(
            APIClient().get("/api/v1/content/public/fr/home/").status_code, 404
        )
        self.assertEqual(
            self.api_post(
                self.base + "missing/",
                {"version": 1, "locale": "fa-AF", "payload": {"title": "Missing"}},
            ).status_code,
            404,
        )
        self.assertEqual(
            self.api_post(self.base, {"key": "home", "kind": "article"}).status_code,
            400,
        )

    def test_return_then_new_submission_does_not_modify_document(self):
        r = self.service_save()
        original = copy.deepcopy(r.payload)
        self.action(r, "submit")
        self.action(r, "return")
        self.action(r, "submit")
        r.refresh_from_db()
        self.assertEqual(r.payload, original)

    def test_published_page_does_not_make_same_slug_article_link_eligible(self):
        self.publish(self.service_save())
        nav = ContentItem.objects.create(key="navigation", kind="shell")
        revision = self.service_save(
            nav,
            value={
                "title": "Navigation",
                "navigation": [
                    {
                        "label": "Guides",
                        "placement": "footer",
                        "links": [{"label": "Must not leak", "target": "/help/about"}],
                    }
                ],
            },
        )
        self.publish(revision)
        self.assertNotIn("Must not leak", str(resolved("navigation", "en")))

    def test_editor_listing_is_paginated_and_has_no_draft_bodies(self):
        self.service_save(value={"title": "PRIVATE LIST BODY", "blocks": []})
        ContentItem.objects.bulk_create(
            [ContentItem(key=f"new-guide-{n}", kind="article") for n in range(51)]
        )
        response = self.client.get(self.base)
        self.assertEqual(len(response.json()["results"]), 50)
        self.assertEqual(response.json()["count"], 52)
        self.assertNotIn("PRIVATE LIST BODY", response.content.decode())
        self.assertEqual(
            len(self.client.get(self.base + "?page=2").json()["results"]), 2
        )
        self.assertEqual(self.client.get(self.base + "?page=0").status_code, 400)

    def test_sentinel_public_surfaces_and_preview_authorization(self):
        sentinel = "INDEPENDENT-PRIVATE-SENTINEL-7213"
        revision = self.service_save(value={"title": sentinel})
        self.assertIn(
            sentinel,
            self.client.get(
                f"/api/v1/content/editor/staff/revisions/{revision.pk}/preview/"
            ).content.decode(),
        )
        anonymous = APIClient()
        for locale in ["fa-AF", "en", "ps", "ar"]:
            for suffix in ["shell/", "home/", "help/", "pages/about/?preview=true"]:
                response = anonymous.get(f"/api/v1/content/public/{locale}/{suffix}")
                self.assertNotIn(sentinel, response.content.decode())
        self.assertEqual(
            anonymous.get(
                f"/api/v1/content/editor/staff/revisions/{revision.pk}/preview/"
            ).status_code,
            403,
        )

    def test_api_publish_and_revocation_boundaries(self):
        revision = self.service_save()
        self.action(revision, "submit")
        self.group.permissions.remove(
            Permission.objects.get(
                content_type__app_label="content", codename="publish_content"
            )
        )
        path = self.base + "about/actions/"
        response = self.api_post(
            path,
            {
                "version": self.item.version,
                "revision": str(revision.pk),
                "action": "publish",
                "reason": "Independent check",
            },
        )
        self.assertEqual(response.status_code, 403)
        self.assertFalse(Publication.objects.filter(item=self.item).exists())
        self.account.permission_groups.clear()
        response = self.api_post(
            self.base + "about/",
            {
                "version": self.item.version,
                "locale": "fa-AF",
                "payload": {"title": "Denied"},
            },
        )
        self.assertEqual(response.status_code, 403)

    def test_translation_and_unpublish_via_public_http(self):
        first = self.service_save(value={"title": "SOURCE A"})
        self.publish(first)
        translated = self.service_save(
            locale="en", source=first.pk, value={"title": "TRANSLATION A"}
        )
        self.publish(translated)
        second = self.service_save(value={"title": "SOURCE B"})
        self.publish(second)
        public = APIClient()
        result = public.get("/api/v1/content/public/en/pages/about/")
        self.assertEqual(result.json()["payload"]["title"], "SOURCE B")
        self.assertTrue(result.json()["fallback"])
        self.assertEqual(result.json()["available_locales"], ["fa-AF"])
        self.action(second, "unpublish")
        self.assertEqual(
            public.get("/api/v1/content/public/en/pages/about/").status_code, 404
        )

    def test_published_nav_withdraws_child_and_support_updates(self):
        page = self.service_save()
        self.publish(page)
        nav = ContentItem.objects.create(key="navigation", kind="shell")
        self.publish(
            self.service_save(
                nav,
                value={
                    "title": "Nav",
                    "navigation": [
                        {
                            "label": "Links",
                            "placement": "header",
                            "links": [
                                {"label": "ONLY PUBLIC CHILD", "target": "/about"}
                            ],
                        }
                    ],
                },
            )
        )
        public = APIClient()
        endpoint = "/api/v1/content/public/en/shell/"
        self.assertIn("ONLY PUBLIC CHILD", public.get(endpoint).content.decode())
        self.action(page, "unpublish")
        self.assertNotIn("ONLY PUBLIC CHILD", public.get(endpoint).content.decode())
        support = ContentItem.objects.create(key="support", kind="support")
        for email in ["first@example.test", "second@example.test"]:
            self.publish(
                self.service_save(
                    support, value={"title": "Support", "support": {"email": email}}
                )
            )
            response = public.get(endpoint)
            self.assertEqual(
                response.json()["support"]["payload"]["support"]["email"], email
            )
            self.assertEqual(response["Cache-Control"], "no-store")

    def test_legal_translation_cannot_be_published_by_staff(self):
        legal = ContentItem.objects.create(key="privacy", kind="legal")
        source = self.service_save(legal, value={"title": "SYNTHETIC policy"})
        self.publish(
            source, "owner", owner_approval=True, effective_date=timezone.localdate()
        )
        translated = self.service_save(
            legal, locale="en", source=source.pk, value={"title": "SYNTHETIC English"}
        )
        self.action(translated, "submit")
        legal.refresh_from_db()
        result = self.api_post(
            self.base + "privacy/actions/",
            {
                "version": legal.version,
                "revision": str(translated.pk),
                "action": "publish",
                "reason": "Not an owner",
                "owner_approval": True,
                "effective_date": str(timezone.localdate()),
            },
        )
        self.assertEqual(result.status_code, 403)
        self.assertFalse(Publication.objects.filter(item=legal, locale="en").exists())
        self.action(
            translated,
            "publish",
            "owner",
            owner_approval=True,
            effective_date=timezone.localdate(),
        )
        self.assertEqual(
            APIClient()
            .get("/api/v1/content/public/en/pages/privacy/")
            .json()["content_locale"],
            "en",
        )

    def test_registration_contract_accepts_real_forms_and_rejects_old_or_unsafe_targets(
        self,
    ):
        from apps.content.validation import target
        from apps.content.queries import available_target

        for context in ["buyer", "seller"]:
            self.assertEqual(
                target(f"/auth/{context}-registration"), f"/auth/{context}-registration"
            )
            self.assertEqual(
                target(f"/auth/{context}-sign-in"), f"/auth/{context}-sign-in"
            )
            with self.assertRaises(ValidationError):
                target(f"/auth/{context}-register")
            self.assertFalse(available_target(f"/auth/{context}-register", set()))
        for value in [
            "//evil.test",
            "https://evil.test",
            "javascript:alert(1)",
            "/auth/anything",
            "/auth/buyer-registration?next=//evil.test",
        ]:
            with self.assertRaises(ValidationError):
                target(value)
        for key in ["wholesale", "sell", "how-it-works"]:
            value = payload(draft(key), "page")
            targets = [
                link["target"] for block in value["blocks"] for link in block["links"]
            ]
            self.assertTrue(any(t.endswith("-registration") for t in targets))
            self.assertFalse(any(t.endswith("-register") for t in targets))

    def test_validation_envelope_identifies_safe_paths_and_stable_rules(self):
        cases = [
            ({"title": "<private-invalid-markup>"}, "payload.title", "plain_text"),
            (
                {
                    "title": "Valid",
                    "blocks": [
                        {
                            "id": "a",
                            "type": "text",
                            "links": [
                                {"label": "Bad", "target": "/auth/buyer-register"}
                            ],
                        }
                    ],
                },
                "payload.blocks.0.links.0.target",
                "internal_target",
            ),
            (
                {
                    "title": "Valid",
                    "blocks": [
                        {
                            "id": "a",
                            "type": "text",
                            "items": [str(i) for i in range(13)],
                        }
                    ],
                },
                "payload.blocks.0.items",
                "max_length",
            ),
        ]
        for value, path, rule in cases:
            with self.subTest(code=rule):
                response = self.api_post(
                    self.base + "about/",
                    {"version": 1, "locale": "fa-AF", "payload": value},
                )
                self.assertEqual(response.status_code, 400)
                self.assertIn(
                    {"path": path, "code": rule}, response.json()["error"]["violations"]
                )
                self.assertNotIn("private-invalid-markup", response.content.decode())
                self.assertEqual(ContentRevision.objects.count(), 0)

    def test_translation_structure_error_has_safe_source_rule(self):
        source = self.service_save(
            value={"title": "Source", "blocks": [{"id": "a", "type": "text"}]}
        )
        response = self.api_post(
            self.base + "about/",
            {
                "version": self.item.version,
                "locale": "en",
                "source": str(source.pk),
                "payload": {"title": "Translation"},
            },
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn(
            {"path": "source", "code": "source_structure"},
            response.json()["error"]["violations"],
        )


class ContentConcurrencyTests(TransactionTestCase):
    def test_two_editors_same_version_only_one_saves(self):
        user = User.objects.create_user("race@example.test", PASSWORD)
        ContentItem.objects.create(key="about", kind="page")

        def edit(title):
            try:
                save(
                    SimpleNamespace(user=user),
                    "owner",
                    "about",
                    {"version": 1, "locale": "fa-AF", "payload": {"title": title}},
                )
                return "saved"
            except Conflict:
                return "conflict"
            finally:
                connections.close_all()

        with patch("apps.content.services.get_grant"):
            with ThreadPoolExecutor(max_workers=2) as executor:
                results = list(executor.map(edit, ["First", "Second"]))
        self.assertCountEqual(results, ["saved", "conflict"])
        self.assertEqual(ContentRevision.objects.count(), 1)

    def test_competing_publications_cannot_both_succeed(self):
        from apps.accounts.models import User

        user = User.objects.create_user(
            "independent-race@example.test", "Synthetic-test-only-123!"
        )
        item = ContentItem.objects.create(key="about", kind="page")
        request = SimpleNamespace(user=user)
        with patch("apps.content.services.get_grant"):
            for title in ["FIRST", "SECOND"]:
                item.refresh_from_db()
                result = save(
                    request,
                    "owner",
                    item.key,
                    {
                        "version": item.version,
                        "locale": "fa-AF",
                        "payload": {"title": title},
                    },
                )
                transition(
                    request,
                    "owner",
                    item.key,
                    {
                        "version": result["version"],
                        "revision": result["revision"],
                        "action": "submit",
                        "reason": "Independent synthetic review",
                    },
                )
        item.refresh_from_db()
        version = item.version
        revisions = list(
            ContentRevision.objects.filter(item=item).values_list("pk", flat=True)
        )

        def publish(pk):
            try:
                transition(
                    request,
                    "owner",
                    "about",
                    {
                        "version": version,
                        "revision": pk,
                        "action": "publish",
                        "reason": "Race test",
                    },
                )
                return "published"
            except Conflict:
                return "conflict"
            finally:
                connections.close_all()

        with patch("apps.content.services.get_grant"):
            with ThreadPoolExecutor(max_workers=2) as pool:
                results = list(pool.map(publish, revisions))
        self.assertCountEqual(results, ["published", "conflict"])
        self.assertEqual(Publication.objects.filter(item=item).count(), 1)


class ContentMigrationTests(TransactionTestCase):
    def test_phase04_upgrade_preserves_identity_permissions_and_records(self):
        assert_owned_database(connection)
        executor = MigrationExecutor(connection)
        latest = executor.loader.graph.leaf_nodes()
        try:
            executor.migrate([("content", None)])
            user = User.objects.create_user(
                "phase04-upgrade@example.test", PASSWORD, email_verified=True
            )
            account = Account.objects.create(user=user, context="seller")
            password_hash = user.password
            executor = MigrationExecutor(connection)
            executor.migrate(latest)
            user.refresh_from_db()
            self.assertEqual(user.password, password_hash)
            self.assertTrue(Account.objects.filter(pk=account.pk, user=user).exists())
            self.assertEqual(ContentItem.objects.count(), 0)
        finally:
            MigrationExecutor(connection).migrate(latest)
