#!/usr/bin/env python3
"""One-command disposable backend/frontend verification; no private configuration reads."""

import argparse
import base64
import hashlib
import json
import os
import re
from pathlib import Path
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import time
import tempfile
import urllib.request

try:
    from scripts.processes import OwnedProcess, stop_process
except ModuleNotFoundError:  # Direct invocation from the project root.
    from processes import OwnedProcess, stop_process

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
PYTHON = BACKEND / ".venv/bin/python"


class TestFailure(Exception):
    pass


def available_port():
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


class TestRun:
    def __init__(self, backend_only=False, labels=(), phase="phase-03-identity", browser_spec=None):
        self.identifier = secrets.token_hex(8)
        self.project = "rezayi-test-" + self.identifier
        self.browser_spec = browser_spec
        self.phase = phase
        self.backend_only = backend_only
        self.labels = labels
        self.warnings = []
        self.api_port, self.frontend_port = available_port(), available_port()
        while self.frontend_port == self.api_port:
            self.frontend_port = available_port()
        self.password = "Synthetic-" + secrets.token_urlsafe(24) + "-7!"
        self.generated = {
            "REZAYI_TEST_RUN_ID": self.identifier,
            "REZAYI_TEST_DB_PASSWORD": secrets.token_hex(32),
            "REZAYI_TEST_REDIS_PASSWORD": secrets.token_hex(32),
            "REZAYI_TEST_SIGNING_KEY": secrets.token_urlsafe(64),
            "REZAYI_TEST_ENCRYPTION_KEY": base64.urlsafe_b64encode(secrets.token_bytes(32)).decode(),
            "REZAYI_TEST_API_PORT": str(self.api_port),
            "REZAYI_TEST_FRONTEND_PORT": str(self.frontend_port),
        }
        self.env = {**os.environ, **self.generated}
        if phase == "phase-06-catalogue":
            self.env["REZAYI_TEST_TRANSLATION_ADAPTER"] = "deterministic"
        self.evidence = ROOT / "doc/progress/native-python-migration/evidence/runs" / self.identifier
        self.evidence.mkdir(parents=True)
        self.frontend = None
        self.dist_owned = False
        self.frontend_log = None
        self.dist = ".next-test-" + self.identifier
        self.tsconfig = None
        self.next_env = None
        self.acquired = False
        self.processes = []
        self.logs = []
        self.web = None
        self.runtime = Path(tempfile.gettempdir()).resolve() / self.project
        self.postgres_port, self.redis_port = available_port(), available_port()
        while len({self.postgres_port, self.redis_port, self.api_port, self.frontend_port}) != 4:
            self.postgres_port, self.redis_port = available_port(), available_port()
        self.env.update(
            DJANGO_SETTINGS_MODULE="config.settings.test", BROWSER_TEST_RUNTIME="false",
            REZAYI_TEST_ROOT=str(self.runtime), REZAYI_TEST_PYTHON=str(PYTHON),
            REZAYI_TEST_FRONTEND_ORIGIN=f"http://127.0.0.1:{self.frontend_port}",
            REZAYI_TEST_DATABASE_URL=f"postgresql://test_{self.identifier}:{self.generated['REZAYI_TEST_DB_PASSWORD']}@127.0.0.1:{self.postgres_port}/test_rezayi_{self.identifier}",
            REZAYI_TEST_BROKER_URL=f"redis://:{self.generated['REZAYI_TEST_REDIS_PASSWORD']}@127.0.0.1:{self.redis_port}/0",
            DJANGO_SECRET_KEY=self.generated["REZAYI_TEST_SIGNING_KEY"],
            MFA_ENCRYPTION_KEY=self.generated["REZAYI_TEST_ENCRYPTION_KEY"],
            GUNICORN_BIND=f"127.0.0.1:{self.api_port}", PYTHONDONTWRITEBYTECODE="1",
            PYTHONUNBUFFERED="1", PIP_DISABLE_PIP_VERSION_CHECK="1",
        )

    def redact(self, value):
        for private in (self.password, *self.generated.values()):
            if len(private) >= 24:
                value = value.replace(private, "[temporary credential redacted]")
        return value

    def command(self, args, name, *, cwd=BACKEND, data=None, env=None, check=True):
        """Never echo command arguments, child error payloads or temporary credentials."""
        process = OwnedProcess(args, cwd=cwd, env=env or self.env, stdin=subprocess.PIPE,
                               stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        self.processes.append(process)
        chunks = []
        try:
            if data is not None:
                process.stdin.write(data.encode())
            process.stdin.close()
            with (self.evidence / (name + ".log")).open("w") as log:
                for line in process.stdout:
                    redacted = self.redact(line.decode(errors="replace"))
                    chunks.append(redacted)
                    log.write(redacted)
                    log.flush()
            process.wait()
        finally:
            self.stop_process(process)
        output = "".join(chunks)
        print(f"{name}: {'passed' if process.returncode == 0 else 'failed'}", flush=True)
        if check and process.returncode:
            raise TestFailure(f"{name} failed; see its redacted evidence log.")
        return process.returncode, output

    def python(self, *args, name, data=None, check=True, env=None):
        return self.command([str(PYTHON), *args], name, data=data, check=check, env=env)

    def start(self, args, name, *, env=None, data=None):
        log = (self.evidence / (name + ".log")).open("w")
        self.logs.append(log)
        process = OwnedProcess(args, cwd=BACKEND, env=env or self.env, stdin=subprocess.PIPE,
                               stdout=log, stderr=subprocess.STDOUT)
        self.processes.append(process)
        if data is not None:
            process.stdin.write(data.encode())
        process.stdin.close()
        return process

    def prepare(self):
        import psycopg
        from psycopg import sql
        self.command([str(PYTHON), "-m", "pip", "install", "--require-hashes", "-r", "requirements-dev.lock"],
                     "locked-native-dependencies")
        # mkdir is atomic and never reuses a previous run's data directory.
        self.runtime.mkdir(mode=0o700)
        self.acquired = True
        self.marker = {"run_id": self.identifier, "root": str(self.runtime), "postgres_port": self.postgres_port,
                       "redis_port": self.redis_port, "database": "test_rezayi_" + self.identifier,
                       "role": "test_" + self.identifier}
        (self.runtime / "ownership.json").write_text(json.dumps(self.marker))
        print(f"Provisioning native disposable run {self.identifier} (temporary credentials withheld).", flush=True)
        self.command(["initdb", "-D", str(self.runtime / "postgres"), "-U", "bootstrap_" + self.identifier,
                      "--auth-local=trust", "--auth-host=scram-sha-256", "--pwfile=/dev/stdin", "--encoding=UTF8",
                      "--no-locale"], "postgres-initialize", data=self.generated["REZAYI_TEST_DB_PASSWORD"] + "\n")
        postgres = self.start(["postgres", "-D", str(self.runtime / "postgres"), "-h", "127.0.0.1", "-p",
                              str(self.postgres_port), "-k", "", "-c", "fsync=off"], "postgres-server")
        deadline = time.monotonic() + 30
        while True:
            try:
                conn = psycopg.connect(host="127.0.0.1", port=self.postgres_port, dbname="postgres",
                    user="bootstrap_" + self.identifier, password=self.generated["REZAYI_TEST_DB_PASSWORD"],
                    connect_timeout=1, autocommit=True)
                break
            except psycopg.OperationalError:
                if postgres.poll() is not None or time.monotonic() > deadline:
                    raise TestFailure("Run-owned PostgreSQL did not start.") from None
                time.sleep(0.1)
        with conn:
            # Verify this is exactly the child cluster, before creating any role/database.
            with conn.cursor() as cursor:
                cursor.execute("SHOW data_directory")
                if Path(cursor.fetchone()[0]).resolve() != self.runtime / "postgres":
                    raise TestFailure("PostgreSQL cluster ownership mismatch.")
                role = sql.Identifier(self.marker["role"])
                cursor.execute(sql.SQL("CREATE ROLE {} LOGIN CREATEDB PASSWORD {}").format(
                    role, sql.Literal(self.generated["REZAYI_TEST_DB_PASSWORD"])))
                cursor.execute(sql.SQL("ALTER ROLE {} SET rezayi.test_run_id = {}").format(
                    role, sql.Literal(self.identifier)))
                cursor.execute(sql.SQL("CREATE DATABASE {} OWNER {}").format(sql.Identifier(self.marker["database"]), role))
        self.redis = self.start(["redis-server", "-"], "redis-server", data=(
            f"bind 127.0.0.1\nport {self.redis_port}\nsave \"\"\nappendonly no\n"
            f"dir {self.runtime}\nrequirepass {self.generated['REZAYI_TEST_REDIS_PASSWORD']}\n"))
        import redis
        broker = redis.Redis.from_url(self.env["REZAYI_TEST_BROKER_URL"])
        deadline = time.monotonic() + 10
        while True:
            try:
                broker.ping()
                if (broker.info("server")["process_id"] != self.redis.pid
                    or Path(broker.config_get("dir")["dir"]).resolve() != self.runtime):
                    raise TestFailure("Redis process/directory ownership mismatch.")
                broker.set("rezayi:test-run-id", self.identifier)
                break
            except redis.ConnectionError:
                if self.redis.poll() is not None or time.monotonic() > deadline:
                    raise TestFailure("Run-owned Redis did not start.") from None
                time.sleep(0.1)
        (self.evidence / "infrastructure.json").write_text(json.dumps(self.marker, indent=2) + "\n")

    def backend_checks(self):
        self.python("-m", "ruff", "check", "--no-cache", ".", name="backend-lint")
        self.python("manage.py", "test", *self.labels, "--settings=config.settings.test", "--noinput", name="backend-tests")
        self.python("manage.py", "check", name="backend-check")
        self.python("manage.py", "makemigrations", "--check", "--dry-run", name="migration-consistency")
        self.python("-m", "pip", "check", name="backend-dependencies")
        self.python("-m", "scripts.check_schema", name="schema-consistency")
        # Replay all migrations on the separately owned browser database even in backend-only mode.
        self.python("manage.py", "migrate", "--noinput", name="fresh-migration-replay")
        self.python("-c", "import django;django.setup();from django.apps import apps;from django.db import connection;from apps.site.models import SiteSettings;assert not apps.is_installed('apps.content');assert not any(t.startswith('content_') for t in connection.introspection.table_names());assert SiteSettings.objects.get(pk=1).default_locale == 'fa-AF';print('Fresh active graph has site defaults and no legacy CMS tables.')", name="site-fresh-graph")
        self.command(["node", "backend/scripts/build_admin_styles.mjs", "--check"], "admin-styles", cwd=ROOT)
        self.python("manage.py", "collectstatic", "--noinput", name="static-collection")
        self.env["BROWSER_TEST_RUNTIME"] = "true"
        self.worker = self.start([str(PYTHON), "-m", "celery", "-A", "config", "worker", "--pool=solo",
                                  "--concurrency=1", "--loglevel=WARNING"], "native-worker")
        self.python("-m", "scripts.check_worker", name="native-worker-execution")
        self.python("-m", "scripts.check_native_runtime", name="native-scheduler-and-redis")
        self.python("-m", "scripts.check_native_deployment", "--development", name="native-development-wsgi")
        self.python("-m", "scripts.check_native_deployment", name="synthetic-production-wsgi")
        self.env["BROWSER_TEST_RUNTIME"] = "false"

    def start_web(self):
        if self.web:
            self.stop_process(self.web)
        self.env["BROWSER_TEST_RUNTIME"] = "true"
        self.web = self.start([str(PYTHON), "-m", "gunicorn", "--config", "gunicorn.conf.py",
                               "config.wsgi:application"], "native-api-" + str(len(self.processes)))
        self.wait_ready(f"http://127.0.0.1:{self.api_port}/api/v1/health/ready/", self.web)

    def browser_environment(self):
        api = f"http://127.0.0.1:{self.api_port}"
        return {**self.env, "API_INTERNAL_URL": api, "NEXT_PUBLIC_API_URL": api, "NEXT_DIST_DIR": self.dist,
                "PLAYWRIGHT_BASE_URL": f"http://127.0.0.1:{self.frontend_port}", "PLAYWRIGHT_API_ORIGIN": api,
                "PLAYWRIGHT_EVIDENCE_DIR": str(self.evidence / "screenshots"),
                "PLAYWRIGHT_EMAIL_PREVIEWS_DIR": str(self.evidence / "email-previews"),
                "PLAYWRIGHT_BROWSER_CHANNEL": "chromium", "IDENTITY_BROWSER_TESTS": "1",
                "ORGANIZATIONS_BROWSER_TESTS": "1" if self.phase in {"phase-04-organizations", "phase-06-catalogue"} else "0",
                "SITE_BROWSER_TESTS": "1", "ADMIN_DASHBOARD_BROWSER_TESTS": "1",
                "CATALOGUE_BROWSER_TESTS": "1" if self.phase == "phase-06-catalogue" else "0",
                "REZAYI_TEST_PROJECT": self.project, "REZAYI_TEST_FIXTURE_PASSWORD": self.password}

    @staticmethod
    def wait_ready(url, process=None):
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            if process is not None and process.poll() is not None:
                raise TestFailure("Disposable frontend stopped before readiness.")
            try:
                with urllib.request.urlopen(url, timeout=2) as response:
                    if response.status == 200:
                        return
            except (OSError, ValueError):
                pass
            time.sleep(0.25)
        raise TestFailure("Disposable service did not become ready within 60 seconds.")

    def frontend_checks(self):
        # Atomic creation proves this build directory belongs to us; never reuse an existing one.
        (FRONTEND / self.dist).mkdir()
        self.dist_owned = True
        self.env["BROWSER_TEST_RUNTIME"] = "true"
        self.python("-m", "scripts.prepare_browser_tests", name="browser-fixtures",
                    data=json.dumps({"password": self.password, "phase": self.phase}))
        self.start_web()
        env = self.browser_environment()
        previews = self.evidence / "email-previews"
        previews.mkdir()
        self.python("manage.py", "account_mail_previews", "--output", str(previews), name="email-previews")
        rc, _ = self.command(["npm", "ls", "--depth=0"], "frontend-installed-dependencies", cwd=FRONTEND, check=False)
        if rc:
            self.command(["npm", "ci", "--no-audit", "--no-fund"], "frontend-install", cwd=FRONTEND)
        generated_types = self.evidence / "schema.d.ts"
        self.command(["npx", "openapi-typescript", "../backend/schema.json", "-o", str(generated_types)], "frontend-schema", cwd=FRONTEND, env=env)
        if generated_types.read_bytes() != (FRONTEND / "lib/api/schema.d.ts").read_bytes():
            raise TestFailure("Generated TypeScript API schema is stale.")
        for script in ("lint", "typecheck", "test"):
            self.command(["npm", "run", script], "frontend-" + script, cwd=FRONTEND, env=env)
        build = ["npm", "run", "build", "--", "--webpack"]
        code, output = self.command(build, "frontend-build-initial", cwd=FRONTEND, env=env, check=False)
        if code:
            if "SecurityFatalError" not in output or "Retry the same command to continue" not in output:
                raise TestFailure("Frontend build failed; see frontend-build-initial.log.")
            # Next's own bounded acknowledgement receipt allows exactly this retry.
            # Keep the security diagnostic visible; this is NOT a patched dependency
            # or security acceptance, and never changes the lockfile or policy.
            self.warnings.append("Installed Next.js reports a security advisory; dependency upgrade remains required.")
            (self.evidence / "dependency-security.json").write_text(json.dumps({"patched": False, "warning": self.warnings[-1], "first_build_log": "frontend-build-initial.log", "retry": "same command, same owned build directory"}, indent=2) + "\n")
            print(self.warnings[-1], flush=True)
            self.command(build, "frontend-build", cwd=FRONTEND, env=env)

        self.command(["npx", "playwright", "install", "chromium"], "browser-install", cwd=FRONTEND, env=env)
        self.frontend_log = (self.evidence / "frontend-server.log").open("w")
        self.frontend = OwnedProcess(["node", "node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1",
                                          "--port", str(self.frontend_port)], cwd=FRONTEND, env=env,
                                         stdout=self.frontend_log, stderr=subprocess.STDOUT)
        self.processes.append(self.frontend)
        self.wait_ready(env["PLAYWRIGHT_BASE_URL"] + "/en/auth/buyer-sign-in", self.frontend)
        self.command(["npx", "playwright", "test", *(["tests/" + self.browser_spec] if self.browser_spec else []), "--output", str(self.evidence / "browser-results"),
                      "--global-timeout=1200000"], "browser-tests", cwd=FRONTEND, env=env)
        if self.phase == "phase-06-catalogue":
            self.python("-c", "import django;django.setup();import json;from config.celery import app;from apps.catalogue.models import TranslationJob;registered=app.control.inspect(timeout=5).registered() or {};expected={'catalogue.generate_translation','catalogue.dispatch_translations'};assert any(expected.issubset(set(tasks)) for tasks in registered.values());print(json.dumps({'registered':sorted(expected),'completed_jobs':TranslationJob.objects.filter(status='completed').count()}))", name="catalogue-worker-result")
        if self.phase == "phase-06-catalogue":
            self.env["REZAYI_TEST_TRANSLATION_ADAPTER"] = "disabled"
            self.start_web()
            self.wait_ready(f"http://127.0.0.1:{self.api_port}/api/v1/health/ready/")
            self.command(["npx", "playwright", "test", "tests/catalogue-disabled.browser.ts", "--output", str(self.evidence / "disabled-provider-results"), "--global-timeout=90000"], "browser-catalogue-disabled", cwd=FRONTEND, env={**env,"CATALOGUE_DISABLED_BROWSER_TESTS":"1"})
        self.stop_process(self.web)
        self.command(["npx", "playwright", "test", "tests/foundation.browser.ts", "--grep", "actual API outage",
                      "--output", str(self.evidence / "outage-results"), "--global-timeout=60000"],
                     "browser-outage", cwd=FRONTEND, env={**env, "API_EXPECT_OFFLINE": "1"})
        # Reconfigure only this disposable API; keep production/default-MFA tests above intact.
        self.env["REZAYI_TEST_OWNER_MFA_REQUIRED"] = "false"
        self.start_web()
        self.wait_ready(f"http://127.0.0.1:{self.api_port}/api/v1/health/ready/")
        self.command(["npx", "playwright", "test", "tests/owner-development.browser.ts",
                      "--output", str(self.evidence / "development-owner-results"), "--global-timeout=120000"],
                     "browser-development-owner", cwd=FRONTEND,
                     env={**self.browser_environment(), "OWNER_DEVELOPMENT_BROWSER_TESTS": "1"})

    stop_process = staticmethod(stop_process)

    def sanitize_browser_diagnostics(self):
        # Failed browser snapshots can include synthetic MFA input. Keep diagnostics without it.
        for path in self.evidence.rglob('error-context.md'):
            value = self.redact(path.read_text())
            value = re.sub(r'(?im)(textbox[^\n]*(?:password|code|رمز|کد|کوډ|پټنوم|كلمة)[^\n]*:)\s*[^\n]+', r'\1 [private input redacted]', value)
            path.write_text(value)
            path.chmod(0o600)

    def cleanup(self):
        errors = []

        def attempt(name, operation):
            try:
                operation()
            except BaseException as exc:
                # Do not leak arbitrary filesystem/child error text or temporary secrets.
                errors.append({"step": name, "error": type(exc).__name__})

        # Stop all run-owned groups before touching files; one failure must not skip others.
        processes = list(self.processes)
        if self.frontend and self.frontend not in processes:
            processes.append(self.frontend)
        for index, process in enumerate(reversed(processes)):
            attempt(f"process-{index}", lambda process=process: self.stop_process(process))

        def confirm_stopped():
            if not all(isinstance(p, OwnedProcess) and p.stopped for p in processes):
                raise TestFailure("Some owned process groups could not be confirmed stopped.")

        attempt("confirm-process-groups", confirm_stopped)
        stopped = all(isinstance(p, OwnedProcess) and p.stopped for p in processes)
        for index, log in enumerate([*self.logs, *([self.frontend_log] if self.frontend_log else [])]):
            attempt(f"close-log-{index}", log.close)
        attempt("sanitize-browser-diagnostics", self.sanitize_browser_diagnostics)
        if stopped:
            attempt("remove-build-output", self.remove_build_output)
            attempt("restore-typescript-config", self.restore_typescript_config)
            attempt("restore-next-env", self.restore_next_env)
            attempt("remove-runtime", self.remove_runtime)
        for path in self.evidence.glob("*.log"):
            attempt("redact-log", lambda path=path: path.write_text(self.redact(path.read_text(errors="replace"))))
        (self.evidence / "cleanup.json").write_text(json.dumps({
            "owned_processes_exited": stopped,
            "owned_process_groups_exited": stopped,
            "owned_directory_removed": not self.runtime.exists(),
            "errors": errors,
        }, indent=2) + "\n")
        if errors:
            raise TestFailure("Native cleanup encountered errors; see cleanup.json (details withheld).")
        print("Native disposable resources removed; pre-existing services untouched.", flush=True)

    def remove_build_output(self):
        dist = FRONTEND / self.dist
        if self.dist_owned and dist.is_dir():
            shutil.rmtree(dist)

    def restore_typescript_config(self):
        if self.dist_owned and self.tsconfig:
            path = FRONTEND / "tsconfig.json"
            current = json.loads(path.read_text())
            original = json.loads(self.tsconfig)
            current["include"] = [s for s in current["include"] if not s.startswith(self.dist + "/")]
            path.write_text(self.tsconfig if current == original else json.dumps(current, indent=2) + "\n")

    def restore_next_env(self):
        if self.dist_owned and self.next_env is not None:
            path = FRONTEND / "next-env.d.ts"
            if self.dist in path.read_text():
                path.write_bytes(self.next_env)

    def remove_runtime(self):
        if self.acquired:
            if (self.runtime.is_symlink() or
                json.loads((self.runtime / "ownership.json").read_text()) != self.marker):
                raise TestFailure("Teardown refused a directory without matching run ownership.")
            shutil.rmtree(self.runtime)

    def source_manifest(self):
        paths = subprocess.check_output(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], cwd=ROOT).decode().strip("\0").split("\0")
        return {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() if (ROOT / name).is_file() else None
                for name in sorted(paths)}

    def execute(self):
        private = {folder: hashlib.sha256((ROOT / folder / ".env").read_bytes()).hexdigest()
                   for folder in ("backend", "frontend") if (ROOT / folder / ".env").exists()}
        self.tsconfig = (FRONTEND / "tsconfig.json").read_text() if not self.backend_only else None
        next_env = FRONTEND / "next-env.d.ts"
        if not self.backend_only and next_env.exists():
            self.next_env = next_env.read_bytes()
        source = self.source_manifest()
        (self.evidence / "source-manifest.json").write_text(json.dumps(source, indent=2) + "\n")
        status = "failed"
        try:
            self.prepare()
            if getattr(self, "cleanup_probe", None):
                if self.cleanup_probe == "interrupt":
                    signal.raise_signal(signal.SIGTERM)
                raise TestFailure("Intentional cleanup probe.")
            self.backend_checks()
            if not self.backend_only:
                self.frontend_checks()
            status = "passed"
        finally:
            try:
                self.cleanup()
                if self.source_manifest() != source:
                    raise TestFailure("Application source changed during verification; rerun the final source.")
                for folder, expected in private.items():
                    if hashlib.sha256((ROOT / folder / ".env").read_bytes()).hexdigest() != expected:
                        raise TestFailure("A private environment changed during verification.")
                cleanup_path = self.evidence / "cleanup.json"
                cleanup_path.write_text(json.dumps({**json.loads(cleanup_path.read_text()),
                    "private_env_files_unchanged": True, "application_source_unchanged_during_run": True}, indent=2) + "\n")
            except BaseException:
                status = "cleanup_failed"
                raise
            finally:
                (self.evidence / "result.json").write_text(json.dumps({"run_id": self.identifier, "status": status,
                    "warnings": getattr(self, "warnings", []), "backend_only": self.backend_only, "phase": self.phase, "browser_spec": self.browser_spec, "evidence": str(self.evidence.relative_to(ROOT))}, indent=2) + "\n")


