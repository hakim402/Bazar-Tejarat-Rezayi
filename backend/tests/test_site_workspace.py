"""Owner draft/publication, two-card selection, routes and permanent file lifecycle."""
from unittest.mock import patch
from django.conf import settings
from django.core.files.storage import storages
from django.test import TestCase, TransactionTestCase
from rest_framework.test import APIClient
from apps.accounts.models import User, Authenticator
from apps.site.defaults import initialize
from apps.site.models import SiteSettings, HeroSlide, HeroLocale, SiteMedia, SiteDraft, SiteDraftUpload
from apps.site.sections import SECTIONS
from tests.test_identity import PASSWORD, signin, post, code
from tests.test_site import image


class SiteWorkspaceTests(TestCase):
    def setUp(self):
        initialize()
        self.owner = User.objects.create_superuser('workspace-owner@example.test', PASSWORD, email_verified=True)
        self.client = APIClient(enforce_csrf_checks=True)
        signin(self.client, "owner", self.owner.email)
        post(self.client, "mfa/enroll/")
        post(self.client, "mfa/challenge/", {"code": code(Authenticator.objects.get(user=self.owner))})

    def send(self, url, data):
        token = self.client.get('/api/v1/auth/csrf/').json()['csrf_token']
        with self.captureOnCommitCallbacks(execute=True):
            return self.client.post(url, data, HTTP_X_CSRFTOKEN=token, HTTP_ORIGIN=settings.FRONTEND_ORIGIN)

    def data(self, **values):
        result = {'post-version': SiteSettings.objects.get(pk=1).version, 'post-label': 'DEMO workspace', 'post-kind': 'image', 'post-enabled': True, 'post-position': 1, 'post-silent': True, 'post-bundled_image': True, 'post-fa-AF_title': 'عنوان آزمایشی', 'post-fa-AF_alt': 'تصویر آزمایشی', 'post-fa-AF_cta_label': 'دیدن', 'post-fa-AF_cta_url': '/about', 'action': 'publish'}
        result.update(values)
        return result

    def add(self, section='promotions', **values):
        response = self.send(f'/admin/site-setting/{section}/new/', self.data(**values))
        self.assertEqual(response.status_code, 302, response.context['form'].errors if response.status_code == 200 else response.status_code)
        return HeroSlide.objects.get(pk=response['Location'].strip('/').split('/')[-1])

    def section_data(self, section):
        response = self.client.get(f'/admin/site-setting/{section}/')
        self.assertEqual(response.status_code, 200)
        data = {field.html_name: field.value() for field in response.context['form'] if field.value() is not None}
        if response.context['seo'] is not None:
            for form in [response.context['seo'].management_form, *response.context['seo'].forms]:
                data.update({field.html_name: field.value() for field in form if field.value() is not None})
        return data

    def test_all_routes_navigation_two_modes_and_legacy_redirects(self):
        for section in SECTIONS:
            response = self.client.get(f'/admin/site-setting/{section.key}/')
            self.assertEqual(response.status_code, 200)
            self.assertContains(response, 'Site Setting')
            self.assertContains(response, 'Save draft')
            self.assertContains(response, 'Publish')
            self.assertNotContains(response, 'aria-label="Settings sections"')
            self.assertEqual(self.client.get(f'/admin/settings/{section.key}/')['Location'], f'/admin/site-setting/{section.key}/')
        response = self.client.get('/admin/site-setting/hero/')
        self.assertEqual(list(response.context['form'].fields['hero_mode'].choices), [('image_carousel', 'Image Carousel'), ('video_carousel', 'Video Carousel')])
        from apps.accounts.admin_navigation import navigation
        self.assertEqual(str(navigation(response.wsgi_request)[-1]['title']), 'Site Setting')

    def test_settings_drafts_are_private_on_every_section_and_publish(self):
        for section in SECTIONS:
            before = self.client.get('/api/v1/site/public/en/').json()
            data = self.section_data(section.key)
            data['action'] = 'save_draft'
            response = self.send(f'/admin/site-setting/{section.key}/', data)
            self.assertEqual(response.status_code, 302, section.key)
            self.assertEqual(self.client.get('/api/v1/site/public/en/').json(), before)
            self.assertTrue(SiteDraft.objects.filter(section=section.key).exists())
            data = self.section_data(section.key)
            data['action'] = 'publish'
            response = self.send(f'/admin/site-setting/{section.key}/', data)
            self.assertEqual(response.status_code, 302, response.context['form'].errors if response.status_code == 200 else section.key)
            self.assertFalse(SiteDraft.objects.filter(section=section.key).exists())

    def test_new_draft_and_edits_do_not_replace_stable_published_post(self):
        draft = self.add('hero', action='save_draft', **{'post-image_file': image(), 'post-fa-AF_title': ''})
        self.assertTrue(draft.is_draft)
        self.assertNotIn(str(draft.pk), [s['id'] for s in self.client.get('/api/v1/site/public/en/').json()['hero']['slides']])
        url = f'/admin/site-setting/hero/{draft.pk}/'
        response = self.send(url, self.data(**{'post-fa-AF_title': 'نسخهٔ نشرشده'}))
        self.assertEqual(response.status_code, 302)
        draft.refresh_from_db()
        self.assertFalse(draft.is_draft)
        before = self.client.get('/api/v1/site/public/en/').json()['hero']
        response = self.send(url, self.data(action='save_draft', **{'post-fa-AF_title': 'پیش‌نویس خصوصی'}))
        self.assertEqual(response.status_code, 302)
        self.assertEqual(self.client.get('/api/v1/site/public/en/').json()['hero'], before)
        self.assertEqual(HeroSlide.objects.filter(draft_of=draft).count(), 1)
        response = self.send(url, self.data(**{'post-fa-AF_title': 'نسخهٔ نهایی'}))
        self.assertEqual(response.status_code, 302, response.context['form'].errors if response.status_code == 200 else '')
        self.assertFalse(HeroSlide.objects.filter(draft_of=draft).exists())
        self.assertEqual(HeroLocale.objects.get(slide=draft, locale='fa-AF').title, 'نسخهٔ نهایی')

    def test_unlimited_library_only_zero_one_two_unique_published_selections(self):
        posts = [self.add(**{'post-label': f'DEMO promotion {i}'}) for i in range(15)]
        self.assertEqual(HeroSlide.objects.filter(placement='promotion', draft_of__isnull=True).count(), 15)
        for count in [0, 1, 2, 0]:
            data = self.section_data('promotions')
            data.update({'site-promotion_one': str(posts[0].pk) if count > 0 else '', 'site-promotion_two': str(posts[1].pk) if count > 1 else '', 'action': 'publish'})
            self.assertEqual(self.send('/admin/site-setting/promotions/', data).status_code, 302)
            for locale in ['fa-AF', 'en', 'ps', 'ar']:
                hero = self.client.get(f'/api/v1/site/public/{locale}/').json()['hero']
                self.assertEqual(len(hero['cards']), count)
                if count:
                    self.assertTrue(hero['cards'][0]['fallback'] if locale != 'fa-AF' else not hero['cards'][0]['fallback'])
        data = self.section_data('promotions')
        data.update({'site-promotion_one': str(posts[0].pk), 'site-promotion_two': str(posts[0].pk), 'action': 'publish'})
        self.assertContains(self.send('/admin/site-setting/promotions/', data), 'Choose a different post')
        draft = self.add(action='save_draft')
        data['site-promotion_two'] = str(draft.pk)
        self.assertEqual(self.send('/admin/site-setting/promotions/', data).status_code, 200)

    def test_empty_or_mismatched_hero_returns_no_slides_for_frontend_default(self):
        HeroSlide.objects.all().delete()
        for mode in ['image_carousel', 'video_carousel']:
            data = self.section_data('hero')
            data.update({'site-hero_mode': mode, 'action': 'publish'})
            self.assertEqual(self.send('/admin/site-setting/hero/', data).status_code, 302)
            self.assertEqual(self.client.get('/api/v1/site/public/en/').json()['hero']['slides'], [])

    def test_draft_only_media_private_then_published_then_deleted(self):
        root = self.add('hero', action='save_draft', **{'post-image_file': image()})
        asset = root.image
        self.assertTrue(storages['site_local'].exists(asset.key))
        url = f'/api/v1/site/media/{asset.pk}/'
        anonymous = APIClient()
        self.assertEqual(anonymous.get(url).status_code, 404)
        self.assertEqual(self.client.get(url).status_code, 200)
        self.assertEqual(self.send(f'/admin/site-setting/hero/{root.pk}/', self.data()).status_code, 302)
        # The bundled replacement releases the exclusive uploaded image.
        self.assertFalse(SiteMedia.objects.filter(pk=asset.pk).exists())
        response = self.send(f'/admin/site-setting/hero/{root.pk}/delete/', {'confirm': 'delete', 'version': SiteSettings.objects.get().version})
        self.assertEqual(response.status_code, 302)
        self.assertFalse(HeroSlide.objects.filter(pk=root.pk).exists())

    def test_delete_shared_media_only_after_final_reference_including_draft(self):
        first = self.add('hero', **{'post-image_file': image()})
        asset = first.image
        second = self.add()
        second.image = asset
        second.bundled_image = False
        second.save()
        first_key = asset.key
        for item, still_used in [(first, True), (second, False)]:
            section = 'hero' if item.placement == 'main' else 'promotions'
            response = self.send(f'/admin/site-setting/{section}/{item.pk}/delete/', {'confirm': 'delete', 'version': SiteSettings.objects.get().version})
            self.assertEqual(response.status_code, 302)
            self.assertEqual(SiteMedia.objects.filter(pk=asset.pk).exists(), still_used)
            self.assertEqual(storages['site_local'].exists(first_key), still_used)

    def test_section_upload_draft_publish_retains_file_and_protects_privacy(self):
        data = self.section_data('branding')
        data.update({'site-favicon_file': image(), 'action': 'save_draft'})
        self.assertEqual(self.send('/admin/site-setting/branding/', data).status_code, 302)
        saved = SiteDraftUpload.objects.get(draft__section='branding')
        asset = saved.asset
        self.assertIsNone(SiteSettings.objects.get().favicon_id)
        self.assertEqual(APIClient().get(f'/api/v1/site/media/{asset.pk}/').status_code, 404)
        data = self.section_data('branding')
        data['action'] = 'publish'
        self.assertEqual(self.send('/admin/site-setting/branding/', data).status_code, 302)
        self.assertEqual(SiteSettings.objects.get().favicon_id, asset.pk)
        self.assertEqual(APIClient().get(f'/api/v1/site/media/{asset.pk}/').status_code, 200)
        self.assertTrue(storages['site_local'].exists(asset.key))

    def test_permissions_csrf_stale_delete_and_invalid_publication(self):
        root = self.add()
        url = f'/admin/site-setting/promotions/{root.pk}/delete/'
        self.assertEqual(self.client.post(url, {'confirm': 'delete'}).status_code, 403)
        self.assertEqual(self.send(url, {'confirm': 'delete', 'version': 0}).status_code, 200)
        self.assertTrue(HeroSlide.objects.filter(pk=root.pk).exists())
        anonymous = APIClient()
        for path in ['/admin/site-setting/promotions/', '/admin/site-setting/hero/new/', url]:
            self.assertEqual(anonymous.get(path).status_code, 302)
        response = self.send('/admin/site-setting/promotions/new/', self.data(**{'post-kind': 'video', 'post-source_url': 'javascript:alert(1)'}))
        self.assertContains(response, 'Use an HTTPS URL')

    def test_failed_storage_keeps_public_data_and_database_unchanged(self):
        before = self.client.get('/api/v1/site/public/en/').json()
        count = HeroSlide.objects.count()
        with patch.object(storages['site_local'], 'save', side_effect=OSError('synthetic failure')):
            response = self.send('/admin/site-setting/hero/new/', self.data(**{'post-image_file': image()}))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(HeroSlide.objects.count(), count)
        self.assertEqual(self.client.get('/api/v1/site/public/en/').json(), before)

    def test_crafted_hidden_flag_cannot_bypass_promotion_publication_validation(self):
        before = HeroSlide.objects.count()
        data = self.data(**{'post-enabled': False, 'post-bundled_image': False, 'post-fa-AF_title': '', 'post-fa-AF_alt': ''})
        response = self.send('/admin/site-setting/promotions/new/', data)
        self.assertEqual(response.status_code, 200)
        self.assertIn('fa-AF_title', response.context['form'].errors)
        self.assertIn('fa-AF_alt', response.context['form'].errors)
        self.assertEqual(HeroSlide.objects.count(), before)

