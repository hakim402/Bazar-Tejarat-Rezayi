from django.test.runner import DiscoverRunner
from django.db import connection
from config.testing import assert_owned_database, validate_target


class IdentityTestRunner(DiscoverRunner):
    validate_target = staticmethod(validate_target)

    def setup_databases(self, **kwargs):
        assert_owned_database(connection)
        if "aliases" in kwargs and not kwargs["aliases"]:
            return []
        return super().setup_databases(**kwargs)

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
        with patch.object(connection.introspection, "django_table_names", side_effect=fixture_tables):
            return super().run_suite(suite, **kwargs)
