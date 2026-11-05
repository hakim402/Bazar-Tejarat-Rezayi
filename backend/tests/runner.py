from django.test.runner import DiscoverRunner
from django.db import connection
from config.testing import assert_owned_database, validate_target


class IdentityTestRunner(DiscoverRunner):
    validate_target = staticmethod(validate_target)

    def setup_databases(self, **kwargs):
        assert_owned_database(connection)
        if "aliases" in kwargs and not kwargs["aliases"]:
            return []
        result = super().setup_databases(**kwargs)
        if connection.vendor == "mysql":
            from config.testing import ownership_manifest, run_id
            from pathlib import Path
            marker = ownership_manifest()
            with connection.cursor() as cursor:
                cursor.execute("SELECT DATABASE(),CURRENT_USER(),@@datadir")
                name, role, datadir = cursor.fetchone()
                if (name != marker["database"] + "_unit" or role.split("@")[0] != marker["role"]
                    or Path(datadir).resolve() != Path(marker["root"]) / "mariadb"):
                    raise RuntimeError("Refuse a unit database outside the owned cluster.")
                if "bazar_owned_run" in connection.introspection.table_names(cursor):
                    if not self.keepdb:
                        raise RuntimeError("An unexpected retained unit marker cannot be replaced.")
                    cursor.execute("SELECT run_id FROM bazar_owned_run")
                    if cursor.fetchall() != ((run_id(),),):
                        raise RuntimeError("A retained unit database belongs to another run.")
                else:
                    cursor.execute("CREATE TABLE bazar_owned_run (run_id CHAR(16) PRIMARY KEY) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin")
                    cursor.execute("INSERT INTO bazar_owned_run VALUES (%s)", [run_id()])
            assert_owned_database(connection)
        return result

    def teardown_databases(self, old_config, **kwargs):
        assert_owned_database(connection)
        return super().teardown_databases(old_config, **kwargs)

    def run_suite(self, suite, **kwargs):
        # Legacy tables exist only when explicitly constructed by owned predecessor tests.
        # Include them in disposable fixture teardown so retained foreign keys do not
        # prevent Django from clearing the run-owned unit database between tests.
        from unittest.mock import patch
        from tests.legacy_content import TABLES
        original = connection.introspection.django_table_names
        def fixture_tables(*args, **options):
            assert_owned_database(connection)
            names = original(*args, **options)
            existing = connection.introspection.table_names()
            return [*names, *[name for name in TABLES if name in existing and name not in names]]
        original_flush = connection.ops.sql_flush
        def owned_flush(style, tables, *, reset_sequences=False, allow_cascade=False):
            if connection.vendor == "mysql":
                assert_owned_database(connection)
                from config.testing import run_id
                if connection.settings_dict["NAME"] != "test_rezayi_" + run_id() + "_unit":
                    raise RuntimeError("Only this run's disposable unit database can be truncated.")
                # DELETE intentionally hits production history guards. TRUNCATE is
                # permitted only here, after endpoint/role/directory/marker proof.
                return original_flush(style, tables, reset_sequences=True, allow_cascade=allow_cascade)
            return original_flush(style, tables, reset_sequences=reset_sequences, allow_cascade=allow_cascade)
        with patch.object(connection.introspection, "django_table_names", side_effect=fixture_tables), \
             patch.object(connection.ops, "sql_flush", side_effect=owned_flush):
            return super().run_suite(suite, **kwargs)
