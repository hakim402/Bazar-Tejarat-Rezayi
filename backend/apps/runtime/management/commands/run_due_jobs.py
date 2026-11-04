"""One bounded cron invocation. Subprocesses are children, never detached services."""
import os
import signal
import subprocess
import sys
import time
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from apps.runtime import jobs


class Command(BaseCommand):
    help = "Run bounded durable work; never register cron or contact a provider from web startup."

    def add_arguments(self, parser):
        parser.add_argument("--seconds", type=int, default=40)
        parser.add_argument("--limit", type=int, default=10)

    def handle(self, *args, **options):
        if settings.BACKGROUND_ENGINE != "database":
            raise CommandError("Database cron is disabled for the current dispatcher architecture.")
        if not 5 <= options["seconds"] <= 40 or not 1 <= options["limit"] <= 50:
            raise CommandError("Use a 5..40 second budget and a 1..50 job limit.")
        from apps.runtime.mariadb.schema import ready
        if not ready():
            raise CommandError("Target schema or transfer is not complete; no work started.")
        lease = jobs.acquire_scheduler()
        if lease is None:
            self.stdout.write("Another bounded runner owns the current lease; no work started.")
            return
        failed = False
        count = 0
        deadline = time.monotonic() + options["seconds"]
        try:
            from apps.runtime.mariadb.schema import verify
            verify()
            jobs.seed_sweeps()
            while count < options["limit"] and deadline - time.monotonic() >= 3:
                row = jobs.claim()
                if row is None:
                    break
                child = subprocess.Popen([sys.executable, "manage.py", "run_claimed_job", row.key, str(row.lease)],
                    cwd=settings.BASE_DIR, env={**os.environ, "REZAYI_JOB_SECONDS": str(min(25, max(1, deadline-time.monotonic()-2)))}, start_new_session=True,
                    stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                try:
                    child.wait(timeout=min(30, max(1, deadline - time.monotonic() - 1)))
                    ok = child.returncode == 0
                except BaseException as error:
                    # The process group belongs to this just-created child. Never
                    # signal an exited group or a persisted PID from another run.
                    if child.poll() is None:
                        os.killpg(child.pid, signal.SIGKILL)
                    child.wait()
                    jobs.finish(row.key, row.lease, failed=True)
                    if isinstance(error, subprocess.TimeoutExpired):
                        failed = True
                        count += 1
                        break
                    raise
                jobs.finish(row.key, row.lease, failed=not ok)
                failed = failed or not ok
                count += 1
        finally:
            jobs.release_scheduler(lease, failed=failed or sys.exc_info()[0] is not None)
        self.stdout.write(f"Completed {count} bounded jobs; failures={int(failed)}.")
        if failed:
            raise CommandError("A durable job failed; inspect sanitized database status privately.")
