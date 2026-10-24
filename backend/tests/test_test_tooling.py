"""Isolation boundaries for generated test configuration and teardown ownership."""

import json
import os
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch
from django.core.exceptions import ImproperlyConfigured
from django.test import SimpleTestCase
from config.testing import assert_owned_database, owned_database, run_id, validate_target


class DisposableDatabaseGuardTests(SimpleTestCase):
    identifier = "0123456789abcdef"

    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        root = Path(directory.name) / ("rezayi-test-" + self.identifier)
        root.mkdir(mode=0o700)
        (root / "ownership.json").write_text(json.dumps({
            "run_id": self.identifier, "root": str(root.resolve()), "postgres_port": 15432,
            "database": "test_rezayi_" + self.identifier, "role": "test_" + self.identifier,
        }))
        environment = patch.dict("os.environ", {"REZAYI_TEST_RUN_ID": self.identifier, "REZAYI_TEST_ROOT": str(root)})
        environment.start()
        self.addCleanup(environment.stop)

    def database(self):
        return owned_database(
            f"postgresql://test_{self.identifier}:synthetic-only@127.0.0.1:15432/test_rezayi_{self.identifier}", self.identifier
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
            for field, value in (("HOST", "localhost"), ("PORT", 5432), ("NAME", "bazar_rezayi_db"),
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
            for row in ((name, role, None, role), (name, role, "ffffffffffffffff", role), ("bazar_rezayi_db", role, self.identifier, role),
                        (name, "existing_owner", self.identifier, role), (name, role, self.identifier, "unrelated_owner")):
                cursor.fetchone.return_value = row
                with self.subTest(marker=row[-1]), self.assertRaises(ImproperlyConfigured):
                    assert_owned_database(connection)
            cursor.fetchone.return_value = (name, role, self.identifier, role)
            assert_owned_database(connection)

    def test_missing_manifest_is_rejected(self):
        database = self.database()
        root = Path(os.environ["REZAYI_TEST_ROOT"])
        (root / "ownership.json").unlink()
        with self.assertRaises(ImproperlyConfigured):
            validate_target(database)


class PassengerStartupTests(SimpleTestCase):
    def test_inherited_development_settings_are_rejected(self):
        import os
        import subprocess
        import sys
        result = subprocess.run(
            [sys.executable, "-c", "import passenger_wsgi"],
            env={**os.environ, "DJANGO_SETTINGS_MODULE": "config.settings.development"},
            capture_output=True, text=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Passenger requires DJANGO_SETTINGS_MODULE=config.settings.production", result.stderr)

    def test_missing_production_secret_fails_without_reading_private_environment(self):
        import subprocess
        import sys
        script = (
            "from unittest.mock import patch\n"
            "import os;os.environ['DJANGO_SETTINGS_MODULE']='config.settings.production'\n"
            "import environ\nimport config.environment\n"
            "with patch.object(config.environment, 'load_environment', return_value=environ.Env()):\n"
            " import passenger_wsgi\n"
        )
        result = subprocess.run([sys.executable, "-c", script], env={}, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("DJANGO_SECRET_KEY", result.stderr)
