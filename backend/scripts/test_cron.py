"""Run-owned accelerated clock for browser verification, never a hosting daemon."""
import os
import time
import django
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import connection
from config.testing import assert_owned_database


def main():
    django.setup()
    assert_owned_database(connection)
    if os.environ.get("BROWSER_TEST_RUNTIME") != "true":
        raise RuntimeError("This clock requires an owned browser test run.")
    while True:
        try:
            # Keep the production work budget; accelerate only the tick interval.
            call_command("run_due_jobs", seconds=40, limit=50, verbosity=0)
        except CommandError:
            print("Owned cron invocation failed; a later tick retains normal backoff.", flush=True)
        # This is test acceleration only. Production remains one-minute cron.
        time.sleep(1)


if __name__ == "__main__":
    main()
