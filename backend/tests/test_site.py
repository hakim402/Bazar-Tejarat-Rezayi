"""Site contracts, owner authority, inspected media, atomic forms and retained schema."""
import io
import json
from pathlib import Path
from unittest.mock import patch
from django.apps import apps
from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.files.storage import storages
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TestCase, TransactionTestCase, override_settings
from django.core.management import call_command
from rest_framework.test import APIClient
from PIL import Image
from apps.accounts.models import User, Account, Authenticator
from apps.accounts.services import AuthFailure
from apps.site.defaults import initialize
from apps.site.models import SiteSettings, SiteMedia, HeroSlide, SiteLocale
from apps.site.forms import SettingsForm, SlideForms, SEOForms, SITE_FIELDS, SITE_TEXT, HERO_TEXT
from apps.site.services import save_settings
from apps.site.sections import SECTION_MAP, SECTIONS
from apps.site.validation import destination, external_media
from apps.site.media import inspect_upload, store_upload
from tests.test_identity import PASSWORD, signin, post, code
from tests.legacy_content import predecessor, fingerprints, TABLES
from config.testing import assert_owned_database


def image():
    output = io.BytesIO()
    Image.new("RGB", (80, 60), "blue").save(output, "PNG")
    return SimpleUploadedFile("../../demo.png", output.getvalue(), content_type="text/plain")


def form_data():
    instance = SiteSettings.objects.get(pk=1)
    data = {"site-version": instance.version, **{"site-" + name: (getattr(instance, name) or "") for name in SITE_FIELDS}}
    for row in instance.locales.all():
        data.update({f"site-{row.locale}_{name}": getattr(row, name) for name in SITE_TEXT})
    slides = list(instance.slides.all())
    data.update({"slides-TOTAL_FORMS": len(slides), "slides-INITIAL_FORMS": len(slides), "seo-TOTAL_FORMS": 0, "seo-INITIAL_FORMS": 0})
    for index, slide in enumerate(slides):
        data.update({f"slides-{index}-" + name: getattr(slide, name) for name in ["id", "label", "enabled", "position", "kind", "bundled_image", "image_url", "video_url", "silent"]})
        for row in slide.locales.all():
            data.update({f"slides-{index}-{row.locale}_{name}": getattr(row, name) for name in HERO_TEXT})
    return data


def bound(data, files=None):
    instance = SiteSettings.objects.get(pk=1)
    return (SettingsForm(data, files, instance=instance, prefix="site"), SlideForms(data, files, queryset=instance.slides.all(), prefix="slides"), SEOForms(data, files, queryset=instance.seo.all(), prefix="seo"))


