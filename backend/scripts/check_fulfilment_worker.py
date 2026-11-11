"""Explicit actual production-budget probe; original 10-second probe is unchanged."""

import django
from django.db import connection
from django.core.management import call_command
from config.testing import assert_owned_database


def main():
    django.setup()
    assert_owned_database(connection)
    from apps.runtime.jobs import seed_sweeps, scheduler_ready, SWEEPS
    from apps.runtime.models import Job

    seed_sweeps()
    try:
        call_command("run_due_jobs", seconds=40, limit=10)
    finally:
        rows = list(Job.objects.filter(kind__in=SWEEPS))
        # Keep bounded status diagnostics even if the command raises. Never
        # include job payloads, exception text or private resource identifiers.
        print(
            "Required sweep results:",
            [(row.kind, row.attempts, row.failures, row.state, row.lease is None, row.lease_until is None) for row in rows],
        )
    assert {row.kind for row in rows} == set(SWEEPS)
    assert all(
        row.attempts >= 1
        and row.failures == 0
        and row.state == "queued"
        and row.lease is None
        and row.lease_until is None
        for row in rows
    )
    assert scheduler_ready()
    print(
        "Actual 40-second/10-job scope: all required sweeps executed, leases released and readiness passed. Original 10-second probe is separate."
    )


if __name__ == "__main__":
    main()
