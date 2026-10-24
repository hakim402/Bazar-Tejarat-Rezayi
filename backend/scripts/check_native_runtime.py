"""Exercise a separate native Beat process and Redis on guarded disposable infrastructure."""

import os
from pathlib import Path
import subprocess
import sys
from uuid import uuid4

import django
from celery.beat import PersistentScheduler
from django.db import connection
import redis

from config.testing import assert_owned_database, ownership_manifest


class SmokeScheduler(PersistentScheduler):
    """Test-only schedule; production entries remain registered and independently dispatched."""

    def setup_schedule(self):
        django.setup()
        assert_owned_database(connection)
        for entry in self.app.conf.beat_schedule.values():
            entry["schedule"] = 1.0
        self.app.conf.beat_schedule["native-diagnostic"] = {
            "task": "foundation.diagnostic", "schedule": 1.0,
            "args": [os.environ["REZAYI_TEST_BEAT_NONCE"]],
            "options": {"task_id": os.environ["REZAYI_TEST_BEAT_TASK_ID"], "expires": 15},
        }
        super().setup_schedule()


def main():
    django.setup()
    assert_owned_database(connection)
    marker = ownership_manifest()
    from config.celery import app
    broker = redis.Redis.from_url(os.environ["REZAYI_TEST_BROKER_URL"])
    assert broker.get("rezayi:test-run-id").decode() == marker["run_id"]
    try:
        redis.Redis(host="127.0.0.1", port=marker["redis_port"], password="incorrect-synthetic").ping()
    except redis.AuthenticationError:
        pass
    else:
        raise AssertionError("Disposable Redis must reject unauthenticated access.")
    expected = {"accounts.dispatch_mail", "catalogue.dispatch_translations"}
    assert expected.issubset({value["task"] for value in app.conf.beat_schedule.values()})
    nonce, task_id = str(uuid4()), str(uuid4())
    root = Path(marker["root"])
    with (root / "beat.log").open("w") as log:
        process = subprocess.Popen([
            sys.executable, "-m", "celery", "-A", "config", "beat",
            "--scheduler=scripts.check_native_runtime:SmokeScheduler", "--loglevel=WARNING",
            "--schedule=" + str(root / "beat-schedule"), "--pidfile=" + str(root / "beat.pid"),
        ], env={**os.environ, "REZAYI_TEST_BEAT_NONCE": nonce, "REZAYI_TEST_BEAT_TASK_ID": task_id},
            stdout=log, stderr=subprocess.STDOUT)
        try:
            result = app.AsyncResult(task_id)
            assert result.get(timeout=20) == {"ok": True, "nonce": nonce}
            result.forget()
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
    print("Redis ownership/authentication passed; separate Beat dispatched a periodic task to the native worker.")
    print("Mail and catalogue recovery schedules retained; synthetic/capture providers only.")


if __name__ == "__main__":
    main()
