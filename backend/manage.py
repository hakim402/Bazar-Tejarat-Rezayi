#!/usr/bin/env python
import os
import sys


def main():
    if any(command in sys.argv for command in ("createsuperuser", "flush", "loaddata")):
        raise SystemExit(
            "Destructive/default credential setup is disabled. Use reviewed migrations and interactive bootstrap_owner."
        )
    if (
        "test" in sys.argv
        and os.environ.get("DJANGO_SETTINGS_MODULE") != "config.settings.test"
        and "--settings=config.settings.test" not in sys.argv
    ):
        raise SystemExit("Use python3 backend/scripts/run_tests.py for automatically isolated tests.")
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.development")
    from django.core.management import execute_from_command_line

    execute_from_command_line(sys.argv)


if __name__ == "__main__":
    main()
