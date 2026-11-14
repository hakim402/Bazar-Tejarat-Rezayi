"""Owner draft/publication, two-card selection, routes and permanent file lifecycle."""
from tests.test_identity import native_auth
from unittest.mock import patch
from django.conf import settings
from django.core.files.storage import storages
from django.test import TestCase, TransactionTestCase, override_settings
from rest_framework.test import APIClient
from apps.accounts.models import User, Authenticator
from apps.site.defaults import initialize
from apps.site.models import SiteSettings, HeroSlide, HeroLocale, SiteMedia, SiteDraft, SiteDraftUpload, SiteLocale
from apps.site.sections import SECTIONS, ROUTE_SECTIONS
from apps.site.services import DRAFT_SECTION
from tests.test_identity import PASSWORD, signin, code
from tests.test_site import image, settings_form_data, SETTINGS_URL


class SiteWorkspaceTests(TestCase):
    def setUp(self):
        initialize()
        self.owner = User.objects.create_superuser('workspace-owner@example.test', PASSWORD, email_verified=True)
        self.client = APIClient(enforce_csrf_checks=True)
        signin(self.client, "owner", self.owner.email)
        native_auth(self.client, "enroll", {})
        native_auth(self.client, "challenge", {"code": code(Authenticator.objects.get(user=self.owner))})

    def send(self, url, data, action='publish'):
        # Unfold submit-line buttons POST '{app}_{model}_{action}' keys.
        model = 'sitesettings' if '/sitesettings/' in url else 'heroslide'
        token = self.client.get('/api/v1/auth/csrf/').json()['csrf_token']
        with self.captureOnCommitCallbacks(execute=True):
            return self.client.post(url, {f'site_{model}_{action}': '1', **data}, HTTP_X_CSRFTOKEN=token, HTTP_ORIGIN=settings.FRONTEND_ORIGIN)

    def data(self, **values):
        result = {'version': SiteSettings.objects.get(pk=1).version, 'label': 'DEMO workspace', 'placement': 'promotion', 'kind': 'image', 'enabled': True, 'position': 1, 'silent': True, 'bundled_image': True, 'fa-AF_title': 'عنوان آزمایشی', 'fa-AF_alt': 'تصویر آزمایشی', 'fa-AF_cta_label': 'دیدن', 'fa-AF_cta_url': '/about'}
        result.update(values)
        return result

    def add(self, placement='promotion', action='publish', **values):
        response = self.send('/admin/site/heroslide/add/', self.data(placement=placement, **values), action=action)
        self.assertEqual(response.status_code, 302, response.context['adminform'].form.errors if response.status_code == 200 else response.status_code)
        # The redirect keeps the public identity: .../heroslide/<uuid>/change/.
        return HeroSlide.objects.get(pk=response['Location'].strip('/').split('/')[-2])

    @override_settings(LANGUAGE_CODE="en")
    def test_routes_navigation_two_modes_and_legacy_redirects(self):
        response = self.client.get(SETTINGS_URL)
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'Save draft')
        self.assertContains(response, 'Publish')
        self.assertEqual(list(response.context['adminform'].form.fields['hero_mode'].choices), [('image_carousel', 'Image Carousel'), ('video_carousel', 'Video Carousel')])
        for section in SECTIONS:
            target = SETTINGS_URL + f'?section={section.key}' if section.key in ROUTE_SECTIONS else SETTINGS_URL
            self.assertEqual(self.client.get(f'/admin/site-setting/{section.key}/')['Location'], target)
        root = self.add()
        self.assertEqual(self.client.get('/admin/site-setting/promotions/new/')['Location'], '/admin/site/heroslide/add/')
        self.assertEqual(self.client.get(f'/admin/site-setting/promotions/{root.pk}/')['Location'], f'/admin/site/heroslide/{root.pk}/change/')
        self.assertEqual(self.client.get(f'/admin/site-setting/promotions/{root.pk}/delete/')['Location'], f'/admin/site/heroslide/{root.pk}/delete/')
        from apps.accounts.admin.navigation import navigation
        self.assertEqual(str(navigation(response.wsgi_request)[-1]['items'][0]['title']), 'Site Settings')

    def test_settings_draft_is_private_and_publish_consumes_it(self):
        before = self.client.get('/api/v1/site/public/en/').json()
        data = settings_form_data(self.client)
        data['en_name'] = 'DEMO draft identity'
        response = self.send(SETTINGS_URL, data, action='save_draft')
        self.assertEqual(response.status_code, 302)
        self.assertEqual(self.client.get('/api/v1/site/public/en/').json(), before)
        self.assertTrue(SiteDraft.objects.filter(section=DRAFT_SECTION).exists())
        # The saved draft reopens with the typed value, still private.
        reopened = self.client.get(SETTINGS_URL).context['adminform'].form
        self.assertEqual(reopened['en_name'].value(), 'DEMO draft identity')
        data = settings_form_data(self.client)
        response = self.send(SETTINGS_URL, data)
        self.assertEqual(response.status_code, 302, response.context['adminform'].form.errors if response.status_code == 200 else '')
        self.assertFalse(SiteDraft.objects.filter(section=DRAFT_SECTION).exists())
        self.assertEqual(SiteLocale.objects.get(locale='en').name, 'DEMO draft identity')

    def test_legacy_section_drafts_fold_into_the_unified_draft(self):
        site = SiteSettings.objects.get()
        SiteDraft.objects.create(settings=site, section='general', form_data={'site-en_name': 'DEMO legacy', 'site-default_theme': 'dark'})
        SiteDraft.objects.create(settings=site, section='contacts', form_data={'site-phone': '+1234567890'})
        form = self.client.get(SETTINGS_URL).context['adminform'].form
        self.assertEqual(form['en_name'].value(), 'DEMO legacy')
        self.assertEqual(form['default_theme'].value(), 'dark')
        self.assertEqual(form['phone'].value(), '+1234567890')
        self.assertEqual(list(SiteDraft.objects.values_list('section', flat=True)), [DRAFT_SECTION])

    def test_new_draft_and_edits_do_not_replace_stable_published_post(self):
        draft = self.add('main', action='save_draft', image_file=image(), **{'fa-AF_title': ''})
        self.assertTrue(draft.is_draft)
        self.assertNotIn(str(draft.pk), [s['id'] for s in self.client.get('/api/v1/site/public/en/').json()['hero']['slides']])
        url = f'/admin/site/heroslide/{draft.pk}/change/'
        response = self.send(url, self.data(placement='main', **{'fa-AF_title': 'نسخهٔ نشرشده'}))
        self.assertEqual(response.status_code, 302)
        draft.refresh_from_db()
        self.assertFalse(draft.is_draft)
        before = self.client.get('/api/v1/site/public/en/').json()['hero']
        response = self.send(url, self.data(placement='main', **{'fa-AF_title': 'پیش‌نویس خصوصی'}), action='save_draft')
        self.assertEqual(response.status_code, 302)
        self.assertEqual(self.client.get('/api/v1/site/public/en/').json()['hero'], before)
        self.assertEqual(HeroSlide.objects.filter(draft_of=draft).count(), 1)
        response = self.send(url, self.data(placement='main', **{'fa-AF_title': 'نسخهٔ نهایی'}))
        self.assertEqual(response.status_code, 302, response.context['adminform'].form.errors if response.status_code == 200 else '')
        self.assertFalse(HeroSlide.objects.filter(draft_of=draft).exists())
        self.assertEqual(HeroLocale.objects.get(slide=draft, locale='fa-AF').title, 'نسخهٔ نهایی')

    def test_unlimited_library_only_zero_one_two_unique_published_selections(self):
        posts = [self.add(label=f'DEMO promotion {i}') for i in range(15)]
        self.assertEqual(HeroSlide.objects.filter(placement='promotion', draft_of__isnull=True).count(), 15)
        for count in [0, 1, 2, 0]:
            data = settings_form_data(self.client)
            data.update({'promotion_one': str(posts[0].pk) if count > 0 else '', 'promotion_two': str(posts[1].pk) if count > 1 else ''})
            self.assertEqual(self.send(SETTINGS_URL, data).status_code, 302)
            for locale in ['fa-AF', 'en', 'ps', 'ar']:
                hero = self.client.get(f'/api/v1/site/public/{locale}/').json()['hero']
                self.assertEqual(len(hero['cards']), count)
                if count:
                    self.assertTrue(hero['cards'][0]['fallback'] if locale != 'fa-AF' else not hero['cards'][0]['fallback'])
        data = settings_form_data(self.client)
        data.update({'promotion_one': str(posts[0].pk), 'promotion_two': str(posts[0].pk)})
        self.assertContains(self.send(SETTINGS_URL, data), 'Choose a different post')
        draft = self.add(action='save_draft')
        data['promotion_two'] = str(draft.pk)
        self.assertEqual(self.send(SETTINGS_URL, data).status_code, 200)

    def test_empty_or_mismatched_hero_returns_no_slides_for_frontend_default(self):
        HeroSlide.objects.all().delete()
        for mode in ['image_carousel', 'video_carousel']:
            data = settings_form_data(self.client)
            data.update({'hero_mode': mode})
            self.assertEqual(self.send(SETTINGS_URL, data).status_code, 302)
            self.assertEqual(self.client.get('/api/v1/site/public/en/').json()['hero']['slides'], [])

    def test_draft_only_media_private_then_published_then_deleted(self):
        root = self.add('main', action='save_draft', image_file=image())
        asset = root.image
        self.assertTrue(storages['site_local'].exists(asset.key))
        url = f'/api/v1/site/media/{asset.pk}/'
        anonymous = APIClient()
        self.assertEqual(anonymous.get(url).status_code, 404)
        self.assertEqual(self.client.get(url).status_code, 200)
        self.assertEqual(self.send(f'/admin/site/heroslide/{root.pk}/change/', self.data(placement='main')).status_code, 302)
        # The bundled replacement releases the exclusive uploaded image.
        self.assertFalse(SiteMedia.objects.filter(pk=asset.pk).exists())
        response = self.send(f'/admin/site/heroslide/{root.pk}/delete/', {'post': 'yes'})
        self.assertEqual(response.status_code, 302)
        self.assertFalse(HeroSlide.objects.filter(pk=root.pk).exists())

    def test_delete_shared_media_only_after_final_reference_including_draft(self):
        first = self.add('main', image_file=image())
        asset = first.image
        second = self.add()
        second.image = asset
        second.bundled_image = False
        second.save()
        first_key = asset.key
        for item, still_used in [(first, True), (second, False)]:
            response = self.send(f'/admin/site/heroslide/{item.pk}/delete/', {'post': 'yes'})
            self.assertEqual(response.status_code, 302)
            self.assertEqual(SiteMedia.objects.filter(pk=asset.pk).exists(), still_used)
            self.assertEqual(storages['site_local'].exists(first_key), still_used)

    def test_settings_upload_draft_publish_retains_file_and_protects_privacy(self):
        data = settings_form_data(self.client)
        data.update({'favicon_file': image()})
        self.assertEqual(self.send(SETTINGS_URL, data, action='save_draft').status_code, 302)
        saved = SiteDraftUpload.objects.get(draft__section=DRAFT_SECTION)
        asset = saved.asset
        self.assertIsNone(SiteSettings.objects.get().favicon_id)
        self.assertEqual(APIClient().get(f'/api/v1/site/media/{asset.pk}/').status_code, 404)
        data = settings_form_data(self.client)
        self.assertEqual(self.send(SETTINGS_URL, data).status_code, 302)
        self.assertEqual(SiteSettings.objects.get().favicon_id, asset.pk)
        self.assertEqual(APIClient().get(f'/api/v1/site/media/{asset.pk}/').status_code, 200)
        self.assertTrue(storages['site_local'].exists(asset.key))

    def test_permissions_csrf_and_invalid_publication(self):
        root = self.add()
        url = f'/admin/site/heroslide/{root.pk}/delete/'
        self.assertEqual(self.client.post(url, {'post': 'yes'}).status_code, 403)
        anonymous = APIClient()
        for path in ['/admin/site/heroslide/', '/admin/site/heroslide/add/', url]:
            self.assertEqual(anonymous.get(path).status_code, 302)
        response = self.send('/admin/site/heroslide/add/', self.data(kind='video', source_url='javascript:alert(1)'))
        self.assertContains(response, 'Use an HTTPS URL')

    def test_failed_storage_keeps_public_data_and_database_unchanged(self):
        before = self.client.get('/api/v1/site/public/en/').json()
        count = HeroSlide.objects.count()
        with patch.object(storages['site_local'], 'save', side_effect=OSError('synthetic failure')):
            response = self.send('/admin/site/heroslide/add/', self.data(placement='main', image_file=image()))
        self.assertEqual(response.status_code, 302)
        self.assertContains(self.client.get(response['Location']), 'Changes could not be saved')
        self.assertEqual(HeroSlide.objects.count(), count)
        self.assertEqual(self.client.get('/api/v1/site/public/en/').json(), before)

    def test_crafted_hidden_flag_cannot_bypass_promotion_publication_validation(self):
        before = HeroSlide.objects.count()
        data = self.data(enabled=False, bundled_image=False, **{'fa-AF_title': '', 'fa-AF_alt': ''})
        response = self.send('/admin/site/heroslide/add/', data)
        self.assertEqual(response.status_code, 200)
        self.assertIn('fa-AF_title', response.context['adminform'].form.errors)
        self.assertIn('fa-AF_alt', response.context['adminform'].form.errors)
        self.assertEqual(HeroSlide.objects.count(), before)


class SiteWorkspaceStorageTests(TransactionTestCase):
    # Exercise real request commit callbacks, outside TestCase's outer rollback.
    setUp = SiteWorkspaceTests.setUp
    data = SiteWorkspaceTests.data
    add = SiteWorkspaceTests.add

    def send(self, url, data, action='publish'):
        model = 'sitesettings' if '/sitesettings/' in url else 'heroslide'
        token = self.client.get('/api/v1/auth/csrf/').json()['csrf_token']
        return self.client.post(url, {f'site_{model}_{action}': '1', **data}, HTTP_X_CSRFTOKEN=token, HTTP_ORIGIN=settings.FRONTEND_ORIGIN)

    def test_storage_delete_failure_is_pending_and_reported_without_false_success(self):
        root = self.add('main', image_file=image())
        asset = root.image
        with patch.object(storages['site_local'], 'delete', side_effect=OSError('synthetic storage outage')):
            response = self.send(f'/admin/site/heroslide/{root.pk}/delete/', {'post': 'yes'})
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