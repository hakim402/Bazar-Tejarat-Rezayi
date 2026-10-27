"""Native admin provisioning, effective roles, revocation and immutable inspection."""

import io
import json
import time
from unittest.mock import patch
from django.contrib.auth.models import Group, Permission
from django.core.management import call_command
from django.test import TransactionTestCase, override_settings
from rest_framework.test import APIClient
from apps.accounts.models import User, Account, AuditEvent, Authenticator
from tests.test_identity import PASSWORD, code


def admin_post(client, path, data):
    client.get("/admin/login/")
    return client.post(path, data, format="multipart", HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value)


def admin_signin(client, user, *, enroll=True):
    response = admin_post(client, "/admin/login/", {"stage": "password", "email": user.email, "password": PASSWORD})
    if response.status_code == 302:
        return response
    if enroll and response.context["stage"] == "enroll_start":
        admin_post(client, "/admin/login/", {"stage": "enroll"})
    if enroll:
        device = Authenticator.objects.get(user=user)
        challenge_time = max(time.time(), (device.last_t + 1) * 30)
        with patch("time.time", return_value=challenge_time):
            response = admin_post(client, "/admin/login/", {"stage": "challenge", "code": code(device)})
    return response


def role_user(name, app, codes):
    user = User.objects.create_user(
        name + "@example.test", PASSWORD, display_name="Synthetic " + name, is_staff=True, email_verified=True
    )
    account = Account.objects.create(user=user, context="staff")
    group = Group.objects.create(name="Synthetic role " + name)
    group.permissions.set(Permission.objects.filter(content_type__app_label=app, codename__in=codes))
    user.groups.add(group)
    return user, account, group


