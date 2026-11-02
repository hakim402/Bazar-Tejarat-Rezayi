"""Exercise the actual bounded command on owned synthetic resources."""
import django
from django.core.management import call_command
from django.db import connection
from config.testing import assert_owned_database


def main():
    django.setup()
    assert_owned_database(connection)
    from apps.runtime.jobs import seed_sweeps, scheduler_ready
    seed_sweeps()
    call_command("run_due_jobs", seconds=10, limit=10)
    assert scheduler_ready()
    print("Bounded database worker and required scheduler heartbeat passed; no real provider call.")


if __name__ == "__main__":
    main()
