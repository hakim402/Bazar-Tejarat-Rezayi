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
