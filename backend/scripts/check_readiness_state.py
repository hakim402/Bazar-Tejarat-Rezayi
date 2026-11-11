"""Bounded private-data-free diagnostics for an owned test API readiness failure."""

import json
from datetime import timedelta

import django
from django.db import connection
from django.db.models import Count, Max, Min, Q
from django.utils import timezone

from config.testing import assert_owned_database


def main():
    django.setup()
    assert_owned_database(connection)
    from apps.runtime.jobs import scheduler_ready
    from apps.runtime.mariadb.schema import ready
    from apps.runtime.models import Job, Scheduler

    now = timezone.now()
    scheduler = Scheduler.objects.filter(pk="cron").values(
        "started_at", "completed_at", "failed_at", "lease_until", "error_code",
    ).first()
    groups = list(Job.objects.values("kind", "state").annotate(
        count=Count("key"), max_failures=Max("failures"), oldest_available=Min("available_at"),
    ).order_by("kind", "state")[:30])
    stale = Job.objects.filter(
        Q(state="queued", available_at__lt=now - timedelta(minutes=5))
        | Q(state="running", lease_until__lt=now - timedelta(minutes=5)),
    ).values("kind", "state").annotate(count=Count("key"))
    # No job keys/resources/payloads, lease tokens, identities, contacts or errors.
    print(json.dumps({
        "native_ready": ready(), "scheduler_ready": scheduler_ready(),
        "scheduler": scheduler, "jobs": groups, "stale_jobs": list(stale[:30]),
    }, default=str))


if __name__ == "__main__":
    main()
