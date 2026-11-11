"""Native run-owned MariaDB provisioning; no real endpoint or shared service fallback."""
import json
import os
from pathlib import Path
import shutil
import secrets
import tempfile
import time


def native_base():
    configured = os.environ.get("REZAYI_MARIADB_BASE")
    candidates = [Path(configured)] if configured else [Path("/private/tmp/bazar-mariadb-11.4"), Path("/usr/local/opt/mariadb@11.4"), Path("/opt/homebrew/opt/mariadb@11.4")]
    executable = shutil.which("mariadbd")
    if executable and not configured:
        candidates.append(Path(executable).resolve().parent.parent)
    for base in candidates:
        server = next((p for p in (base / "bin/mariadbd", base / "sbin/mariadbd") if p.is_file()), None)
        initializer = next((p for p in (base / "bin/mariadb-install-db", base / "scripts/mariadb-install-db") if p.is_file()), None)
        if server and initializer:
            return base, server, initializer
    raise RuntimeError("Native MariaDB11.4 binaries are missing; see the local target verification prerequisite.")


class MariaDBInfrastructure:
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.base, self.server, self.initializer = native_base()
        self.generated["REZAYI_TEST_APP_DB_PASSWORD"] = secrets.token_hex(32)
        self.env["REZAYI_TEST_APP_DB_PASSWORD"] = self.generated["REZAYI_TEST_APP_DB_PASSWORD"]
        # Keep the UNIX socket under the kernel pathname limit on macOS.
        temporary = Path("/private/tmp") if Path("/private/tmp").is_dir() else Path(tempfile.gettempdir()).resolve()
        self.runtime = temporary / self.project
        self.env.update(REZAYI_TEST_ROOT=str(self.runtime), REZAYI_TEST_DATABASE_ENGINE="mariadb",
            REZAYI_TEST_DATABASE_URL=f"mariadb://test_{self.identifier}:{self.generated['REZAYI_TEST_DB_PASSWORD']}@localhost/test_rezayi_{self.identifier}?unix_socket={self.runtime}/db.sock")

    def prepare(self):
        import MySQLdb
        self.command([str(self.server), "--no-defaults", "--version"], "mariadb-binary-version")
        self.runtime.mkdir(mode=0o700)
        self.acquired = True
        self.marker = {"run_id": self.identifier, "root": str(self.runtime), "engine": "mariadb",
                       "socket": str(self.runtime / "db.sock"), "datadir": str(self.runtime / "mariadb"),
                       "database": "test_rezayi_" + self.identifier, "role": "test_" + self.identifier,
                       "auxiliary_databases": ["test_rezayi_" + self.identifier + suffix for suffix in ("_transfer", "_restore", "_legacy")]}
        if any(character.isspace() for character in str(self.base)):
            # MariaDB's installer shell script splits a spaced --basedir even
            # when subprocess passes one argument. Keep the real tools intact;
            # this alias lives inside the ownership-verified disposable root.
            original = self.base
            alias = self.runtime / "native-prefix"
            alias.symlink_to(original.resolve(strict=True), target_is_directory=True)
            self.base = alias
            self.server = alias / self.server.relative_to(original)
            self.initializer = alias / self.initializer.relative_to(original)
            self.marker["native_prefix"] = str(alias)
            self.marker["native_prefix_target"] = str(original.resolve(strict=True))
        (self.runtime / "ownership.json").write_text(json.dumps(self.marker))
        # Bootstrap and server temporary tables must stay in this run's owned
        # tree rather than the shared macOS temporary directory.
        temporary_tables = self.runtime / "temporary-tables"
        temporary_tables.mkdir(mode=0o700)
        self.command([str(self.initializer), "--no-defaults", "--basedir=" + str(self.base),
                      "--datadir=" + self.marker["datadir"], "--tmpdir=" + str(temporary_tables),
                      "--auth-root-authentication-method=normal", "--skip-test-db"],
                     "mariadb-initialize")
        self.database_process = self.start([str(self.server), "--no-defaults", "--basedir=" + str(self.base),
            "--datadir=" + self.marker["datadir"], "--socket=" + self.marker["socket"],
            "--tmpdir=" + str(temporary_tables),
            "--skip-networking", "--skip-log-bin", "--pid-file=" + str(self.runtime / "mariadb.pid"),
            "--log-error=" + str(self.evidence / "mariadb-error.log"), "--character-set-server=utf8mb4",
            "--collation-server=utf8mb4_nopad_bin", "--default-storage-engine=InnoDB",
            "--innodb-buffer-pool-size=128M", "--max-connections=40", "--performance-schema=OFF"], "mariadb-server")
        deadline = time.monotonic() + 40
        while True:
            try:
                conn = MySQLdb.connect(unix_socket=self.marker["socket"], user="root", connect_timeout=1)
                break
            except MySQLdb.OperationalError:
                if self.database_process.poll() is not None or time.monotonic() >= deadline:
                    raise RuntimeError("Run-owned MariaDB did not start; see retained sanitized logs.") from None
                time.sleep(.1)
        try:
            with conn.cursor() as cursor:
                cursor.execute("SELECT @@datadir,@@socket,@@version")
                datadir, socket_path, version = cursor.fetchone()
                if (Path(datadir).resolve() != Path(self.marker["datadir"]).resolve()
                    or socket_path != self.marker["socket"] or not version.startswith("11.4.")):
                    raise RuntimeError("Native database ownership/version mismatch.")
                if int((self.runtime / "mariadb.pid").read_text()) != self.database_process.pid:
                    raise RuntimeError("Native database PID differs from the owned process.")
                for name in (self.marker["database"], self.marker["database"] + "_unit", *self.marker["auxiliary_databases"]):
                    # Names are internally generated from a strict hexadecimal run ID.
                    cursor.execute(f"CREATE DATABASE `{name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin")
                cursor.execute("CREATE USER %s@'localhost' IDENTIFIED BY %s", [self.marker["role"], self.generated["REZAYI_TEST_DB_PASSWORD"]])
                for name in (self.marker["database"], self.marker["database"] + "_unit", *self.marker["auxiliary_databases"]):
                    cursor.execute(f"GRANT ALL PRIVILEGES ON `{name}`.* TO %s@'localhost'", [self.marker["role"]])
                cursor.execute("CREATE USER %s@'localhost' IDENTIFIED BY %s", ["app_" + self.identifier, self.generated["REZAYI_TEST_APP_DB_PASSWORD"]])
                for name in (self.marker["database"], self.marker["database"] + "_unit", *self.marker["auxiliary_databases"]):
                    cursor.execute(f"GRANT SELECT,INSERT,UPDATE,DELETE ON `{name}`.* TO %s@'localhost'", ["app_" + self.identifier])
                # TCP is disabled and the socket's enclosing directory is0700.
                # Root has no access to real data; this entire cluster is disposable.
                conn.commit()
        finally:
            conn.close()
        for owned_name in (self.marker["database"], *self.marker["auxiliary_databases"]):
            self.mark_database(owned_name)
        (self.evidence / "infrastructure.json").write_text(json.dumps({**self.marker, "version": version,
            "pid_verified": True, "tcp_disabled": True}, indent=2) + "\n")
        print(f"Provisioned native MariaDB {version} run {self.identifier}; temporary credentials withheld.", flush=True)

    def mark_database(self, owned_name):
        import MySQLdb
        if owned_name not in {self.marker["database"], *self.marker.get("auxiliary_databases", [])}:
            raise RuntimeError("Refuse an unallocated test database marker.")
        test = MySQLdb.connect(unix_socket=self.marker["socket"], user=self.marker["role"],
            passwd=self.generated["REZAYI_TEST_DB_PASSWORD"], db=owned_name, charset="utf8mb4")
        try:
            with test.cursor() as c:
                c.execute("CREATE TABLE bazar_owned_run (run_id CHAR(16) PRIMARY KEY) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin")
                c.execute("INSERT INTO bazar_owned_run VALUES (%s)", [self.identifier])
            test.commit()
        finally:
            test.close()
