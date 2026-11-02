"""Database-backed work ownership. Domain outboxes remain the effect authority."""
import uuid
from datetime import timedelta
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from .models import Job, Scheduler

SWEEPS = {"account_sweep": 60, "notice_sweep": 60, "translation_sweep": 60, "guest_sweep": 3600}
KINDS = {*SWEEPS, "translation"}


def enqueue(kind, resource="", *, wake=True, period=0):
    if kind not in KINDS:
        raise ValueError("Unknown durable job kind.")
    expected_period = SWEEPS.get(kind, 0)
    if period not in (0, expected_period):
        raise ValueError("The job cadence is fixed by the supported dispatcher.")
    period = expected_period
    key = f"{kind}:{resource}"
    with transaction.atomic():
        row, created = Job.objects.get_or_create(key=key, defaults={"kind": kind, "resource": str(resource), "period": period})
        if not created:
            row = Job.objects.select_for_update().get(pk=key)
            if row.period != period:
                row.period = period
                row.save(update_fields=["period"])
            if (wake or period and row.state == "done") and (row.state == "done" or row.state == "queued" and row.failures == 0):
                # Wake normal scheduled recovery promptly, preserving failed-job
                # backoff and terminal failure visibility.
                row.available_at = timezone.now() if row.state == "done" else min(row.available_at, timezone.now())
                row.state = "queued"
                row.save(update_fields=["state", "available_at"])
        return row


def seed_sweeps():
    for kind, period in SWEEPS.items():
        enqueue(kind, wake=False, period=period)


@transaction.atomic
def claim():
    now = timezone.now()
    row = (Job.objects.select_for_update(skip_locked=True)
           .filter(Q(state="queued", available_at__lte=now) | Q(state="running", lease_until__lte=now))
           .order_by("available_at", "key").first())
    if row is None:
        return None
    row.state, row.lease, row.lease_until = "running", uuid.uuid4(), now + timedelta(seconds=90)
    row.attempts += 1
    row.updated_at = now
    row.save()
    return row


@transaction.atomic
def finish(key, lease, *, failed=False):
    now = timezone.now()
    row = Job.objects.select_for_update().filter(pk=key, state="running", lease=lease, lease_until__gt=now).first()
    if row is None:
        return False
    row.failures = row.failures + 1 if failed else 0
    row.error_code = "job_failed" if failed else ""
    row.state = "failed" if row.failures >= 5 else "queued" if failed or row.period else "done"
    row.available_at = now + timedelta(seconds=min(900, 30 * 2 ** min(row.failures, 5)) if failed else row.period)
    row.lease, row.lease_until, row.updated_at = None, None, now
    row.save()
    return True


def execute(row):
    if row.kind == "account_sweep":
        from apps.accounts.delivery import sweep_mail
        sweep_mail()
    elif row.kind == "notice_sweep":
        from apps.notifications.tasks import sweep_notifications
        sweep_notifications()
    elif row.kind == "translation_sweep":
        from apps.catalogue.translations import dispatch
        dispatch()
    elif row.kind == "translation":
        from apps.catalogue.translations import generate
        generate(row.resource)
    elif row.kind == "guest_sweep":
        from apps.cart.services import expire_guests
        expire_guests()
    else:
        raise ValueError("Unknown durable job kind.")


@transaction.atomic
def acquire_scheduler():
    now = timezone.now()
    Scheduler.objects.get_or_create(name="cron")
    row = Scheduler.objects.select_for_update().get(pk="cron")
    if row.lease_until and row.lease_until > now:
        return None
    row.lease, row.lease_until, row.started_at = uuid.uuid4(), now + timedelta(seconds=90), now
    row.save()
    return row.lease


@transaction.atomic
def release_scheduler(lease, *, failed=False):
    now = timezone.now()
    row = Scheduler.objects.select_for_update().filter(pk="cron", lease=lease, lease_until__gt=now).first()
    if row is None:
        return False
    if failed:
        row.failed_at, row.error_code = now, "runner_failed"
    else:
        row.completed_at, row.error_code = now, ""
    row.lease, row.lease_until = None, None
    row.save()
    return True


def scheduler_ready():
    now = timezone.now()
    row = Scheduler.objects.filter(pk="cron").first()
    from .mariadb.schema import ready
    return bool(ready() and row and row.completed_at and row.completed_at >= now - timedelta(seconds=180)
                and (not row.failed_at or row.failed_at < row.completed_at)
                and not Job.objects.filter(state="failed").exists()
                and not Job.objects.filter(Q(state="queued", available_at__lt=now - timedelta(minutes=5))
                    | Q(state="running", lease_until__lt=now - timedelta(minutes=5))).exists())