class SiteWorkspaceStorageTests(TransactionTestCase):
    # Exercise real request commit callbacks, outside TestCase's outer rollback.
    setUp = SiteWorkspaceTests.setUp
    data = SiteWorkspaceTests.data
    add = SiteWorkspaceTests.add

    def send(self, url, data):
        token = self.client.get('/api/v1/auth/csrf/').json()['csrf_token']
        return self.client.post(url, data, HTTP_X_CSRFTOKEN=token, HTTP_ORIGIN=settings.FRONTEND_ORIGIN)

    def test_storage_delete_failure_is_pending_and_reported_without_false_success(self):
        root = self.add('hero', **{'post-image_file': image()})
        asset = root.image
        with patch.object(storages['site_local'], 'delete', side_effect=OSError('synthetic storage outage')):
            response = self.send(f'/admin/site-setting/hero/{root.pk}/delete/', {'confirm': 'delete', 'version': SiteSettings.objects.get().version})
        self.assertEqual(response.status_code, 302)
        self.assertFalse(HeroSlide.objects.filter(pk=root.pk).exists())
        asset.refresh_from_db()
        self.assertTrue(asset.pending_delete)
        self.assertTrue(storages['site_local'].exists(asset.key))
        self.assertContains(self.client.get(response['Location']), 'cleanup is pending')
        from apps.site.media import cleanup_media
        cleanup_media([asset.pk])
        self.assertFalse(SiteMedia.objects.filter(pk=asset.pk).exists())
        self.assertFalse(storages['site_local'].exists(asset.key))
