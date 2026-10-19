"""Prepare only the disposable browser database, using a generated fixture password on stdin."""

import os
import django
from django.core.management import call_command
from django.db import connection

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.test")
django.setup()
from config.testing import assert_owned_database  # noqa: E402

assert_owned_database(connection)
call_command("migrate", interactive=False, verbosity=0)
call_command("seed_identity_examples", stdin=True, verbosity=0)
