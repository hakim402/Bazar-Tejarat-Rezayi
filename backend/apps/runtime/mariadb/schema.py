"""An explicit target contract; never masquerades as applied PostgreSQL history."""

import hashlib
import json
from django.db import connection, transaction, DatabaseError
from django.utils import timezone


from functools import lru_cache
from pathlib import Path


@lru_cache(maxsize=5)
def reference(version=1):
    if version not in {1, 2, 3, 4, 5}:
        raise RuntimeError("Unsupported native contract version.")
    return json.loads(Path(__file__).with_name(f"contract_v{version}.json").read_text())


def statements():
    # Applied target history is immutable. A future change needs an additive
    # native migration/contract, not new behavior imported into this v1 graph.
    return reference()["ddl"]


def resumable_statement(statement):
    if statement.startswith("INSERT INTO orders_orderpolicy"):
        return statement.replace("INSERT INTO", "INSERT IGNORE INTO", 1)
    for operation in ("CREATE TRIGGER", "CREATE TABLE", "CREATE SEQUENCE"):
        if statement.startswith(operation):
            return statement.replace(operation, operation + " IF NOT EXISTS", 1)
    return (
        statement.replace("ADD COLUMN `", "ADD COLUMN IF NOT EXISTS `")
        .replace("ADD UNIQUE KEY `", "ADD UNIQUE KEY IF NOT EXISTS `")
        .replace("ADD CONSTRAINT `", "ADD CONSTRAINT IF NOT EXISTS `")
    )


def contract(version=1):
    ddl = statements() if version == 1 else reference(version)["ddl"]
    return hashlib.sha256(json.dumps({"probe_version": version, "ddl": ddl}, ensure_ascii=False).encode()).hexdigest()


def active_reference():
    return reference(5)


def guard_inventory(cursor):
    cursor.execute(
        "SELECT TRIGGER_NAME,ACTION_STATEMENT FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() ORDER BY TRIGGER_NAME"
    )
    return {name: hashlib.sha256(body.encode()).hexdigest() for name, body in cursor.fetchall()}


def install(apps, schema_editor):
    db = schema_editor.connection
    if db.vendor != "mysql" or not db.mysql_is_mariadb or db.mysql_version[:2] != (11, 4):
        raise RuntimeError("This target graph requires verified MariaDB 11.4.")
    Schema = apps.get_model("runtime", "Schema")
    installed = Schema.objects.using(db.alias).first()
    if installed:
        with db.cursor() as cursor:
            if (
                installed.contract != contract()
                or installed.guards != {"triggers": reference()["triggers"], "structure": reference()["structure"]}
                or guard_inventory(cursor) != reference()["triggers"]
                or structural_inventory(cursor) != reference()["structure"]
            ):
                raise RuntimeError("An existing native contract differs; no object was replaced.")
        return
    with db.cursor() as cursor:
        cursor.execute(
            "SELECT TABLE_NAME,ENGINE,TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE'"
        )
        if any(engine != "InnoDB" or collation != "utf8mb4_nopad_bin" for _, engine, collation in cursor.fetchall()):
            raise RuntimeError("Target tables must use InnoDB and utf8mb4_nopad_bin.")
        for statement in statements():
            cursor.execute(resumable_statement(statement))
        # Explicit import manifests retain source sequence gaps as well as rows.
        Transfer = apps.get_model("runtime", "Transfer")
        transfer = Transfer.objects.using(db.alias).filter(state="validated").first()
        next_number = int(transfer.manifest.get("invoice_next", 1)) if transfer else 1
        cursor.execute("SELECT number FROM orders_invoice WHERE number REGEXP '^BR-[0-9]+$'")
        next_number = max(next_number, max((int(row[0][3:]) + 1 for row in cursor.fetchall()), default=1))
        cursor.execute("ALTER SEQUENCE orders_invoice_number RESTART WITH %s", [next_number])
        guards = guard_inventory(cursor)
        guards.pop("runtime_guardprobe_insert_guard", None)
        expected = sum(s.startswith("CREATE TRIGGER") for s in statements())
        if len(guards) != expected:
            raise RuntimeError("Native guard inventory mismatch.")
        # Runtime gets DML only. A migration-owned trigger reads its own native
        # metadata with definer rights, without granting TRIGGER/DDL to the app.
        signature = hashlib.sha256(
            "|".join(f"{name}:{value}" for name, value in sorted(guards.items())).encode()
        ).hexdigest()
        from .ddl import trigger

        probe = f"""DECLARE actual_signature CHAR(64);
            SELECT SHA2(GROUP_CONCAT(CONCAT(TRIGGER_NAME,':',SHA2(ACTION_STATEMENT,256)) ORDER BY BINARY TRIGGER_NAME SEPARATOR '|'),256)
            INTO actual_signature FROM information_schema.TRIGGERS
            WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME<>'runtime_guardprobe_insert_guard';
            IF NOT (actual_signature <=> '{signature}') THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='bazar_guard_contract_changed';
            END IF;
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='bazar_guard_contract_ready';"""
        cursor.execute(resumable_statement(trigger("runtime_guardprobe", "INSERT", probe)))
        guards = {"triggers": guard_inventory(cursor), "structure": structural_inventory(cursor)}
        if guards != {"triggers": reference()["triggers"], "structure": reference()["structure"]}:
            raise RuntimeError("Native DDL differs from the isolated reviewed v1 reference; publication refused.")
        cursor.execute("SELECT `increment`,cache_size,cycle_option FROM orders_invoice_number")
        if cursor.fetchone() != (1, 0, 0):
            raise RuntimeError("Native invoice sequence properties differ.")
    Schema.objects.using(db.alias).create(pk=1, contract=contract(), guards=guards)


