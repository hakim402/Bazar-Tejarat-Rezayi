"""Independent connection claims and fencing on owned native resources."""
import django
from django.db import connection
from config.testing import assert_owned_database


def main():
    django.setup()
    assert_owned_database(connection)
    from apps.runtime.jobs import acquire_scheduler, release_scheduler, scheduler_ready, SWEEPS
    from apps.runtime.models import Job
    from uuid import uuid4
    # Retry briefly only for the separate owned test clock's current bounded run.
    import time
    deadline = time.monotonic() + 20
    lease = None
    while lease is None and time.monotonic() < deadline:
        lease = acquire_scheduler()
        if lease is None:
            time.sleep(.1)
    assert lease is not None
    assert acquire_scheduler() is None
    assert release_scheduler(uuid4()) is False
    assert release_scheduler(lease)
    assert not release_scheduler(lease)
    assert scheduler_ready()
    assert set(SWEEPS).issubset(set(Job.objects.values_list("kind", flat=True)))
    print("Durable singleton overlap exclusion, stale fencing and required schedules passed.")


if __name__ == "__main__":
    main()
