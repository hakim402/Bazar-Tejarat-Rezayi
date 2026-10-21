"""Prepare only the disposable browser database, using a generated fixture password on stdin."""

import os
import io
import json
import sys
import django
from django.core.management import call_command
from django.db import connection

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.test")
django.setup()
from config.testing import assert_owned_database  # noqa: E402

assert_owned_database(connection)
call_command("migrate", interactive=False, verbosity=0)
values = json.load(sys.stdin)
for command in ("seed_identity_examples", "seed_organization_examples", "seed_content_examples"):
    sys.stdin = io.StringIO(json.dumps(values))
    call_command(command, stdin=True, verbosity=0)