def ready():
    from apps.runtime.models import Schema, Transfer

    if connection.vendor != "mysql":
        return True
    from django.db.migrations.recorder import MigrationRecorder

    try:
        if not (
            MigrationRecorder(connection).migration_qs.filter(app="runtime", name="0011_disputes_v5").exists()
            and Schema.objects.filter(pk=1, contract=contract(5)).exists()
            and not Transfer.objects.exclude(state="complete").exists()
        ):
            return False
        # The marker alone cannot bless a partial DDL upgrade or missing guard.
        verify(record=False)
        return True
    except (DatabaseError, RuntimeError, OSError, ValueError):
        return False


def verify(*, record=True, version=5):
    from apps.runtime.models import Schema

    if connection.vendor != "mysql":
        return
    row = Schema.objects.get(pk=1)
    expected = reference(version)
    if row.contract != contract(version) or row.guards != {
        "triggers": expected["triggers"],
        "structure": expected["structure"],
    }:
        raise RuntimeError("Native target contract differs from reviewed source.")
    with connection.cursor() as cursor:
        if expected["structure"] != structural_inventory(cursor):
            raise RuntimeError("Native target constraints or storage differ from the installed contract.")
        cursor.execute(
            "SELECT @@session.check_constraint_checks,@@session.foreign_key_checks,@@session.transaction_isolation,@@session.unique_checks,@@session.sql_mode"
        )
        checks, fks, isolation, unique, modes = cursor.fetchone()
        if (
            checks != 1
            or fks != 1
            or unique != 1
            or isolation != "READ-COMMITTED"
            or not {"STRICT_TRANS_TABLES", "NO_ENGINE_SUBSTITUTION"}.issubset(set(modes.split(",")))
        ):
            raise RuntimeError("Required native integrity/isolation settings are not active.")
    import uuid

    try:
        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute("INSERT INTO runtime_guardprobe(nonce) VALUES (%s)", [uuid.uuid4().hex])
            raise RuntimeError("Native metadata probe did not reject its insert.")
    except DatabaseError as error:
        if error.args != (1644, "bazar_guard_contract_ready"):
            raise RuntimeError("Native target trigger contract differs from the installed contract.") from None
    if record:
        Schema.objects.filter(pk=1).update(verified_at=timezone.now())


def structural_inventory(cursor):
    queries = {
        "tables": "SELECT TABLE_NAME,ENGINE,TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE' AND TABLE_NAME<>'bazar_owned_run' ORDER BY TABLE_NAME",
        "indexes": "SELECT TABLE_NAME,INDEX_NAME,NON_UNIQUE,SEQ_IN_INDEX,COLUMN_NAME,SUB_PART FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME<>'bazar_owned_run' ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX",
        "checks": "SELECT TABLE_NAME,CONSTRAINT_NAME,CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() ORDER BY TABLE_NAME,CONSTRAINT_NAME",
        "generated": "SELECT TABLE_NAME,COLUMN_NAME,GENERATION_EXPRESSION FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND EXTRA LIKE '%%GENERATED%%' ORDER BY TABLE_NAME,COLUMN_NAME",
    }
    result = {}
    for name, query in queries.items():
        cursor.execute(query)
        result[name] = [list(row) for row in cursor.fetchall()]
    return result
