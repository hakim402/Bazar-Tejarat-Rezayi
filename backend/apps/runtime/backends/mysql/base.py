"""MariaDB with PostgreSQL-compatible unsigned UUID ordering."""
from django.db.backends.mysql.base import DatabaseWrapper as NativeWrapper
from django.db.backends.mysql.features import DatabaseFeatures as NativeFeatures


class DatabaseFeatures(NativeFeatures):
    # Fixed lowercase hex sorts exactly like PostgreSQL UUID bytes for every
    # version. Native MariaDB UUID storage reorders older UUID versions.
    has_native_uuid_field = False


class DatabaseWrapper(NativeWrapper):
    features_class = DatabaseFeatures
