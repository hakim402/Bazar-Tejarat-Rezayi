"""Wait for owned seeded translations under the normal bounded test clock."""

import time

import django
from django.db import connection

from config.testing import assert_owned_database


def main():
    django.setup()
    assert_owned_database(connection)
    from apps.runtime.jobs import scheduler_ready
    from apps.runtime.models import Job

    # Fixture generation may enqueue 150+ synthetic translations. Short browser
    # subsets must not race their drain or weaken the real five-minute guard.
    deadline = time.monotonic() + 900
    next_report = 0
    while time.monotonic() < deadline:
        assert not Job.objects.filter(state="failed").exists(), "Owned fixture work failed."
        pending = Job.objects.filter(kind="translation").exclude(state="done").count()
        if pending == 0 and scheduler_ready():
            print("Owned seeded translations drained; normal scheduler readiness passed.", flush=True)
            return
        if time.monotonic() >= next_report:
            print(f"Owned seeded translations remaining: {pending}.", flush=True)
            next_report = time.monotonic() + 30
        time.sleep(1)
    raise RuntimeError("Owned fixture backlog did not drain within 15 minutes.")


if __name__ == "__main__":
    main()
