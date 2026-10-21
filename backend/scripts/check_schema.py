"""Validate the API schema and its maintained generated artifact without touching runtime data."""

import io
import json
import os
from pathlib import Path
import django
from django.core.management import call_command

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.test")
django.setup()
output = io.StringIO()
call_command("spectacular", format="openapi-json", validate=True, fail_on_warn=True, stdout=output)
if json.loads(output.getvalue()) != json.loads(Path("/app/schema.json").read_text()):
    raise SystemExit("API schema is stale; regenerate the maintained artifact.")
print("API schema validated and matches the maintained artifact.")
