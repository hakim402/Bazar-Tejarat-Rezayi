"""Regenerate the maintained backend/schema.json artifact from the current API.

Mirrors scripts.check_schema exactly (same settings, validation and fail-on-warn)
but writes the generated OpenAPI document instead of comparing it. Run only inside
the disposable owned runner context after an authorized backend API change.
"""

import io
import os
from pathlib import Path

import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.test")
django.setup()

from django.core.management import call_command  # noqa: E402

output = io.StringIO()
call_command("spectacular", format="openapi-json", validate=True, fail_on_warn=True, stdout=output)
target = Path(__file__).resolve().parents[1] / "schema.json"
target.write_text(output.getvalue())
print("Regenerated backend/schema.json from the current API graph.")
