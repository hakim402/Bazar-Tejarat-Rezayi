import json
import os

import django
from django.conf import settings
from django.db import connection

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.development")
django.setup()

try:
    connection.ensure_connection()
    with connection.cursor() as cursor:
        cursor.execute("BEGIN READ ONLY")
        cursor.execute("SELECT current_database(), current_setting('server_version')")
        name, version = cursor.fetchone()
        cursor.execute(
            "SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema') ORDER BY 1,2"
        )
        tables = cursor.fetchall()
        cursor.execute("ROLLBACK")
    print(
        json.dumps(
            {
                "engine": "PostgreSQL",
                "version": version,
                "configured_database_reached": name == settings.DATABASES["default"]["NAME"],
                "owner_database_reached": name == "bazar_rezayi_db",
                "table_count": len(tables),
                "auth_tables_exist": any(t.startswith("auth_") for _, t in tables),
                "migration_table_exists": any(t == "django_migrations" for _, t in tables),
            }
        )
    )
except Exception as exc:
    print(json.dumps({"database_verified": False, "failure_type": type(exc).__name__, "details": "withheld"}))
    raise SystemExit(1) from None
finally:
    connection.close()