@override_settings(OWNER_MFA_REQUIRED=True)
class StaffAdminTests(TransactionTestCase):
    def setUp(self):
        self.owner = User.objects.create_superuser(
            "admin-transition-owner@example.test", PASSWORD, display_name="Synthetic owner", email_verified=True
        )
        self.client = APIClient(enforce_csrf_checks=True)
        admin_signin(self.client, self.owner)

    def test_superadmin_provisions_staff_real_form_attestation_groups_and_native_mfa(self):
        group = Group.objects.create(name="Synthetic shortage reader")
        group.permissions.set(Permission.objects.filter(content_type__app_label="inventory", codename="read_shortages"))
        path = "/admin/accounts/user/add/"
        data = {
            "email": "provisioned-staff@example.test",
            "display_name": "Synthetic provisioned staff",
            "password1": PASSWORD,
            "password2": PASSWORD,
            "is_staff": "on",
            "groups": [group.pk],
            "attest_staff_email": "on",
            "_save": "Save",
        }
        response = admin_post(self.client, path, {**data, "attest_staff_email": ""})
        self.assertEqual(response.status_code, 200)
        self.assertFalse(User.objects.filter(email=data["email"]).exists())
        response = admin_post(self.client, path, data)
        self.assertEqual(response.status_code, 302)
        user = User.objects.get(email=data["email"])
        self.assertTrue(user.check_password(PASSWORD))
        self.assertTrue(user.email_verified)
        self.assertFalse(user.is_superuser or user.owner_authority)
        account = user.accounts.get(context="staff")
        self.assertFalse(account.permission_groups.exists())
        self.assertEqual(list(user.groups.all()), [group])
        self.assertTrue(AuditEvent.objects.filter(subject=user, action="staff_email_attested").exists())
        staff = APIClient(enforce_csrf_checks=True)
        response = admin_signin(staff, user)
        self.assertEqual(response.context["stage"], "complete")
        self.assertEqual(staff.get("/admin/").status_code, 200)
        self.assertContains(staff.get("/admin/"), "Shortages")
        self.assertNotContains(staff.get("/admin/"), "Registered users")
        self.assertNotContains(staff.get("/admin/"), "Site Setting")
        for url in [
            "/admin/accounts/user/",
            "/admin/auth/group/",
            "/admin/accounts/account/",
            "/admin/accounts/auditevent/",
            "/admin/site-setting/general/",
            "/admin/inventory/movement/",
        ]:
            self.assertIn(staff.get(url).status_code, [403, 404], url)
            self.assertIn(
                admin_post(staff, url, {"is_superuser": "on", "groups": [group.pk]}).status_code, [403, 404], url
            )
        user.groups.clear()
        self.assertEqual(staff.get("/admin/inventory/shortage/").status_code, 403)
        user.groups.add(group)
        account.status = "suspended"
        account.save()
        self.assertEqual(staff.get("/admin/").status_code, 302)

    def test_empty_group_model_grant_and_permission_union_do_not_admit_unrelated_data(self):
        user, account, group = role_user("empty", "accounts", [])
        client = APIClient(enforce_csrf_checks=True)
        admin_signin(client, user)
        self.assertNotContains(client.get("/admin/"), "Verification cases")
        legacy = Group.objects.create(name="Synthetic legacy excess")
        legacy.permissions.set(Permission.objects.filter(content_type__app_label="inventory"))
        account.permission_groups.add(legacy)
        admin_signin(client, user)
        # Old authority is retained but never unioned with canonical role assignments.
        self.assertEqual(client.get("/admin/inventory/shortage/").status_code, 403)
        group.permissions.set(Permission.objects.filter(content_type__app_label="accounts", codename="change_user"))
        self.assertEqual(client.get("/admin/accounts/user/").status_code, 403)
        self.assertEqual(
            client.get("/admin/autocomplete/?app_label=accounts&model_name=account&field_name=user").status_code, 403
        )

    def test_legacy_mapping_dry_run_explicit_idempotent_preserves_membership_history(self):
        user, account, group = role_user("legacy", "verification", ["decide_review"])
        user.groups.clear()
        user.is_staff = False
        user.save()
        account.permission_groups.add(group)
        before = list(account.permission_groups.values_list("pk", flat=True))
        from apps.organizations.profiles import create_profile
        from tests.test_organizations import identity, ServiceActor, profile_values

        profile = create_profile(ServiceActor(identity("mapping-applicant")), profile_values("individual"))
        case = profile.cases.get()
        case.assigned_to = account
        case.save()
        historical = list(Account.objects.filter(pk=account.pk).values("id", "user_id", "context", "status"))
        out = io.StringIO()
        call_command("map_staff_admin", stdout=out)
        self.assertTrue(json.loads(out.getvalue())["would_enable_admin"])
        user.refresh_from_db()
        self.assertFalse(user.is_staff)
        self.assertFalse(user.groups.exists())
        call_command("map_staff_admin", activate=str(account.pk), apply=True, stdout=io.StringIO())
        self.assertEqual(list(user.groups.values_list("pk", flat=True)), before)
        count = AuditEvent.objects.filter(action="staff_admin_legacy_activated").count()
        call_command("map_staff_admin", activate=str(account.pk), apply=True, stdout=io.StringIO())
        self.assertEqual(AuditEvent.objects.filter(action="staff_admin_legacy_activated").count(), count)
        self.assertEqual(list(account.permission_groups.values_list("pk", flat=True)), before)
        case.refresh_from_db()
        self.assertEqual(case.assigned_to_id, account.pk)
        self.assertEqual(
            list(Account.objects.filter(pk=account.pk).values("id", "user_id", "context", "status")), historical
        )

    def test_role_isolation_on_all_registered_models(self):
        from apps.accounts.admin import owner_site

        role_matrix = [
            (
                "verification",
                "verification",
                ["view_queue", "read_evidence", "decide_review"],
                {"verification.reviewcase", "verification.evidence"},
            ),
            ("transfer", "verification", ["review_transfer"], {"organizations.ownershiptransfer"}),
            ("source", "catalogue", ["review_source"], {"catalogue.product"}),
            ("translation", "catalogue", ["review_translation"], {"catalogue.product"}),
            ("taxonomy", "catalogue", ["manage_taxonomy"], {"catalogue.category", "catalogue.saleunit"}),
            ("shortage", "inventory", ["read_shortages"], {"inventory.shortage"}),
            ("audit", "inventory", ["view_movement"], {"inventory.movement"}),
        ]
        for name, app, codes, allowed in role_matrix:
            user, account, group = role_user(name, app, codes)
            client = APIClient(enforce_csrf_checks=True)
            admin_signin(client, user)
            for model in owner_site._registry:
                path = f"/admin/{model._meta.app_label}/{model._meta.model_name}/"
                response = client.get(path)
                self.assertEqual(
                    response.status_code,
                    200 if model._meta.label_lower in allowed else 403,
                    (name, model._meta.label_lower),
                )
                if model._meta.label_lower in allowed:
                    self.assertEqual(
                        admin_post(client, path, {"action": "delete_selected", "_selected_action": "1"}).status_code,
                        200,
                    )
            group.permissions.clear()
            for label in allowed:
                app_label, model_name = label.split(".")
                self.assertEqual(client.get(f"/admin/{app_label}/{model_name}/").status_code, 403)