class SiteTests(TestCase):
    def setUp(self):
        initialize()
        self.owner = User.objects.create_superuser("site-owner@example.test", PASSWORD, email_verified=True)
        self.client = APIClient(enforce_csrf_checks=True)

    def authorize(self):
        signin(self.client, "owner", self.owner.email)
        post(self.client, "mfa/enroll/")
        post(self.client, "mfa/challenge/", {"code": code(Authenticator.objects.get(user=self.owner))})

    def test_independent_cards_save_translate_and_hide_across_hero_modes(self):
        from apps.site.models import HeroLocale
        site = SiteSettings.objects.get()
        cards = []
        for index in range(2):
            card = HeroSlide.objects.create(settings=site, placement="promotion", enabled=True, bundled_image=True)
            for locale in ["fa-AF", "en", "ps", "ar"]:
                HeroLocale.objects.create(slide=card, locale=locale, title=f"DEMO {locale}", alt="DEMO", cta_label="Preview", cta_url="/about")
            cards.append(card)
        site.promotion_one, site.promotion_two = cards
        site.save()
        for mode in ["image_carousel", "video_carousel"]:
            SiteSettings.objects.filter(pk=1).update(hero_mode=mode)
            for locale in ["fa-AF", "en", "ps", "ar"]:
                hero = self.client.get(f"/api/v1/site/public/{locale}/").json()["hero"]
                self.assertEqual(len(hero["slides"]), 0 if mode == "video_carousel" else 1)
                self.assertEqual([card["slot"] for card in hero["cards"]], ["promo_1", "promo_2"])
                self.assertEqual(hero["cards"][0]["title"], f"DEMO {locale}")
        HeroSlide.objects.filter(pk=cards[0].pk).update(enabled=False)
        self.assertEqual([card["slot"] for card in self.client.get("/api/v1/site/public/en/").json()["hero"]["cards"]], ["promo_2"])
        self.assertEqual(HeroSlide.objects.count(), 3)

    def test_video_source_destination_is_validated(self):
        from apps.site.forms import SlideForm
        data = {"label": "Video draft", "kind": "video", "position": 0, "source_url": "javascript:alert(1)"}
        self.assertFalse(SlideForm(data).is_valid())
        data["source_url"] = "https://example.com/product"
        self.assertTrue(SlideForm(data).is_valid())

    def test_public_allowlist_no_get_writes_and_no_cms(self):
        self.assertFalse(apps.is_installed("apps.content"))
        before = SiteSettings.objects.get().version
        for locale in ["fa-AF", "en", "ps", "ar"]:
            response = self.client.get(f"/api/v1/site/public/{locale}/")
            self.assertEqual(response.status_code, 200)
            data = response.json()
            self.assertEqual(set(data), {"default_locale", "default_theme", "indexing", "identity", "contacts", "favicon", "og_image", "announcement", "maintenance", "hero", "seo", "media_hosts"})
            self.assertNotIn("key", json.dumps(data))
            self.assertNotIn("version", data)
            self.assertEqual(response["Cache-Control"], "no-store")
        self.assertEqual(SiteSettings.objects.get().version, before)
        for url in ["/api/v1/content/public/en/home/", "/api/v1/content/editor/staff/items/", "/api/v1/site/public/fr/"]:
            self.assertEqual(self.client.get(url).status_code, 404)
        self.assertEqual(self.client.post("/api/v1/site/public/en/", {}).status_code, 405)

    def test_fallback_logos_remain_locale_specific_and_setup_idempotent(self):
        SiteLocale.objects.filter(locale="en").update(name="", announcement="")
        site = SiteSettings.objects.get()
        site.announcement_enabled = True
        site.save()
        SiteLocale.objects.filter(locale="fa-AF").update(announcement="اعلان آزمایشی")
        result = self.client.get("/api/v1/site/public/en/").json()
        self.assertTrue(result["identity"]["fallback"])
        self.assertIsNone(result["identity"]["logo_light"])
        self.assertTrue(result["announcement"]["fallback"])
        call_command("setup_site", verbosity=0)
        site.refresh_from_db()
        self.assertTrue(site.announcement_enabled)
        self.assertEqual(HeroSlide.objects.count(), 1)

    def test_partial_translated_notices_fall_back_as_complete_labelled_units(self):
        site = SiteSettings.objects.get()
        site.maintenance_enabled = True
        site.announcement_enabled = True
        site.announcement_url = "/about"
        site.save()
        SiteLocale.objects.filter(locale="fa-AF").update(announcement="اعلان", announcement_label="درباره")
        SiteLocale.objects.filter(locale="en").update(maintenance_message="English partial", maintenance_title="", announcement="English partial", announcement_label="")
        value = self.client.get("/api/v1/site/public/en/").json()
        self.assertTrue(value["maintenance"]["title"])
        self.assertEqual(value["maintenance"]["content_locale"], "fa-AF")
        self.assertTrue(value["maintenance"]["fallback"])
        self.assertEqual(value["announcement"]["label"], "درباره")
        self.assertTrue(value["announcement"]["fallback"])

    def test_missing_settings_are_503_and_never_created_by_get(self):
        SiteSettings.objects.all().delete()
        for url in ["/api/v1/site/public/en/", "/api/v1/bootstrap/"]:
            response = self.client.get(url)
            self.assertEqual(response.status_code, 503)
        self.assertFalse(SiteSettings.objects.exists())

    def test_owner_mfa_csrf_and_revocation(self):
        url = "/admin/site-setting/general/"
        self.assertEqual(self.client.get(url).status_code, 302)
        signin(self.client, "owner", self.owner.email)
        self.assertEqual(self.client.get(url).status_code, 302)
        self.authorize()
        self.assertContains(self.client.get(url), "Publish")
        self.assertEqual(self.client.post(url, form_data()).status_code, 403)
        self.owner.owner_authority = False
        self.owner.save(update_fields=["owner_authority"])
        self.assertEqual(self.client.get(url).status_code, 302)

    def section_data(self, key):
        form = SettingsForm(instance=SiteSettings.objects.get(pk=1), prefix="site", section=SECTION_MAP[key])
        return {field.html_name: field.value() for field in form if field.value() is not None}

    def save_section(self, key, data):
        token = self.client.get("/api/v1/auth/csrf/").json()["csrf_token"]
        return self.client.post(f"/admin/site-setting/{key}/", {"action": "publish", **data}, HTTP_X_CSRFTOKEN=token, HTTP_ORIGIN=settings.FRONTEND_ORIGIN)

    def test_settings_sections_have_one_navigation_and_legacy_root_redirect(self):
        self.authorize()
        before = SiteSettings.objects.get().version
        self.assertRedirects(self.client.get("/admin/site-setting/"), "/admin/site-setting/general/")
        response = self.client.get("/admin/site-setting/general/")
        from apps.accounts.admin_navigation import navigation
        groups = navigation(response.wsgi_request)
        self.assertEqual(str(groups[-1]["title"]), "Site Setting")
        self.assertEqual(len(groups[-1]["items"]), len(SECTIONS))
        self.assertNotContains(response, "All settings")
        for section in SECTIONS:
            response = self.client.get(f"/admin/site-setting/{section.key}/")
            self.assertEqual(response.status_code, 200)
            self.assertNotContains(response, 'aria-label="Settings sections"')
            self.assertNotContains(response, 'data-testid="settings-overview"')
            form = response.context["form"]
            self.assertEqual(form.section, section)
            self.assertEqual(response.context["posts"] is not None, section.key in {"hero", "promotions"})
            self.assertEqual(response.context["seo"] is not None, section.key == "seo")
            if section.key == "hero":
                editor = self.client.get("/admin/site-setting/hero/new/").context["form"]
                for locale in ["fa-AF", "ps", "ar", "en"]:
                    self.assertEqual(editor.fields[f"{locale}_cta_url"].widget.attrs["dir"], "ltr")
            if section.key != "maintenance":
                self.assertNotContains(response, 'name="site-maintenance_enabled"')
            self.assertEqual(response["Cache-Control"], "max-age=0, no-cache, no-store, must-revalidate, private")
        self.assertRedirects(self.client.get("/admin/site/sitesettings/"), "/admin/site-setting/general/")
        self.assertRedirects(self.client.get("/admin/site/sitesettings/hero/"), "/admin/site-setting/hero/")
        self.assertEqual(self.client.get("/admin/site-setting/unknown/").status_code, 404)
        self.assertEqual(SiteSettings.objects.get().version, before)

    def test_section_saves_preserve_unowned_settings_and_ignore_forged_fields(self):
        self.authorize()
        site = SiteSettings.objects.get()
        site.announcement_enabled = True
        site.save()
        SiteLocale.objects.filter(locale="fa-AF").update(announcement="اعلان آزمایشی")
        original_locales = list(SiteLocale.objects.values().order_by("locale"))
        original_slides = list(HeroSlide.objects.values())
        data = self.section_data("contacts")
        data.update({"site-phone": "+1234567890", "site-default_locale": "ar", "site-maintenance_enabled": True,
                     "site-en_name": "Forged unowned name", "slides-TOTAL_FORMS": "0", "seo-TOTAL_FORMS": "0"})
        response = self.save_section("contacts", data)
        self.assertEqual(response.status_code, 302)
        site.refresh_from_db()
        self.assertEqual(site.phone, "+1234567890")
        self.assertEqual(site.default_locale, "fa-AF")
        self.assertTrue(site.announcement_enabled)
        self.assertFalse(site.maintenance_enabled)
        self.assertEqual(list(SiteLocale.objects.values().order_by("locale")), original_locales)
        self.assertEqual(list(HeroSlide.objects.values()), original_slides)
        self.assertFalse(site.seo.exists())

    def test_section_save_conflicts_across_pages_and_retains_input(self):
        self.authorize()
        stale = self.section_data("general")
        stale["site-en_name"] = "DEMO retained conflict"
        contact = self.section_data("contacts")
        contact["site-phone"] = "+1234567890"
        self.assertEqual(self.save_section("contacts", contact).status_code, 302)
        response = self.save_section("general", stale)
        self.assertContains(response, "Settings changed in another session")
        self.assertContains(response, 'value="DEMO retained conflict"')
        self.assertNotEqual(SiteLocale.objects.get(locale="en").name, "DEMO retained conflict")
        self.assertEqual(SiteSettings.objects.get().phone, "+1234567890")

    def test_section_uploads_and_missing_hero_management_remain_atomic(self):
        self.authorize()
        data = self.section_data("branding")
        data.update({"site-favicon_file": image(), "site-en_logo_light_file": image()})
        self.assertEqual(self.save_section("branding", data).status_code, 302)
        self.assertIsNotNone(SiteSettings.objects.get().favicon_id)
        self.assertIsNotNone(SiteLocale.objects.get(locale="en").logo_light_id)
        self.assertIsNone(SiteSettings.objects.get().og_image_id)
        before = SiteSettings.objects.get().version
        data = self.section_data("hero")
        data["site-hero_mode"] = "invalid"
        response = self.save_section("hero", data)
        self.assertContains(response, "Settings not saved")
        self.assertEqual(SiteSettings.objects.get().version, before)
        data = self.section_data("branding")
        data.update({"site-favicon_file": image(), "site-en_logo_dark_file": image()})
        with patch.object(storages["site_local"], "save", side_effect=OSError("synthetic failure")):
            response = self.save_section("branding", data)
        self.assertContains(response, "Changes could not be saved")
        self.assertEqual(SiteSettings.objects.get().version, before)

    def test_invalid_section_field_has_one_accessible_error_target_and_keeps_value(self):
        self.authorize()
        before = SiteSettings.objects.get().version
        data = self.section_data("contacts")
        data["site-phone"] = "invalid"
        response = self.save_section("contacts", data)
        self.assertContains(response, 'id="id_site-phone_error"', count=1)
        self.assertContains(response, 'id_site-phone_helptext id_site-phone_error')
        self.assertContains(response, 'value="invalid"')
        self.assertEqual(SiteSettings.objects.get().version, before)

    def test_each_section_is_owner_mfa_and_csrf_protected(self):
        paths = ["/admin/site-setting/", *[f"/admin/site-setting/{section.key}/" for section in SECTIONS]]
        for path in paths:
            self.assertEqual(self.client.get(path).status_code, 302)
        self.authorize()
        for section in SECTIONS:
            self.assertEqual(self.client.post(f"/admin/site-setting/{section.key}/", {}).status_code, 403)
        self.owner.owner_authority = False
        self.owner.save(update_fields=["owner_authority"])
        for path in paths:
            self.assertEqual(self.client.get(path).status_code, 302)

    def test_staff_legacy_entitlement_never_grants_site_access(self):
        user = User.objects.create_user("site-staff@example.test", PASSWORD, email_verified=True, is_staff=True)
        Account.objects.create(user=user, context="staff")
        from django.contrib.auth.models import Permission
        user.user_permissions.add(Permission.objects.get(codename="manage_content", content_type__app_label="accounts"))
        signin(self.client, "staff", user.email)
        post(self.client, "mfa/enroll/")
        post(self.client, "mfa/challenge/", {"code": code(Authenticator.objects.get(user=user))})
        for path in ["/admin/site-setting/", *[f"/admin/site-setting/{section.key}/" for section in SECTIONS]]:
            self.assertEqual(self.client.get(path).status_code, 302)
        forms = bound(form_data())
        self.assertTrue(all(form.is_valid() for form in forms))
        request = self.client.get("/api/v1/auth/staff/session/").wsgi_request
        with self.assertRaises(AuthFailure):
            save_settings(request, *forms)

    def test_atomic_save_stale_reject_and_next_get_visibility(self):
        self.authorize()
        request = self.client.get("/admin/site/sitesettings/").wsgi_request
        data = form_data()
        data.update({"site-default_locale": "ps", "site-default_theme": "dark", "site-announcement_enabled": True, "site-fa-AF_announcement": "اعلان آزمایشی"})
        forms = bound(data)
        self.assertTrue(all(form.is_valid() for form in forms), [form.errors for form in forms])
        stale = bound(data)
        self.assertTrue(all(form.is_valid() for form in stale))
        save_settings(request, *forms)
        with self.assertRaises(ValidationError):
            save_settings(request, *stale)
        value = self.client.get("/api/v1/site/public/en/").json()
        self.assertEqual(value["default_theme"], "dark")
        self.assertTrue(value["announcement"]["enabled"])
        self.assertEqual(self.client.get("/api/v1/bootstrap/").json()["default_locale"], "ps")

    def test_aggregate_enabled_limit_counts_unposted_slides_and_form_budget(self):
        self.authorize()
        request = self.client.get("/admin/site/sitesettings/").wsgi_request
        data = form_data()
        forms = bound(data)
        self.assertTrue(all(form.is_valid() for form in forms))
        # Even owner-crafted management counts cannot hide active rows from validation.
        for index in range(8):
            HeroSlide.objects.create(settings_id=1, enabled=True, bundled_image=True, position=index+1)
        with self.assertRaises(ValidationError):
            save_settings(request, *forms)
        fields = len(forms[0].fields) + len(forms[1].empty_form.fields) * forms[1].max_num + len(forms[2].empty_form.fields) * forms[2].max_num + 8
        self.assertLess(fields, 1000)  # Django's default multipart field boundary.

    def test_invalid_inputs_mode_and_failed_storage_preserve_previous_state(self):
        self.authorize()
        request = self.client.get("/admin/site/sitesettings/").wsgi_request
        data = form_data()
        data["site-hero_mode"] = "invalid"
        self.assertFalse(bound(data)[0].is_valid())
        self.assertEqual(SiteSettings.objects.get().hero_mode, "image_carousel")
        data["site-hero_mode"] = "image_carousel"
        forms = bound(data, {"site-og_file": image()})
        self.assertTrue(all(form.is_valid() for form in forms))
        with patch.object(storages["site_local"], "save", side_effect=OSError("synthetic disk failure")):
            with self.assertRaises(OSError):
                save_settings(request, *forms)
        self.assertIsNone(SiteSettings.objects.get().og_image_id)
        self.assertFalse(SiteMedia.objects.exists())
        data.update({"site-fa-AF_name": "<script>bad</script>", "site-announcement_url": "//evil.example"})
        self.assertFalse(bound(data)[0].is_valid())

    def test_inspected_media_range_head_and_private_boundaries(self):
        created = []
        asset = store_upload(image(), "image", created)
        self.assertNotIn("demo", asset.key)
        HeroSlide.objects.filter(placement="main").update(image=asset, bundled_image=False)
        url = f"/api/v1/site/media/{asset.pk}/"
        head = self.client.head(url)
        self.assertEqual(head["Content-Type"], "image/webp")
        self.assertEqual(int(head["Content-Length"]), asset.size)
        response = self.client.get(url, HTTP_RANGE="bytes=1-9")
        self.assertEqual(response.status_code, 206)
        self.assertEqual(len(b"".join(response.streaming_content)), 9)
        self.assertEqual(self.client.get(url, HTTP_RANGE="bytes=999999-").status_code, 416)
        self.assertEqual(self.client.get(url+"../private/").status_code, 404)
        storages["site_local"].delete(asset.key)
        self.assertEqual(self.client.get(url).status_code, 503)

    def test_image_type_svg_size_and_video_validation(self):
        for name, data in [("fake.png", b"not an image"), ("logo.svg", b"<svg onload='bad()'/>")]:
            with self.assertRaises(ValidationError):
                inspect_upload(SimpleUploadedFile(name, data, content_type="image/png"), "image")
        with self.assertRaises(ValidationError):
            inspect_upload(SimpleUploadedFile("large.png", b"x" * (8 * 1024 * 1024 + 1)), "image")
        with self.assertRaises(ValidationError):
            inspect_upload(SimpleUploadedFile("fake.mp4", b"not mp4"), "video")

    @override_settings(SITE_MEDIA_HOSTS=("media.example.com",))
    def test_external_policy_and_unsafe_destinations(self):
        for target in ["javascript:alert(1)", "//example.com/a", "/products", "/en/about", "https://127.0.0.1/a", "https://foo.local/a", "https://foo.com:bad/a", "https://u:p@foo.com/a"]:
            with self.assertRaises(ValidationError, msg=target):
                destination(target)
        with patch("apps.site.validation.socket.getaddrinfo", return_value=[(2, 1, 6, "", ("8.8.8.8", 443))]):
            self.assertEqual(external_media("https://media.example.com/a.mp4", "video"), "https://media.example.com/a.mp4")
            for target in ["https://other.example.com/a.mp4", "https://media.example.com/a.mp4?q=1", "https://media.example.com/a.html"]:
                with self.assertRaises(ValidationError):
                    external_media(target, "video")
        with patch("apps.site.validation.socket.getaddrinfo", return_value=[(2, 1, 6, "", ("127.0.0.1", 443))]):
            with self.assertRaises(ValidationError):
                external_media("https://media.example.com/a.mp4", "video")

    def test_existing_product_and_fixed_demo_hero_targets(self):
        for value in ["/catalogue-preview/00000000-0000-0000-0000-000000000001", *["/#demo-product-" + name for name in ["dried-fruit", "clothing", "beauty", "furniture"]]]:
            self.assertEqual(destination(value), value)
        for value in ["/#unknown", "/#demo-product-script", "/catalogue-preview/nope", "/catalogue-preview/00000000-0000-0000-0000-000000000001?redirect=/admin/", "/en/#demo-product-beauty", "/products/beauty"]:
            with self.assertRaises(ValidationError, msg=value):
                destination(value)


