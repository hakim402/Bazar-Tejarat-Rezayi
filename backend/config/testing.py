"""Fail-closed ownership checks for automatically provisioned disposable test runs."""

import os
import re

from django.core.exceptions import ImproperlyConfigured

from config.environment import database_config


def run_id():
    value = os.environ.get("REZAYI_TEST_RUN_ID", "")
    if not re.fullmatch(r"[0-9a-f]{16}", value):
        raise ImproperlyConfigured("Run tests through python3 backend/scripts/run_tests.py.")
    return value


def owned_database(url, identifier=None):
    identifier = identifier or run_id()
    if not re.fullmatch(r"[0-9a-f]{16}", identifier):
        raise ImproperlyConfigured("Invalid disposable test ownership identifier.")
    database = database_config(url)
    name = f"test_rezayi_{identifier}"
    if database["HOST"] != "postgres" or database["USER"] != f"test_{identifier}" or database["NAME"] != name:
        raise ImproperlyConfigured("Tests refuse a database outside this disposable run.")
    database["TEST"] = {"NAME": name + "_unit"}
    return database


def validate_target(database):
    identifier = run_id()
    name = f"test_rezayi_{identifier}"
    if (
        database["HOST"] != "postgres"
        or database["USER"] != f"test_{identifier}"
        or database["NAME"] not in {name, name + "_unit"}
        or database.get("TEST", {}).get("NAME") != name + "_unit"
    ):
        raise ImproperlyConfigured("Tests refuse a resolved target outside this disposable run.")


def assert_owned_database(connection):
    validate_target(connection.settings_dict)
    with connection.cursor() as cursor:
        cursor.execute("SELECT current_database(), current_user, current_setting('rezayi.test_run_id', true)")
        name, role, marker = cursor.fetchone()
    if name != connection.settings_dict["NAME"] or role != f"test_{run_id()}" or marker != run_id():
        raise ImproperlyConfigured("Database server ownership marker does not match this test run.")