class StaffSelfServiceTests(TransactionTestCase):
    def setUp(self):
        self.user, self.account, _ = role_user("self-service", "accounts", [])
        self.client = APIClient(enforce_csrf_checks=True)
        admin_signin(self.client, self.user)

    def test_own_profile_updates_only_name_without_identity_or_role_mass_assignment(self):
        response = admin_post(
            self.client,
            "/admin/profile/",
            {
                "display_name": "Synthetic updated own name",
                "is_superuser": "on",
                "owner_authority": "on",
                "groups": ["1"],
                "email_verified": "",
            },
        )
        self.assertEqual(response.status_code, 302)
        self.user.refresh_from_db()
        self.assertEqual(self.user.display_name, "Synthetic updated own name")
        self.assertFalse(self.user.is_superuser or self.user.owner_authority)
        self.assertFalse(self.user.groups.filter(permissions__isnull=False).exists())
        self.assertTrue(self.user.email_verified)
        self.assertTrue(AuditEvent.objects.filter(actor=self.user, context="staff", action="profile_updated").exists())
        self.assertEqual(self.client.get("/admin/accounts/user/").status_code, 403)

    def test_native_password_uses_shared_epoch_logout_and_mfa_continuity(self):
        from tests.test_identity import NEW_PASSWORD
        from apps.accounts.models import RateBucket, BrowserAuthority

        for _ in range(2):
            response = admin_post(
                self.client,
                "/admin/password_change/",
                {
                    "old_password": "wrong",
                    "new_password1": NEW_PASSWORD,
                    "new_password2": NEW_PASSWORD,
                },
            )
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.context["form"].errors)
        self.assertGreaterEqual(RateBucket.objects.filter(count__gte=2).count(), 2)
        before = self.user.credential_epoch
        response = admin_post(
            self.client,
            "/admin/password_change/",
            {
                "old_password": PASSWORD,
                "new_password1": NEW_PASSWORD,
                "new_password2": NEW_PASSWORD,
            },
        )
        self.assertEqual(response.status_code, 302)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password(NEW_PASSWORD))
        self.assertGreater(self.user.credential_epoch, before)
        self.assertTrue(Authenticator.objects.filter(user=self.user, confirmed=True).exists())
        self.assertFalse(BrowserAuthority.objects.filter(user=self.user, revoked=False).exists())
        self.assertEqual(self.client.get("/admin/").status_code, 302)

    def test_failed_factor_reset_attempts_are_durably_throttled(self):
        from apps.accounts.models import RateBucket

        for _ in range(2):
            response = admin_post(self.client, "/admin/factor-reset/", {"password": "wrong", "code": "000000"})
            self.assertTrue(response.context["form"].errors)
        # Rate buckets survive the rejected transaction, unlike factor/device changes.
        self.assertGreaterEqual(RateBucket.objects.filter(count__gte=2).count(), 2)
        self.assertTrue(Authenticator.objects.filter(user=self.user, confirmed=True).exists())

    def test_logout_records_staff_context_and_revokes_browser_authority(self):
        from apps.accounts.models import BrowserAuthority

        admin_post(self.client, "/admin/logout/", {})
        self.assertTrue(
            AuditEvent.objects.filter(actor=self.user, context="staff", action="staff_session_signed_out").exists()
        )
        self.assertFalse(AuditEvent.objects.filter(actor=self.user, context="owner").exists())
        self.assertFalse(BrowserAuthority.objects.filter(user=self.user, revoked=False).exists())
        self.assertEqual(self.client.get("/admin/").status_code, 302)