class SiteMigrationTests(TransactionTestCase):
    def test_populated_predecessor_additive_upgrade_rollback_and_idempotence(self):
        assert_owned_database(connection)
        executor = MigrationExecutor(connection)
        latest = executor.loader.graph.leaf_nodes()
        try:
            executor.migrate([("site", None)])
            user = User.objects.create_user("site-upgrade@example.test", PASSWORD, email_verified=True)
            state, item = predecessor(user)
            from apps.organizations.models import BusinessProfile
            from apps.catalogue.models import Product
            account = Account.objects.create(user=user, context="seller")
            profile = BusinessProfile.objects.create(account=account, kind="individual", display_name="DEMO preserved business")
            Product.objects.create(seller=profile, currency="AFN", pricing_mode="fixed")
            before = fingerprints()
            MigrationExecutor(connection).migrate(latest)
            self.assertEqual(before, fingerprints())
            self.assertTrue(SiteSettings.objects.exists())
            self.assertEqual(SiteLocale.objects.count(), 4)
            # Old code-state compatibility is independent from reversing new additive tables.
            self.assertEqual(state.apps.get_model("content", "ContentRevision").objects.filter(item_id=item).count(), 4)
            MigrationExecutor(connection).migrate([("site", None)])
            self.assertEqual(before, fingerprints())
            self.assertEqual(state.apps.get_model("content", "Publication").objects.filter(item_id=item).count(), 4)
        finally:
            MigrationExecutor(connection).migrate(latest)

    def test_fresh_graph_does_not_install_or_create_legacy_app(self):
        self.assertFalse(apps.is_installed("apps.content"))
        self.assertNotIn("content", {label for label, name in MigrationExecutor(connection).loader.disk_migrations})
        # Fresh replay is also exercised against the distinct browser DB by the maintained runner.
        source = Path(settings.BASE_DIR) / "apps/site/migrations/0001_initial.py"
        self.assertNotIn('("content",', source.read_text())
        self.assertEqual(len(TABLES), 4)
