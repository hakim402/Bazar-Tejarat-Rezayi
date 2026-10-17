#!/usr/bin/env python
import os
import sys


def main():
    if any(command in sys.argv for command in ("migrate", "makemigrations", "createsuperuser", "flush", "loaddata")):
        raise SystemExit("Database mutations are disabled in Phase 02; identity review is required first.")
    if (
        "test" in sys.argv
        and os.environ.get("DJANGO_SETTINGS_MODULE") != "config.settings.test"
        and "--settings=config.settings.test" not in sys.argv
    ):
        raise SystemExit("Tests require config.settings.test and an isolated TEST_DATABASE_URL.")
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.development")
    from django.core.management import execute_from_command_line

    execute_from_command_line(sys.argv)


if __name__ == "__main__":
    main()
