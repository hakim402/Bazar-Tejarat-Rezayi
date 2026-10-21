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
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
LABEL = "dev.rezayi.test-run"


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
        self.compose = ["docker", "compose", "--env-file", os.devnull, "--project-name", self.project,
                        "-f", str(BACKEND / "compose.identity-test.yaml")]
        self.evidence = ROOT / "doc/progress" / phase / "test-tooling" / self.identifier
        self.evidence.mkdir(parents=True)
        self.frontend = None
        self.dist_owned = False
        self.frontend_log = None
        self.dist = ".next-test-" + self.identifier
        self.tsconfig = None
        self.next_env = None
        self.acquired = False
        self.initial = {}

    def redact(self, value):
        for private in (self.password, *self.generated.values()):
            if len(private) >= 24:
                value = value.replace(private, "[temporary credential redacted]")
        return value

    def command(self, args, name, *, cwd=BACKEND, data=None, env=None, check=True):
        """Never echo command arguments, child error payloads or temporary credentials."""
        process = subprocess.Popen(args, cwd=cwd, env=env or self.env, stdin=subprocess.PIPE,
                                   stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)
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
        except BaseException:
            self.stop_process(process)
            raise
        output = "".join(chunks)
        print(f"{name}: {'passed' if process.returncode == 0 else 'failed'}", flush=True)
        if check and process.returncode:
            raise TestFailure(f"{name} failed; see its redacted evidence log.")
        return process.returncode, output

    def dc(self, *args, name, data=None, check=True):
        return self.command([*self.compose, *args], name, data=data, check=check)

    @staticmethod
    def docker_ids(kind):
        args = {"containers": ["ps", "-aq"], "networks": ["network", "ls", "-q"],
                "volumes": ["volume", "ls", "-q"]}[kind]
        return set(subprocess.check_output(["docker", *args], text=True).split())

    def prepare(self):
        self.initial = {kind: self.docker_ids(kind) for kind in ("containers", "networks", "volumes")}
        existing = subprocess.check_output(["docker", "ps", "-aq", "--filter",
                                           "label=com.docker.compose.project=" + self.project], text=True).strip()
        networks = subprocess.check_output(["docker", "network", "ls", "-q", "--filter",
                                           "label=com.docker.compose.project=" + self.project], text=True).strip()
        image_exists = subprocess.run(["docker", "image", "inspect", "rezayi-test:" + self.identifier],
                                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
        if existing or networks or image_exists:
            raise TestFailure("Disposable project collision; no existing resources were changed.")
        self.acquired = True
        print(f"Provisioning disposable run {self.identifier} (temporary credentials withheld).", flush=True)
        self.dc("build", "test", name="backend-build")
        self.dc("up", "-d", "--wait", "--wait-timeout", "120", "postgres", "redis", name="infrastructure")
        # The role marker propagates to every connection/database in this fresh, owned server.
        sql = f'ALTER ROLE "test_{self.identifier}" SET rezayi.test_run_id = \'{self.identifier}\';\n'
        self.dc("exec", "-T", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-U", "test_" + self.identifier,
                "-d", "test_rezayi_" + self.identifier, name="ownership-marker", data=sql)

    def backend_checks(self):
        self.dc("run", "--rm", "--no-deps", "test", "ruff", "check", "--no-cache", ".", name="backend-lint")
        self.dc("run", "--rm", "--no-deps", "test", "python", "manage.py", "test", *self.labels,
                "--settings=config.settings.test", "--noinput", name="backend-tests")
        self.dc("run", "--rm", "--no-deps", "test", "python", "manage.py", "check", name="backend-check")
        self.dc("run", "--rm", "--no-deps", "test", "python", "manage.py", "makemigrations", "--check", "--dry-run",
                name="migration-consistency")
        self.dc("run", "--rm", "--no-deps", "test", "python", "-m", "pip", "check", name="backend-dependencies")

        self.dc("run", "--rm", "--no-deps", "-v", str(BACKEND / "schema.json") + ":/app/schema.json:ro", "test", "python", "-m", "scripts.check_schema", name="schema-consistency")

    def browser_environment(self):
        api = f"http://127.0.0.1:{self.api_port}"
        return {**self.env, "API_INTERNAL_URL": api, "NEXT_PUBLIC_API_URL": api, "NEXT_DIST_DIR": self.dist,
                "PLAYWRIGHT_BASE_URL": f"http://127.0.0.1:{self.frontend_port}", "PLAYWRIGHT_API_ORIGIN": api,
                "PLAYWRIGHT_EVIDENCE_DIR": str(self.evidence / "screenshots"),
                "PLAYWRIGHT_EMAIL_PREVIEWS_DIR": str(self.evidence / "email-previews"),
                "PLAYWRIGHT_BROWSER_CHANNEL": "chromium", "IDENTITY_BROWSER_TESTS": "1",
                "ORGANIZATIONS_BROWSER_TESTS": "1" if self.phase in {"phase-04-organizations", "phase-05-content"} else "0",
                "CONTENT_BROWSER_TESTS": "1" if self.phase == "phase-05-content" else "0",
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
        self.dc("up", "-d", "web", name="browser-api")
        self.dc("exec", "-T", "web", "python", "-m", "scripts.prepare_browser_tests", name="browser-fixtures",
                data=json.dumps({"password": self.password, "phase": self.phase}))
        self.wait_ready(f"http://127.0.0.1:{self.api_port}/api/v1/health/ready/")
        env = self.browser_environment()
        (self.evidence / "email-previews").mkdir()
        self.dc("exec", "-T", "web", "python", "manage.py", "account_mail_previews", "--output", "/app/data/previews",
                name="email-previews")
        _, previews = self.dc("exec", "-T", "web", "python", "-c",
            "import json; from pathlib import Path; print(json.dumps({p.name:p.read_text() for p in Path('/app/data/previews').iterdir() if p.is_file()}))",
            name="copy-previews")
        rendered = json.loads(previews)
        for name, contents in rendered.items():
            if Path(name).name != name or Path(name).suffix not in {".html", ".txt"}:
                raise TestFailure("Unexpected inert preview filename.")
            (self.evidence / "email-previews" / name).write_text(contents)
        (self.evidence / "copy-previews.log").write_text(f"Copied {len(rendered)} inert preview files.\n")
        rc, _ = self.command(["npm", "ls", "--depth=0"], "frontend-installed-dependencies", cwd=FRONTEND, check=False)
        if rc:
            self.command(["npm", "ci", "--no-audit", "--no-fund"], "frontend-install", cwd=FRONTEND)
        generated_types = self.evidence / "schema.d.ts"
        self.command(["npx", "openapi-typescript", "../backend/schema.json", "-o", str(generated_types)], "frontend-schema", cwd=FRONTEND, env=env)
        if generated_types.read_bytes() != (FRONTEND / "lib/api/schema.d.ts").read_bytes():
            raise TestFailure("Generated TypeScript API schema is stale.")
        for script in ("lint", "typecheck", "test"):
            self.command(["npm", "run", script], "frontend-" + script, cwd=FRONTEND, env=env)
        self.command(["npm", "run", "build"], "frontend-build", cwd=FRONTEND, env=env)
        self.command(["npx", "playwright", "install", "chromium"], "browser-install", cwd=FRONTEND, env=env)
        self.frontend_log = (self.evidence / "frontend-server.log").open("w")
        self.frontend = subprocess.Popen(["node", "node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1",
                                          "--port", str(self.frontend_port)], cwd=FRONTEND, env=env,
                                         stdout=self.frontend_log, stderr=subprocess.STDOUT, start_new_session=True)
        self.wait_ready(env["PLAYWRIGHT_BASE_URL"] + "/en/auth/buyer-sign-in", self.frontend)
        self.command(["npx", "playwright", "test", *(["tests/" + self.browser_spec] if self.browser_spec else []), "--output", str(self.evidence / "browser-results"),
                      "--global-timeout=1200000"], "browser-tests", cwd=FRONTEND, env=env)
        self.dc("logs", "--no-color", "web", name="browser-main-api-diagnostics", check=False)
        self.dc("stop", "web", name="outage-stop")
        self.command(["npx", "playwright", "test", "tests/foundation.browser.ts", "--grep", "actual API outage",
                      "--output", str(self.evidence / "outage-results"), "--global-timeout=60000"],
                     "browser-outage", cwd=FRONTEND, env={**env, "API_EXPECT_OFFLINE": "1"})
        # Reconfigure only this disposable API; keep production/default-MFA tests above intact.
        self.env["REZAYI_TEST_OWNER_MFA_REQUIRED"] = "false"
        self.dc("up", "-d", "--no-deps", "--force-recreate", "web", name="development-owner-api")
        self.wait_ready(f"http://127.0.0.1:{self.api_port}/api/v1/health/ready/")
        self.command(["npx", "playwright", "test", "tests/owner-development.browser.ts",
                      "--output", str(self.evidence / "development-owner-results"), "--global-timeout=120000"],
                     "browser-development-owner", cwd=FRONTEND,
                     env={**self.browser_environment(), "OWNER_DEVELOPMENT_BROWSER_TESTS": "1"})

    @staticmethod
    def stop_process(process):
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=5)

    def sanitize_browser_diagnostics(self):
        # Failed browser snapshots can include synthetic MFA input. Keep diagnostics without it.
        for path in self.evidence.rglob('error-context.md'):
            value = self.redact(path.read_text())
            value = re.sub(r'(?im)(textbox[^\n]*(?:password|code|رمز|کد|کوډ|پټنوم|كلمة)[^\n]*:)\s*[^\n]+', r'\1 [private input redacted]', value)
            path.write_text(value)
            path.chmod(0o600)

    def cleanup(self):
        self.sanitize_browser_diagnostics()
        if self.frontend:
            self.stop_process(self.frontend)
        if self.frontend_log:
            self.frontend_log.close()
        # This output directory is unique to this run; preserve every pre-existing build.
        dist = FRONTEND / self.dist
        if self.dist_owned and dist.is_dir():
            shutil.rmtree(dist)
        if self.dist_owned and self.tsconfig:
            path = FRONTEND / "tsconfig.json"
            current = json.loads(path.read_text())
            original = json.loads(self.tsconfig)
            current["include"] = [s for s in current["include"] if not s.startswith(self.dist + "/")]
            path.write_text(self.tsconfig if current == original else json.dumps(current, indent=2) + "\n")
        if self.dist_owned and self.next_env is not None:
            path = FRONTEND / "next-env.d.ts"
            if self.dist in path.read_text():
                path.write_bytes(self.next_env)
        if not self.acquired:
            return
        self.dc("logs", "--no-color", "web", name="browser-api-diagnostics", check=False)
        # Before teardown, verify every project container/network belongs to this run.
        for kind, args, inspect in (("containers", ["ps", "-aq"], ["inspect"]),
                                    ("networks", ["network", "ls", "-q"], ["network", "inspect"])):
            ids = subprocess.check_output(["docker", *args, "--filter",
                                           "label=com.docker.compose.project=" + self.project], text=True).split()
            for resource in ids:
                item = json.loads(subprocess.check_output(["docker", *inspect, resource], text=True))[0]
                labels = item.get("Labels") or item.get("Config", {}).get("Labels", {})
                if resource in self.initial[kind] or labels.get(LABEL) != self.identifier:
                    raise TestFailure("Teardown refused a resource without matching run ownership.")
        self.dc("down", "--volumes", name="cleanup")
        tag = "rezayi-test:" + self.identifier
        image = subprocess.run(["docker", "image", "inspect", tag], text=True, capture_output=True)
        if image.returncode == 0 and json.loads(image.stdout)[0]["Config"]["Labels"].get(LABEL) == self.identifier:
            self.command(["docker", "image", "rm", tag], "cleanup-image")
        for kind in self.initial:
            if not self.initial[kind].issubset(self.docker_ids(kind)):
                raise TestFailure("A pre-existing Docker resource is missing after this run.")
        remaining = subprocess.check_output(["docker", "ps", "-aq", "--filter", f"label={LABEL}={self.identifier}"], text=True)
        if remaining.strip():
            raise TestFailure("Disposable containers remain after teardown.")
        (self.evidence / "cleanup.json").write_text(json.dumps({"owned_resources_removed": True,
            "preexisting_resources_preserved": True, "private_env_files_unchanged": True}, indent=2) + "\n")
        print("Disposable resources removed; pre-existing resources preserved.", flush=True)

    def execute(self):
        private = {folder: hashlib.sha256((ROOT / folder / ".env").read_bytes()).hexdigest()
                   for folder in ("backend", "frontend") if (ROOT / folder / ".env").exists()}
        self.tsconfig = (FRONTEND / "tsconfig.json").read_text() if not self.backend_only else None
        next_env = FRONTEND / "next-env.d.ts"
        if not self.backend_only and next_env.exists():
            self.next_env = next_env.read_bytes()
        status = "failed"
        try:
            self.prepare()
            self.backend_checks()
            if not self.backend_only:
                self.frontend_checks()
            status = "passed"
        finally:
            try:
                self.cleanup()
                for folder, expected in private.items():
                    if hashlib.sha256((ROOT / folder / ".env").read_bytes()).hexdigest() != expected:
                        raise TestFailure("A private environment changed during verification.")
            except BaseException:
                status = "cleanup_failed"
                raise
            finally:
                (self.evidence / "result.json").write_text(json.dumps({"run_id": self.identifier, "status": status,
                    "backend_only": self.backend_only, "phase": self.phase, "browser_spec": self.browser_spec, "evidence": str(self.evidence.relative_to(ROOT))}, indent=2) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--phase", choices=["phase-03-identity", "phase-04-organizations", "phase-05-content"], default="phase-03-identity")
    parser.add_argument("--browser-spec", choices=["content-review-fixes.browser.ts", "identity.browser.ts", "organizations.browser.ts", "content.browser.ts", "foundation.browser.ts", "active-api.browser.ts"], help="Optional focused browser workflow check; default runs every browser spec")
    parser.add_argument("--backend-only", action="store_true")
    parser.add_argument("--test-label", action="append", default=[])
    args = parser.parse_args()
    if args.test_label and not args.backend_only:
        parser.error("--test-label requires --backend-only")
    for executable in ("docker",) if args.backend_only else ("docker", "node", "npm", "npx"):
        if not shutil.which(executable):
            parser.error(f"Required local executable is unavailable: {executable}")
    run = TestRun(args.backend_only, args.test_label, args.phase, args.browser_spec)
    def interrupted(signum, frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, interrupted)
    try:
        run.execute()
    except (TestFailure, OSError, subprocess.SubprocessError, KeyboardInterrupt) as exc:
        print(f"{type(exc).__name__}: {str(exc) if isinstance(exc, TestFailure) else 'operation stopped; details withheld'}. "
              f"Evidence: {run.evidence.relative_to(ROOT)}", file=sys.stderr)
        return 1
    print(f"All requested checks passed. Evidence: {run.evidence.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
