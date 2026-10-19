"""Isolation boundaries for generated test configuration and teardown ownership."""

from unittest.mock import MagicMock, patch
from django.core.exceptions import ImproperlyConfigured
from django.test import SimpleTestCase
from config.testing import assert_owned_database, owned_database, run_id, validate_target


class DisposableDatabaseGuardTests(SimpleTestCase):
    identifier = "0123456789abcdef"

    def database(self):
        return owned_database(
            f"postgresql://test_{self.identifier}:synthetic-only@postgres/test_rezayi_{self.identifier}", self.identifier
        )

    def test_missing_or_invalid_run_cannot_use_saved_owner_or_test_keys(self):
        for value in ("", "phase03", "../../existing", "0" * 15):
            with patch.dict("os.environ", {"REZAYI_TEST_RUN_ID": value}):
                with self.assertRaises(ImproperlyConfigured):
                    run_id()

    def test_generated_target_accepts_only_its_own_database_role_and_host(self):
        expected = self.database()
        with patch.dict("os.environ", {"REZAYI_TEST_RUN_ID": self.identifier}):
            validate_target(expected)
            for field, value in (("HOST", "host.docker.internal"), ("NAME", "bazar_rezayi_db"),
                                 ("USER", "phase02"), ("NAME", "test_rezayi_ffffffffffffffff"),
                                 ("TEST", {"NAME": "bazar_rezayi_db"})):
                with self.subTest(field=field), self.assertRaises(ImproperlyConfigured):
                    validate_target({**expected, field: value})

    def test_server_marker_must_match_before_database_mutation(self):
        connection = MagicMock()
        connection.settings_dict = self.database()
        cursor = connection.cursor.return_value.__enter__.return_value
        name = f"test_rezayi_{self.identifier}"
        role = f"test_{self.identifier}"
        with patch.dict("os.environ", {"REZAYI_TEST_RUN_ID": self.identifier}):
            for row in ((name, role, None), (name, role, "ffffffffffffffff"), ("bazar_rezayi_db", role, self.identifier),
                        (name, "existing_owner", self.identifier)):
                cursor.fetchone.return_value = row
                with self.subTest(marker=row[-1]), self.assertRaises(ImproperlyConfigured):
                    assert_owned_database(connection)
            cursor.fetchone.return_value = (name, role, self.identifier)
            assert_owned_database(connection)
