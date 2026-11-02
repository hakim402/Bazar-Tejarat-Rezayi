"""Exercise the real native communication worker on owned synthetic capture data."""

import time
from datetime import timedelta
import django
from django.conf import settings
from django.core.management import call_command
from django.db import connection
from django.utils import timezone
from config.testing import assert_owned_database


def main():
    django.setup()
    assert_owned_database(connection)
    from apps.notifications.models import Outbox, Attempt
    from apps.runtime.jobs import enqueue
    from apps.runtime.models import Job

    assert settings.ACCOUNT_EMAIL_TRANSPORT == "capture"
    row = (
        Outbox.objects.filter(account__user__email="phase08-company@example.test", status="queued")
        .order_by("created_at")
        .first()
    )
    assert row is not None
    row.due_at = timezone.now() - timedelta(seconds=1)
    row.version += 1
    row.save()
    enqueue("notice_sweep")
    enqueue("notice_sweep")
    # Use actual bounded invocations; waiting for the retired parallel worker's
    # 30-second timing would not exercise this cron architecture truthfully.
    # The complete synthetic catalogue has a finite translation backlog. Size
    # this test's waiting window from that backlog, without shortening a real
    # invocation near the deadline or changing due dates, throttle or claims.
    backlog = Job.objects.filter(state="queued").count()
    budget = max(180, min(900, backlog * 5 + 120))
    print({"owned_initial_job_backlog": backlog, "verification_budget_seconds": budget}, flush=True)
    deadline = time.monotonic() + budget
    while deadline - time.monotonic() >= 40:
        call_command("run_due_jobs", seconds=40, limit=10, verbosity=0)
        row.refresh_from_db()
        if row.status in {"captured", "cancelled", "exhausted", "delivery_unknown"}:
            break
        time.sleep(0.2)
    if row.status != "captured" or row.attempts != 1:
        from apps.messaging.models import ReadState
        state = ReadState.objects.get(account=row.account_id, conversation=row.conversation_id)
        print({"state": row.status, "attempts": row.attempts,
               "due_in_seconds": (row.due_at - timezone.now()).total_seconds(),
               "has_last_emailed": bool(state.last_emailed_at),
               "unread": state.latest_incoming > state.last_read,
               "jobs": list(Job.objects.filter(kind='notice_sweep').values('period','state','attempts','failures')),
               "codes": list(Attempt.objects.filter(outbox=row).values_list("code", flat=True))})
    assert row.status == "captured" and row.attempts == 1
    assert Attempt.objects.filter(outbox=row, status="captured").count() == 1
    print(
        "Native durable communication job; duplicate queued sweep produced one captured email attempt. No SMTP/inbox-delivery claim."
    )


if __name__ == "__main__":
    main()