def main():
    if Path(sys.executable).absolute() != PYTHON.absolute():
        if not PYTHON.exists():
            raise SystemExit("Install native dependencies into backend/.venv; see doc/hosting/Native_Python_cPanel_Deployment.md.")
        os.execv(str(PYTHON), [str(PYTHON), __file__, *sys.argv[1:]])
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--phase", choices=["phase-03-identity", "phase-04-organizations", "phase-06-catalogue"], default="phase-03-identity")
    parser.add_argument("--browser-spec", choices=["site.browser.ts", "admin-dashboard.browser.ts", "approved-design.browser.ts", "catalogue-review.browser.ts", "catalogue.browser.ts", "identity.browser.ts", "organizations.browser.ts", "foundation.browser.ts", "active-api.browser.ts"], help="Optional focused browser workflow check; default runs every browser spec")
    parser.add_argument("--backend-only", action="store_true")
    parser.add_argument("--test-label", action="append", default=[])
    parser.add_argument("--cleanup-probe", choices=["failure", "interrupt"], help="Provision then fail/interrupt to verify teardown")
    args = parser.parse_args()
    if args.test_label and not args.backend_only:
        parser.error("--test-label requires --backend-only")
    for executable in ("initdb", "postgres", "redis-server", *(() if args.backend_only else ("node", "npm", "npx", "ffmpeg", "ffprobe"))):
        if not shutil.which(executable):
            parser.error(f"Required local executable is unavailable: {executable}")
    run = TestRun(args.backend_only, args.test_label, args.phase, args.browser_spec)
    run.cleanup_probe = args.cleanup_probe
    def interrupted(signum, frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    try:
        run.execute()
    except (Exception, KeyboardInterrupt) as exc:
        print(f"{type(exc).__name__}: {str(exc) if isinstance(exc, TestFailure) else 'operation stopped; details withheld'}. "
              f"Evidence: {run.evidence.relative_to(ROOT)}", file=sys.stderr)
        return 1
    print(f"All requested checks passed. Evidence: {run.evidence.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
