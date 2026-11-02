"""Canonical super-admin, complete safe native coverage and privileged edit races."""
from concurrent.futures import ThreadPoolExecutor
from django.apps import apps
from django.contrib.auth.models import Group
from django.db import connections
from django.test import TransactionTestCase, override_settings, RequestFactory
from django.urls import reverse, resolve
from rest_framework.test import APIClient
from apps.accounts.admin import owner_site
from apps.accounts.admin_navigation import navigation
from apps.accounts.admin_access import is_owner
from apps.accounts.models import User, AuditEvent, ActionToken, Authenticator, AccountMail
from apps.accounts.services import get_grant, AuthFailure
from tests.test_identity import PASSWORD
from tests.test_staff_admin import admin_signin, admin_post, role_user


@override_settings(OWNER_MFA_REQUIRED=False)
class SuperAdminTests(TransactionTestCase):
    def setUp(self):
        self.root = User.objects.create_user('canonical-root@example.test', PASSWORD, display_name='Canonical root', is_staff=True, is_superuser=True, email_verified=True)
        from apps.site.defaults import initialize
        initialize()
        self.client = APIClient(enforce_csrf_checks=True)
        self.assertEqual(admin_signin(self.client, self.root).status_code, 302)

    def test_root_without_owner_flag_groups_or_account_all_active_models(self):
        self.assertFalse(self.root.owner_authority or self.root.groups.exists() or self.root.accounts.exists())
        self.assertEqual(self.client.get('/admin/').status_code, 200)
        labels = ['accounts', 'organizations', 'verification', 'catalogue', 'inventory', 'marketplace', 'site', 'messaging', 'notifications', 'cart', 'orders']
        covered = []
        for label in labels:
            for model in apps.get_app_config(label).get_models():
                self.assertIn(model, owner_site._registry, model._meta.label)
                url = reverse('admin:' + model._meta.app_label + '_' + model._meta.model_name + '_changelist')
                resolve(url)
                response = self.client.get(url)
                self.assertIn(response.status_code, [200, 302], url)
                covered.append(model._meta.label_lower)
        self.assertGreater(len(covered), 50)
        response = self.client.get('/admin/accounts/user/?q=canonical')
        self.assertEqual(response.status_code, 200)
        group = Group.objects.create(name='Bounded search role')
        self.root.groups.add(group)
        self.assertContains(self.client.get('/admin/accounts/user/?q=Bounded'), self.root.email)

    def test_native_entry_owner_flag_and_fresh_revocation(self):
        client = APIClient()
        client.force_login(self.root)
        self.assertEqual(client.get('/admin/').status_code, 302)
        ordinary, account, _ = role_user('legacy-flag-only', 'accounts', [])
        ordinary.owner_authority = True
        ordinary.save()
        admin_signin(client, ordinary)
        self.assertNotContains(client.get('/admin/'), 'Registered users')
        self.assertEqual(client.get('/admin/accounts/user/').status_code, 403)
        request = RequestFactory().get('/admin/')
        request.user, request.session = self.root, self.client.session
        self.assertTrue(is_owner(request))
        # Cached request identity is insufficient after a database demotion.
        User.objects.filter(pk=self.root.pk).update(is_superuser=False)
        with self.assertRaises(AuthFailure):
            get_grant(request, 'owner')
        self.assertEqual(self.client.get('/admin/').status_code, 302)
        self.assertEqual(self.client.post('/admin/site-setting/general/', {}).status_code, 403)  # CSRF remains independent
        self.assertEqual(account.context, 'staff')

    def test_privilege_edit_self_protection_version_attestation_and_audit(self):
        target = User.objects.create_user('target@example.test', PASSWORD, display_name='Target', email_verified=False)
        path = reverse('admin:accounts_user_change', args=[target.pk])
        payload = {'display_name': 'Target', 'is_active': 'on', 'is_staff': 'on', 'is_superuser': 'on', 'attest_staff_email': 'on', 'authority_version': target.credential_epoch, '_save': 'Save'}
        self.assertEqual(admin_post(self.client, path, payload).status_code, 302)
        target.refresh_from_db()
        self.assertTrue(target.is_superuser and target.email_verified)
        self.assertTrue(AuditEvent.objects.filter(actor=self.root, subject=target, action="staff_email_attested").exists())
        self.assertFalse(target.owner_authority or target.groups.exists() or target.accounts.exists())
        self.assertTrue(AuditEvent.objects.filter(actor=self.root, subject=target, changed_fields__contains=['is_superuser']).exists())
        self.assertEqual(admin_post(self.client, path, payload).status_code, 403)  # old epoch
        self_path = reverse('admin:accounts_user_change', args=[self.root.pk])
        self.assertEqual(admin_post(self.client, self_path, {'display_name': 'Root', 'is_active': 'on'}).status_code, 403)
        self.root.refresh_from_db()
        self.assertTrue(self.root.is_superuser)

    def test_concurrent_cross_demotion_keeps_one_root(self):
        other = User.objects.create_user('other-root@example.test', PASSWORD, display_name='Other root', is_staff=True, is_superuser=True, email_verified=True)
        second = APIClient(enforce_csrf_checks=True)
        admin_signin(second, other)
        def demote(client, target):
            try:
                return admin_post(client, reverse('admin:accounts_user_change', args=[target.pk]), {'display_name': target.display_name, 'is_active': 'on', 'is_staff': 'on', 'authority_version': target.credential_epoch, '_save': 'Save'}).status_code
            finally:
                connections.close_all()
        with ThreadPoolExecutor(2) as pool:
            results = list(pool.map(lambda pair: demote(*pair), [(self.client, other), (second, self.root)]))
        self.assertEqual(results.count(302), 1)
        self.assertEqual(results.count(403), 1)
        self.assertEqual(User.objects.filter(is_superuser=True, is_staff=True, is_active=True, email_verified=True).count(), 1)

    def test_safe_security_metadata_and_generic_write_denial(self):
        from django.utils import timezone
        from datetime import timedelta
        token = ActionToken.objects.create(user=self.root, digest='NEVER-EXPOSE-TOKEN-DIGEST', purpose='reset', credential_state='NEVER-EXPOSE-STATE', expires_at=timezone.now()+timedelta(hours=1))
        outbox = AccountMail.objects.create(token=token, encrypted_payload='NEVER-EXPOSE-ENCRYPTED-PAYLOAD', expires_at=token.expires_at)
        device = Authenticator.objects.create(user=self.root, encrypted_secret='NEVER-EXPOSE-FACTOR', confirmed=False)
        for obj in [token, outbox, device]:
            info = obj._meta
            url = reverse(f'admin:{info.app_label}_{info.model_name}_change', args=[obj.pk])
            response = self.client.get(url)
            self.assertEqual(response.status_code, 200)
            self.assertNotContains(response, 'NEVER-EXPOSE')
            self.assertEqual(admin_post(self.client, url, {'_save': 'Save'}).status_code, 403)
            self.assertEqual(self.client.get(reverse(f'admin:{info.app_label}_{info.model_name}_delete', args=[obj.pk])).status_code, 403)

    def test_sidebar_every_link_resolves_and_only_one_filtered_account_active(self):
        request = RequestFactory().get('/admin/accounts/account/?context__exact=seller')
        request.user, request.session = self.root, self.client.session
        groups = navigation(request)
        self.assertEqual(str(groups[-1]['title']), 'Site Settings')
        active = [str(item['title']) for group in groups for item in group['items'] if item['active']]
        self.assertEqual(active, ['Seller accounts'])
        for group in groups:
            for item in group['items']:
                resolve(item['link'].split('?')[0])
                self.assertIn(self.client.get(item['link']).status_code, [200, 302], item['link'])

    @override_settings(OWNER_MFA_REQUIRED=True)
    def test_canonical_root_mfa_true_and_reenable_continuity(self):
        client = APIClient(enforce_csrf_checks=True)
        response = admin_signin(client, self.root)
        self.assertEqual(response.context['stage'], 'complete')
        self.assertEqual(client.get('/admin/').status_code, 200)
        device = Authenticator.objects.get(user=self.root)
        secret = device.encrypted_secret
        self.assertEqual(self.client.get('/admin/').status_code, 302)  # old password-only grant
        self.assertEqual(Authenticator.objects.get(pk=device.pk).encrypted_secret, secret)

    def test_matrix_routes_cover_registry_and_safe_session_parent(self):
        # This retained route contract is executable without private/local docs.
        # New Phase 9 models must ALSO be registered; no prior entry may vanish.
        legacy = {
            'accounts.account',
            'accounts.accountmail',
            'accounts.actiontoken',
            'accounts.auditevent',
            'accounts.authenticator',
            'accounts.browserauthority',
            'accounts.contextgrant',
            'accounts.googleattempt',
            'accounts.googleidentity',
            'accounts.mailattempt',
            'accounts.ratebucket',
            'accounts.recoverycode',
            'accounts.user',
            'admin.logentry',
            'auth.group',
            'auth.permission',
            'catalogue.catalogueevent',
            'catalogue.category',
            'catalogue.pricechange',
            'catalogue.product',
            'catalogue.productimage',
            'catalogue.saleunit',
            'catalogue.sourcerevision',
            'catalogue.translation',
            'catalogue.translationbudget',
            'catalogue.translationjob',
            'catalogue.variant',
            'contenttypes.contenttype',
            'inventory.allocation',
            'inventory.allocationline',
            'inventory.batch',
            'inventory.bucket',
            'inventory.movement',
            'inventory.operation',
            'inventory.position',
            'inventory.recovery',
            'inventory.shortage',
            'marketplace.featuredstore',
            'marketplace.store',
            'marketplace.storeevent',
            'marketplace.storemedia',
            'marketplace.storerevision',
            'organizations.businessprofile',
            'organizations.invitation',
            'organizations.invitationmail',
            'organizations.membership',
            'organizations.ownershiptransfer',
            'site.herolocale',
            'site.heroslide',
            'site.pageseo',
            'site.sitedraft',
            'site.sitedraftupload',
            'site.sitelocale',
            'site.sitemedia',
            'site.sitesettings',
            'verification.evidence',
            'verification.reviewcase',
        }
        communication = {
            model._meta.label_lower
            for label in ('messaging', 'notifications')
            for model in apps.get_app_config(label).get_models()
        }
        commerce = {
            'cart.cart','cart.cartline','cart.cartcommand','cart.mergereceipt',
            'orders.sellercheckoutterms','orders.orderpolicy','orders.checkoutsubmission','orders.checkoutoutcome',
            'orders.sellerorder','orders.orderline','orders.invoice','orders.orderevent',
        }
        negotiation = {"orders."+name for name in ["negotiation", "negotiationrevision", "negotiationevent", "negotiationcommand", "negotiationsubmission", "negotiationoutcome", "negotiationsubmissionfence"]}
        runtime = {m._meta.label_lower for m in apps.get_app_config("runtime").get_models()}
        self.assertEqual(legacy | communication | commerce | negotiation | runtime, {model._meta.label_lower for model in owner_site._registry})
        for label in legacy | communication | commerce | negotiation | runtime:
            app, model = label.split('.')
            self.assertTrue(resolve(reverse(f'admin:{app}_{model}_changelist')))
        self.assertFalse(any(model._meta.label_lower == 'sessions.session' for model in owner_site._registry))

    def test_native_profile_edit_uses_revision_service_and_retains_stale_input(self):
        from apps.accounts.models import Account
        from apps.organizations.models import BusinessProfile
        from apps.verification.models import ReviewCase
        user = User.objects.create_user('profile-subject@example.test', PASSWORD, display_name='Profile subject', email_verified=True)
        account = Account.objects.create(user=user, context='seller')
        profile = BusinessProfile.objects.create(account=account, kind='individual', display_name='Reviewed profile', legal_name='Original name')
        ReviewCase.objects.create(profile=profile, status='approved', snapshot={'display_name': profile.display_name})
        path = reverse('admin:organizations_businessprofile_change', args=[profile.pk])
        data = {'display_name': 'Retained identity', 'legal_name': 'Changed legal identity', 'business_type': 'Trading', 'contact_phone': '+93700000000', 'location': 'Synthetic address', 'representative': '', 'expected_version': profile.version, '_save': 'Save'}
        self.assertEqual(admin_post(self.client, path, data).status_code, 302)
        profile.refresh_from_db()
        self.assertEqual((profile.version, profile.revision), (2, 2))
        self.assertEqual(profile.cases.get(revision=2).status, 'draft')
        self.assertEqual(profile.cases.get(revision=1).status, 'approved')
        response = admin_post(self.client, path, {**data, 'display_name': 'Stale retained input'})
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'Your input is retained')
        self.assertContains(response, 'Stale retained input')
        profile.refresh_from_db()
        self.assertEqual(profile.display_name, 'Retained identity')

    def test_directory_checks_are_bounded_and_do_not_cache_action_authority(self):
        from django.test.utils import CaptureQueriesContext
        from django.db import connection
        request = RequestFactory().get('/admin/')
        request.user, request.session = self.root, self.client.session
        with CaptureQueriesContext(connection) as queries:
            owner_site.get_app_list(request)
        self.assertLessEqual(len(queries), 4)
        self.assertFalse(hasattr(request, '_admin_directory_root'))
        User.objects.filter(pk=self.root.pk).update(is_staff=False)
        self.assertFalse(is_owner(request))
        self.assertFalse(owner_site.has_permission(request))

    def test_native_view_translates_late_grant_failure_to_permission_denial(self):
        from django.core.exceptions import PermissionDenied
        request = RequestFactory().get('/admin/')
        request.user, request.session = self.root, self.client.session
        def revoked_during_view(request):
            raise AuthFailure()
        with self.assertRaises(PermissionDenied):
            owner_site.admin_view(revoked_during_view)(request)

    def test_native_mutation_callbacks_recheck_after_early_permission_checks(self):
        request = RequestFactory().post('/admin/auth/group/add/')
        request.user, request.session = self.root, self.client.session
        admin = owner_site._registry[Group]
        self.assertTrue(admin.has_add_permission(request))
        User.objects.filter(pk=self.root.pk).update(is_superuser=False)
        target = Group(name='Never saved after demotion')
        for callback in [lambda: admin.save_model(request, target, None, False),
                         lambda: admin.save_related(request, None, [], False),
                         lambda: admin.delete_model(request, target),
                         lambda: admin.delete_queryset(request, Group.objects.none())]:
            with self.assertRaises(AuthFailure):
                callback()
        self.assertFalse(Group.objects.filter(name=target.name).exists())

    def test_legacy_owner_attestation_readonly_failure_and_prepared_form(self):
        """Reproduce the former declared-only readonly field without external source."""
        from django import forms
        from django.contrib.admin.utils import label_for_field
        from unfold.admin import ModelAdmin

        class FormerIdentityForm(forms.ModelForm):
            attest_staff_email = forms.BooleanField(required=False)

            class Meta:
                model = User
                fields = ['email']

        class FormerIdentityAdmin(ModelAdmin):
            form = FormerIdentityForm
            fieldsets = [(None, {'fields': ['email', 'attest_staff_email']})]

            def get_readonly_fields(self, request, obj=None):
                return ['attest_staff_email'] if obj and obj.owner_authority else []

        legacy = User.objects.create_superuser('legacy-owner-form@example.test', PASSWORD, display_name='Synthetic legacy owner', email_verified=True)
        request = RequestFactory().get('/admin/accounts/user/')
        request.user, request.session = self.root, self.client.session
        previous = FormerIdentityAdmin(User, owner_site)
        previous_form = previous.get_form(request, legacy)(instance=legacy)
        self.assertNotIn('attest_staff_email', previous_form.fields)
        with self.assertRaisesMessage(AttributeError, "Unable to lookup 'attest_staff_email'"):
            label_for_field('attest_staff_email', User, previous, form=previous_form)
        prepared = owner_site._registry[User]
        prepared_form = prepared.get_form(request, legacy)(instance=legacy)
        self.assertIn('attest_staff_email', prepared_form.fields)
        self.assertTrue(label_for_field('attest_staff_email', User, prepared, form=prepared_form))
        self.assertEqual(self.client.get(reverse('admin:accounts_user_change', args=[legacy.pk])).status_code, 200)
