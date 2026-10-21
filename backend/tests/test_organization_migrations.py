"""Forward upgrade of the Phase 03 schema with synthetic credentials and permissions preserved."""

from django.contrib.auth.hashers import make_password
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase

from config.testing import assert_owned_database


class OrganizationMigrationTests(TransactionTestCase):
    def test_phase03_upgrade_preserves_identity_credentials_contexts_and_permission_links(self):
        assert_owned_database(connection)
        executor = MigrationExecutor(connection)
        latest = executor.loader.graph.leaf_nodes()
        old = [
            ("verification", None),
            ("organizations", None),
            ("accounts", "0002_accountmail_browserauthority_contextgrant_and_more"),
        ]
        try:
            executor.migrate(old)
            executor = MigrationExecutor(connection)
            state = executor.loader.project_state(
                [
                    ("accounts", "0002_accountmail_browserauthority_contextgrant_and_more"),
                    ("auth", "0012_alter_user_first_name_max_length"),
                ]
            )
            User = state.apps.get_model("accounts", "User")
            Account = state.apps.get_model("accounts", "Account")
            Group = state.apps.get_model("auth", "Group")
            Permission = state.apps.get_model("auth", "Permission")
            password_hash = make_password("Synthetic-migration-fixture-2048")
            user = User.objects.create(
                email="upgrade@example.test",
                password=password_hash,
                display_name="Synthetic upgrade",
                email_verified=True,
            )
            buyer = Account.objects.create(user=user, context="buyer", review_status="not_requested")
            seller = Account.objects.create(user=user, context="seller", review_status="pending")
            staff = Account.objects.create(user=user, context="staff")
            group = Group.objects.create(name="Synthetic retained permission")
            permission = Permission.objects.filter(codename="handle_support").first()
            group.permissions.add(permission)
            staff.permission_groups.add(group)
            executor.migrate(latest)
            from apps.accounts.models import User as CurrentUser, Account as CurrentAccount

            restored = CurrentUser.objects.get(pk=user.pk)
            self.assertEqual(restored.password, password_hash)
            self.assertEqual(restored.credential_epoch, 1)
            self.assertEqual(
                set(CurrentAccount.objects.filter(user=restored).values_list("pk", flat=True)),
                {buyer.pk, seller.pk, staff.pk},
            )
            self.assertTrue(
                CurrentAccount.objects.get(pk=staff.pk)
                .permission_groups.filter(pk=group.pk, permissions=permission.pk)
                .exists()
            )
            self.assertEqual(CurrentAccount.objects.get(pk=seller.pk).review_status, "pending")
        finally:
            MigrationExecutor(connection).migrate(latest)
