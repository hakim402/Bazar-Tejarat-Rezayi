"""Fail-closed ownership checks for automatically provisioned native test runs."""

import json
import os
from pathlib import Path
import re

from django.core.exceptions import ImproperlyConfigured

from config.environment import database_config


def run_id():
    value = os.environ.get("REZAYI_TEST_RUN_ID", "")
    if not re.fullmatch(r"[0-9a-f]{16}", value):
        raise ImproperlyConfigured("Run tests through python3 backend/scripts/run_tests.py.")
    return value


def ownership_manifest():
    """An allocated endpoint alone is insufficient: require the run-owned directory."""
    try:
        root = Path(os.environ["REZAYI_TEST_ROOT"])
        marker = root / "ownership.json"
        values = json.loads(marker.read_text())
        if (
            not root.is_absolute() or root.is_symlink() or marker.is_symlink()
            or root.name != "rezayi-test-" + run_id()
            or root.stat().st_uid != os.getuid()
            or root.stat().st_mode & 0o077
            or values["run_id"] != run_id()
            or values["root"] != str(root.resolve())
            or values["database"] != "test_rezayi_" + run_id()
            or values["role"] != "test_" + run_id()
            or not 1024 < int(values["postgres_port"]) < 65536
        ):
            raise ValueError
        return values
    except (KeyError, ValueError, OSError, TypeError):
        raise ImproperlyConfigured("Native tests require a matching private run ownership manifest.") from None


def owned_database(url, identifier=None):
    identifier = identifier or run_id()
    if identifier != run_id():
        raise ImproperlyConfigured("Invalid disposable test ownership identifier.")
    database = database_config(url)
    database["TEST"] = {"NAME": f"test_rezayi_{identifier}_unit"}
    validate_target(database)
    return database


def validate_target(database):
    identifier = run_id()
    marker = ownership_manifest()
    name = f"test_rezayi_{identifier}"
    if (
        database.get("HOST") != "127.0.0.1"
        or str(database.get("PORT")) != str(marker["postgres_port"])
        or database.get("USER") != f"test_{identifier}"
        or database.get("NAME") not in {name, name + "_unit"}
        or database.get("TEST", {}).get("NAME") != name + "_unit"
    ):
        raise ImproperlyConfigured("Tests refuse a resolved target outside this native disposable run.")


def assert_owned_database(connection):
    validate_target(connection.settings_dict)
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT current_database(), current_user, current_setting('rezayi.test_run_id', true), "
            "pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database()"
        )
        name, role, marker, owner = cursor.fetchone()
    if (
        name != connection.settings_dict["NAME"] or role != f"test_{run_id()}"
        or marker != run_id() or owner != role
    ):
        raise ImproperlyConfigured("Database server marker/owner does not match this test run.")
