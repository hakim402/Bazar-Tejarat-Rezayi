"""Exercise the real native communication worker on owned synthetic capture data."""

import time
from datetime import timedelta
import django
from django.conf import settings
from django.db import connection
from django.utils import timezone
from config.testing import assert_owned_database


def main():
    django.setup()
    assert_owned_database(connection)
    from apps.notifications.models import Outbox, Attempt
    from apps.notifications.tasks import sweep_notifications
    from config.celery import app

    assert settings.ACCOUNT_EMAIL_TRANSPORT == "capture"
    registered = app.control.inspect(timeout=5).registered() or {}
    assert any("notifications.sweep" in tasks for tasks in registered.values())
    row = (
        Outbox.objects.filter(account__user__email="phase08-company@example.test", status="queued")
        .order_by("created_at")
        .first()
    )
    assert row is not None
    row.due_at = timezone.now() - timedelta(seconds=1)
    row.version += 1
    row.save()
    sweep_notifications.delay()
    sweep_notifications.delay()
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        row.refresh_from_db()
        if row.status == "captured":
            break
        time.sleep(0.2)
    assert row.status == "captured" and row.attempts == 1
    assert Attempt.objects.filter(outbox=row, status="captured").count() == 1
    print(
        "Native communication task registered; duplicate queued sweep produced one captured email attempt. No SMTP/inbox-delivery claim."
    )


if __name__ == "__main__":
    main()
