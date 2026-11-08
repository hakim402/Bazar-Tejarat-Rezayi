"""Private deterministic PostgreSQL-to-MariaDB transfer, never an in-place rewrite.

Only a fresh, unservable target or this exact transfer's journal can be loaded.
Existing initialized targets are refused. No guard is dropped or disabled.
"""

import base64
from datetime import date, datetime, time, timezone as utc_timezone
from decimal import Decimal, ROUND_HALF_UP
import hashlib
import json
import os
from pathlib import Path
import re
import stat
from uuid import UUID

from django.apps import apps
from django.conf import settings
from django.db import connection, transaction
from django.db.migrations.executor import MigrationExecutor
from django.utils import timezone

EXCLUDED = {
    "django_migrations",
    "runtime_schema",
    "runtime_transfer",
    "runtime_scheduler",
    "bazar_owned_run",
    "runtime_guardprobe",
    "orders_invoice_number",
}
DEFERRED = {
    "catalogue_product": {"published_id"},
    "marketplace_store": {"published_id"},
    "site_sitesettings": {"promotion_one_id", "promotion_two_id"},
}
ADDED = {("messaging_message", "published"): True}
NAME = re.compile(r"^[a-z][a-z0-9_]{0,62}$")


class TransferError(Exception):
    pass


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def digest(value):
    return hashlib.sha256(value).hexdigest()


def private_directory(path, *, create=False):
    path = Path(path).expanduser().absolute()
    root = Path(settings.DATA_ROOT).resolve().parent
    if not path.resolve().is_relative_to(root) or path == root or path.is_symlink():
        raise TransferError("Transfer paths must be inside the canonical private shared directory.")
    if create:
        path.mkdir(mode=0o700)
    info = path.stat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) & 0o077:
        raise TransferError("Transfer directory must be owned privately with mode0700.")
    return path


def private_file(path):
    info = path.stat()
    if (
        path.is_symlink()
        or not stat.S_ISREG(info.st_mode)
        or info.st_uid != os.getuid()
        or stat.S_IMODE(info.st_mode) & 0o077
    ):
        raise TransferError("Transfer files must be owned privately with mode0600.")
    return path


def write_json(path, value):
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as stream:
        stream.write(canonical(value) + "\n")


def field_kinds():
    result = {}
    for model in apps.get_models(include_auto_created=True):
        fields = {}
        for original in model._meta.concrete_fields:
            field = original
            while getattr(field, "target_field", None) is not None:
                field = field.target_field
            fields[original.column] = field.get_internal_type()
        result[model._meta.db_table] = fields
    result["django_migrations"] = {
        "id": "AutoField",
        "app": "CharField",
        "name": "CharField",
        "applied": "DateTimeField",
    }
    return result


def encode(value, kind, vendor):
    if value is None:
        return None
    if kind == "JSONField":
        # Preserve raw JSON text, including scalar strings/JSON null and exact
        # numeric lexemes. SQL NULL remains the separate outer None value.
        raw = (
            value.decode("utf-8") if isinstance(value, bytes) else value if isinstance(value, str) else canonical(value)
        )
        json.loads(
            raw,
            parse_float=Decimal,
            parse_constant=lambda value: (_ for _ in ()).throw(ValueError("Invalid JSON number")),
        )
        return {"json_text": raw}
    if kind == "UUIDField":
        return str(UUID(str(value)))
    if kind == "DecimalField":
        return format(Decimal(value), "f")
    if kind == "DateTimeField":
        if value.tzinfo is None:
            value = value.replace(tzinfo=utc_timezone.utc)
        return value.astimezone(utc_timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")
    if kind in {"DateField", "TimeField"}:
        return value.isoformat()
    if kind == "BinaryField":
        return base64.b64encode(bytes(value)).decode("ascii")
    if kind in {"BooleanField", "NullBooleanField"}:
        if value not in {True, False, 0, 1}:
            raise TransferError("Invalid Boolean representation.")
        return bool(value)
    if kind.endswith("IntegerField") or kind.endswith("AutoField"):
        return int(value)
    if isinstance(value, (str, int, float, bool)):
        return value
    raise TransferError("An explicit source type mapping is missing.")


def decode(value, kind):
    if value is None:
        return None
    if kind == "JSONField":
        if not isinstance(value, dict) or set(value) != {"json_text"} or not isinstance(value["json_text"], str):
            raise TransferError("JSON requires the explicit v2 text envelope.")
        json.loads(
            value["json_text"],
            parse_float=Decimal,
            parse_constant=lambda value: (_ for _ in ()).throw(ValueError("Invalid JSON number")),
        )
        return value["json_text"]
    if kind == "UUIDField":
        return UUID(value).hex
    if kind == "DecimalField":
        return Decimal(value)
    if kind == "DateTimeField":
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(utc_timezone.utc).replace(tzinfo=None)
    if kind == "DateField":
        return date.fromisoformat(value)
    if kind == "TimeField":
        return time.fromisoformat(value)
    if kind == "BinaryField":
        return base64.b64decode(value, validate=True)
    return value


def export_columns(table, names, kinds, *, vendor, generated=()):
    approved = {column for owner, column, expression in generated if owner == table} if vendor == "mysql" else set()
    known = set(kinds[table])
    if set(names) - known != approved or vendor == "mysql" and set(names) - approved != known:
        raise TransferError("Source columns differ from the explicit model/generated-column contract.")
    return [name for name in names if name not in approved]


def export_source(output, *, source_revision):
    if connection.vendor not in {"postgresql", "mysql"} or not re.fullmatch(
        r"(?:[0-9a-f]{40}|manifest:[0-9a-f]{64})", source_revision
    ):
        raise TransferError("Export requires the intended supported source and an explicit complete source identifier.")
    output = private_directory(output, create=True)
    kinds = field_kinds()
    result = {
        "format": 2,
        "source_vendor": "mariadb" if connection.vendor == "mysql" else "postgresql",
        "source_revision": source_revision,
        "source_migrations": [],
        "tables": {},
    }
    original_autocommit = connection.get_autocommit()
    if not original_autocommit:
        raise TransferError("Export requires its own read-only snapshot transaction.")
    generated = []
    if connection.vendor == "mysql":
        from .mariadb.schema import verify, reference

        # The guard probe rolls back. Backup must not update even control rows.
        from .models import Schema

        from .mariadb.schema import contract

        installed = Schema.objects.get(pk=1).contract
        native_version = next((version for version in (4, 3, 2, 1) if installed == contract(version)), None)
        if native_version is None:
            raise TransferError("An unready or unknown native schema cannot be exported as a release snapshot.")
        verify(record=False, version=native_version)
        generated = reference(native_version)["structure"]["generated"]
        if native_version in {2, 3, 4}:
            from .native_restore import descriptor

            result.update(
                format=3, native_schema_version=native_version, restore_ddl_sha256=descriptor(native_version)["sha256"]
            )
        result["generated_columns"] = generated
    connection.set_autocommit(False)
    try:
        with connection.cursor() as cursor:
            cursor.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
            tables = sorted(connection.introspection.table_names(cursor))
            cursor.execute("SELECT app,name FROM django_migrations ORDER BY app,name")
            result["source_migrations"] = [list(row) for row in cursor.fetchall()]
            if connection.vendor == "postgresql":
                cursor.execute("SHOW server_version")
                result["source_server_version"] = cursor.fetchone()[0]
                cursor.execute("SELECT last_value,is_called FROM orders_invoice_number")
                number, called = cursor.fetchone()
                result["invoice_next"] = int(number) + int(called)
            else:
                cursor.execute("SELECT VERSION()")
                result["source_server_version"] = cursor.fetchone()[0]
                cursor.execute("SELECT next_not_cached_value FROM orders_invoice_number")
                result["invoice_next"] = int(cursor.fetchone()[0])
                result["control_archive"] = {}
                for owner in ("runtime_schema", "runtime_transfer", "runtime_scheduler", "django_migrations"):
                    cursor.execute("SELECT * FROM " + connection.ops.quote_name(owner))
                    names = [value[0] for value in cursor.description]
                    result["control_archive"][owner] = {
                        "columns": names,
                        "rows": [
                            [encode(value, kinds[owner][name], "mysql") for name, value in zip(names, row, strict=True)]
                            for row in cursor.fetchall()
                        ],
                    }

            # The retained PostgreSQL transfer remains the v1 baseline path.
            # A source with financial facts or changed Phase12 policy must use
            # the supported native target; never silently downcast those facts.
            legacy_extras = {
                "orders_orderpolicy": {"reminder_hours": 24},
                "notifications_event": {"payment_event_id": None, "fulfilment_event_id": None},
                "notifications_notice": {"payment_order_id": None, "fulfilment_order_id": None},
                "notifications_preference": {"payment_email": True},
            }
            if connection.vendor == "postgresql":
                for table in tables:
                    if table.startswith(("payments_", "fulfilment_")) or table == "inventory_stocktransition":
                        cursor.execute("SELECT COUNT(*) FROM " + connection.ops.quote_name(table))
                        if cursor.fetchone()[0]:
                            raise TransferError(
                                "PostgreSQL payment/fulfilment data cannot be downcast to the retained v1 transfer contract."
                            )
                if "inventory_operation" in tables:
                    cursor.execute("SELECT COUNT(*) FROM inventory_operation WHERE account_id IS NULL")
                    if cursor.fetchone()[0]:
                        raise TransferError("Root stock provenance cannot be downcast to a required legacy Account.")
                for table, fields in legacy_extras.items():
                    if table not in tables:
                        continue
                    available = {field.name for field in connection.introspection.get_table_description(cursor, table)}
                    for name, default in fields.items():
                        if name not in available:
                            continue
                        cursor.execute(
                            "SELECT COUNT(*) FROM "
                            + connection.ops.quote_name(table)
                            + " WHERE "
                            + connection.ops.quote_name(name)
                            + " IS DISTINCT FROM %s",
                            [default],
                        )
                        if cursor.fetchone()[0]:
                            raise TransferError(
                                "Changed payment/fulfilment facts or policy cannot be omitted from a legacy source transfer."
                            )
            for table in tables:
                if connection.vendor == "postgresql" and (
                    table.startswith(("payments_", "fulfilment_")) or table == "inventory_stocktransition"
                ):
                    continue
                if table in EXCLUDED:
                    continue
                if not NAME.fullmatch(table) or table not in kinds:
                    raise TransferError("An unmapped source table must be reviewed before export.")
                description = connection.introspection.get_table_description(cursor, table)
                columns = export_columns(
                    table, [field.name for field in description], kinds, vendor=connection.vendor, generated=generated
                )
                if connection.vendor == "postgresql":
                    columns = [name for name in columns if name not in legacy_extras.get(table, {})]
                primary = connection.introspection.get_primary_key_column(cursor, table)
                if not primary or primary not in columns:
                    raise TransferError("A source table lacks a supported single primary key.")
                fields = [{"name": name, "kind": kinds[table][name]} for name in columns]
                path = output / (table + ".jsonl")
                checksum, count = hashlib.sha256(), 0
                quoted = ",".join(
                    "CAST("
                    + connection.ops.quote_name(field["name"])
                    + (" AS TEXT)" if connection.vendor == "postgresql" else " AS CHAR CHARACTER SET utf8mb4)")
                    if field["kind"] == "JSONField"
                    else connection.ops.quote_name(field["name"])
                    for field in fields
                )
                query = (
                    "SELECT "
                    + quoted
                    + " FROM "
                    + connection.ops.quote_name(table)
                    + " ORDER BY "
                    + connection.ops.quote_name(primary)
                )
                with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as stream:
                    with connection.chunked_cursor() as rows:
                        rows.execute(query)
                        while batch := rows.fetchmany(500):
                            for row in batch:
                                data = [
                                    encode(value, field["kind"], connection.vendor)
                                    for value, field in zip(row, fields, strict=True)
                                ]
                                line = (canonical(data) + "\n").encode()
                                stream.write(line)
                                checksum.update(line)
                                count += 1
                result["tables"][table] = {
                    "columns": fields,
                    "primary": primary,
                    "count": count,
                    "sha256": checksum.hexdigest(),
                }
        if result["format"] == 3:
            from apps.payments.models import Evidence

            result["payment_evidence_files"] = [
                {
                    "id": str(row.pk),
                    "storage_alias": row.storage_alias,
                    "key": row.key,
                    "sha256": row.sha256,
                    "size": row.size,
                }
                for row in Evidence.objects.order_by("pk")
            ]
        if result.get("native_schema_version") in {3, 4}:
            from apps.fulfilment.models import Evidence as DeliveryEvidence

            result["delivery_evidence_files"] = [
                {
                    "id": str(row.pk),
                    "storage_alias": row.storage_alias,
                    "key": row.key,
                    "sha256": row.sha256,
                    "size": row.size,
                }
                for row in DeliveryEvidence.objects.order_by("pk")
            ]
        write_json(output / "manifest.json", result)
    finally:
        connection.rollback()
        connection.set_autocommit(original_autocommit)
    return {
        "tables": len(result["tables"]),
        "rows": sum(t["count"] for t in result["tables"].values()),
        "manifest_sha256": digest((output / "manifest.json").read_bytes()),
    }


def target_only():
    if connection.vendor != "mysql" or not connection.mysql_is_mariadb or connection.mysql_version[:2] != (11, 4):
        raise TransferError("Import requires a fresh MariaDB11.4 target; the source is never modified.")


def prepare_target():
    target_only()
    tables = set(connection.introspection.table_names()) - {"bazar_owned_run"}
    if tables:
        raise TransferError("Initialization refuses a nonempty target. Resume only its existing transfer journal.")
    MigrationExecutor(connection).migrate([("runtime", "0002_mariadb_staging")])
    return "Fresh target staging schema initialized; HTTP/jobs remain unavailable."


class Importer:
    def __new__(cls, directory, *, expected_digest):
        manifest = json.loads(private_file(private_directory(directory) / "manifest.json").read_text())
        if cls is Importer and manifest.get("format") == 3:
            from .native_restore import NativeImporter

            return object.__new__(NativeImporter)
        return super().__new__(cls)

    def __init__(self, directory, *, expected_digest):
        target_only()
        self.directory = private_directory(directory)
        manifest_path = private_file(self.directory / "manifest.json")
        self.manifest = json.loads(manifest_path.read_text())
        if self.manifest.get("format") != 2 or self.manifest.get("source_vendor") not in {"postgresql", "mariadb"}:
            raise TransferError("Unsupported transfer manifest.")
        if self.manifest["source_vendor"] == "mariadb":
            from .mariadb.schema import reference

            if self.manifest.get("generated_columns") != reference()["structure"]["generated"]:
                raise TransferError("Native derived columns differ from the reviewed recovery contract.")
        self.identifier = digest(manifest_path.read_bytes())
        if not re.fullmatch(r"[0-9a-f]{64}", expected_digest) or self.identifier != expected_digest:
            raise TransferError("The manifest differs from the separately verified source receipt.")
        self.tables = self.manifest["tables"]
        from .models import Schema, Transfer

        existing = Transfer.objects.first()
        if Schema.objects.exists() and (
            existing is None or existing.pk != self.identifier or existing.state != "validated"
        ):
            raise TransferError("An initialized target is never re-imported. Use the reviewed recovery path.")
        if existing and existing.pk != self.identifier:
            raise TransferError("This target belongs to a different transfer.")
        if not existing:
            for table in connection.introspection.table_names():
                if table in {"django_migrations", "bazar_owned_run"}:
                    continue
                with connection.cursor() as cursor:
                    cursor.execute("SELECT COUNT(*) FROM " + connection.ops.quote_name(table))
                    if cursor.fetchone()[0]:
                        raise TransferError("Unrelated populated data found; import refused.")
            existing = Transfer.objects.create(digest=self.identifier, manifest=self.manifest)
        self.journal = existing
        self.structure = {}
        self.validate_files()

    def validate_files(self):
        available = set(connection.introspection.table_names())
        kinds = field_kinds()
        for table, record in self.tables.items():
            if not NAME.fullmatch(table) or table not in available or table in EXCLUDED:
                raise TransferError("A source table has no explicit target mapping.")
            fields = record["columns"]
            names = [field["name"] for field in fields]
            if len(names) != len(set(names)) or record["primary"] not in names:
                raise TransferError("Invalid column or primary-key manifest.")
            with connection.cursor() as cursor:
                description = connection.introspection.get_table_description(cursor, table)
                constraints = connection.introspection.get_constraints(cursor, table)
            target = {field.name: field for field in description}
            if set(names) - set(target) or any(not NAME.fullmatch(name) for name in names):
                raise TransferError("A source column has no explicit target mapping.")
            if any(kinds.get(table, {}).get(field["name"]) != field["kind"] for field in fields):
                raise TransferError("Source and target type mappings differ.")
            added = {name: value for (owner, name), value in ADDED.items() if owner == table and name not in names}
            if any(not field.null_ok and name not in names and name not in added for name, field in target.items()):
                raise TransferError("A required additive target field needs an explicit mapping.")
            foreign = {}
            for constraint in constraints.values():
                if constraint.get("foreign_key"):
                    if len(constraint["columns"]) != 1:
                        raise TransferError("Composite foreign-key import requires an explicit mapping.")
                    foreign[constraint["columns"][0]] = constraint["foreign_key"]
            deferred = DEFERRED.get(table, set()) & set(names)
            if any(not target[name].null_ok for name in deferred):
                raise TransferError("A deferred relationship is no longer nullable.")
            self.structure[table] = {
                "names": names,
                "fields": fields,
                "primary": record["primary"],
                "added": added,
                "foreign": foreign,
                "deferred": deferred,
            }
            checksum, count = hashlib.sha256(), 0
            with private_file(self.directory / (table + ".jsonl")).open("rb") as stream:
                for line in stream:
                    checksum.update(line)
                    count += 1
                    row = json.loads(line)
                    if not isinstance(row, list) or len(row) != len(fields):
                        raise TransferError("Invalid transfer row shape.")
            if count != record["count"] or checksum.hexdigest() != record["sha256"]:
                raise TransferError("Transfer file count/checksum mismatch.")

    def rows(self, table):
        with private_file(self.directory / (table + ".jsonl")).open() as stream:
            for line in stream:
                yield json.loads(line)

    def order(self):
        remaining, done, result = set(self.tables), set(), []
        while remaining:
            ready = sorted(
                table
                for table in remaining
                if not {
                    owner
                    for column, (owner, remote) in self.structure[table]["foreign"].items()
                    if column not in self.structure[table]["deferred"] and owner != table and owner in self.tables
                }
                - done
            )
            if not ready:
                raise TransferError("A required relationship cycle needs an explicit migration design.")
            result.extend(ready)
            done.update(ready)
            remaining.difference_update(ready)
        return result

    def fetch(self, table, pk):
        spec = self.structure[table]
        quoted = ",".join(connection.ops.quote_name(name) for name in spec["names"])
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT "
                + quoted
                + " FROM "
                + connection.ops.quote_name(table)
                + " WHERE "
                + connection.ops.quote_name(spec["primary"])
                + "=%s",
                [decode(pk, next(f["kind"] for f in spec["fields"] if f["name"] == spec["primary"]))],
            )
            row = cursor.fetchone()
        return (
            None
            if row is None
            else [encode(value, field["kind"], "mysql") for value, field in zip(row, spec["fields"], strict=True)]
        )

    def reject(self, table, key, code):
        path = self.directory / "rejected-rows.jsonl"
        if path.exists() or path.is_symlink():
            private_file(path)
        flags = os.O_WRONLY | os.O_CREAT | os.O_APPEND | os.O_NOFOLLOW
        with os.fdopen(os.open(path, flags, 0o600), "a") as stream:
            stream.write(canonical({"table": table, "pk_sha256": digest(canonical(key).encode()), "code": code}) + "\n")
        raise TransferError("Transfer rejected a row; see its private hashed-key report.")

    def load_table(self, table):
        spec = self.structure[table]
        primary_index = spec["names"].index(spec["primary"])
        while True:
            postponed, inserted = 0, 0
            for row in self.rows(table):
                key = row[primary_index]
                existing = self.fetch(table, key)
                if existing is not None:
                    if any(
                        actual != expected and not (name in spec["deferred"] and actual is None)
                        for name, actual, expected in zip(spec["names"], existing, row, strict=True)
                    ):
                        self.reject(table, key, "different_existing_row")
                    continue
                values = {
                    field["name"]: decode(value, field["kind"])
                    for value, field in zip(row, spec["fields"], strict=True)
                }
                missing = False
                with connection.cursor() as cursor:
                    for column, (owner, remote) in spec["foreign"].items():
                        if owner != table or column in spec["deferred"] or values.get(column) is None:
                            continue
                        cursor.execute(
                            "SELECT 1 FROM "
                            + connection.ops.quote_name(owner)
                            + " WHERE "
                            + connection.ops.quote_name(remote)
                            + "=%s",
                            [values[column]],
                        )
                        if cursor.fetchone() is None:
                            missing = True
                            break
                if missing:
                    postponed += 1
                    continue
                for column in spec["deferred"]:
                    values[column] = None
                values.update(spec["added"])
                names = list(values)
                sql = (
                    "INSERT INTO "
                    + connection.ops.quote_name(table)
                    + " ("
                    + ",".join(connection.ops.quote_name(name) for name in names)
                    + ") VALUES ("
                    + ",".join(["%s"] * len(names))
                    + ")"
                )
                try:
                    with transaction.atomic(), connection.cursor() as cursor:
                        cursor.execute(sql, [values[name] for name in names])
                except Exception:
                    self.reject(table, key, "native_insert_rejected")
                inserted += 1
            if not postponed:
                break
            if not inserted:
                raise TransferError("A self-reference is cyclic or missing; no row was dropped.")
        self.journal.progress = {**self.journal.progress, table: "loaded"}
        self.journal.save(update_fields=["progress"])

    def restore_relationships(self):
        for table, spec in self.structure.items():
            if not spec["deferred"]:
                continue
            primary_index = spec["names"].index(spec["primary"])
            for row in self.rows(table):
                current = self.fetch(table, row[primary_index])
                for column in spec["deferred"]:
                    index = spec["names"].index(column)
                    if current[index] == row[index]:
                        continue
                    field = spec["fields"][index]
                    with transaction.atomic(), connection.cursor() as cursor:
                        cursor.execute(
                            "UPDATE "
                            + connection.ops.quote_name(table)
                            + " SET "
                            + connection.ops.quote_name(column)
                            + "=%s WHERE "
                            + connection.ops.quote_name(spec["primary"])
                            + "=%s",
                            [
                                decode(row[index], field["kind"]),
                                decode(row[primary_index], spec["fields"][primary_index]["kind"]),
                            ],
                        )

    def verify_rows(self):
        report = {}
        for table, record in self.tables.items():
            spec = self.structure[table]
            primary_index = spec["names"].index(spec["primary"])
            checksum = hashlib.sha256()
            for source in self.rows(table):
                target = self.fetch(table, source[primary_index])
                if target != source:
                    self.reject(table, source[primary_index], "row_checksum_difference")
                checksum.update((canonical(target) + "\n").encode())
            with connection.cursor() as cursor:
                cursor.execute("SELECT COUNT(*) FROM " + connection.ops.quote_name(table))
                count = cursor.fetchone()[0]
            if count != record["count"] or checksum.hexdigest() != record["sha256"]:
                raise TransferError("Target count/checksum differs; publication refused.")
            report[table] = {"count": count, "sha256": checksum.hexdigest()}
        return report

    def run(self, *, stop_after=None):
        from .models import Schema

        finalized = Schema.objects.exists()
        for index, table in enumerate(self.order() if not finalized else [], 1):
            self.load_table(table)
            if stop_after is not None and index >= stop_after:
                return {"state": "loading", "loaded_tables": index}
        if not finalized:
            self.restore_relationships()
        report = self.verify_rows()
        validate_history()
        self.journal.state = "validated"
        self.journal.save(update_fields=["state"])
        MigrationExecutor(connection).migrate([("runtime", "0003_mariadb_guards")])
        from .mariadb.schema import verify

        verify(version=1)
        MigrationExecutor(connection).migrate([("runtime", "0005_payments_v2")])
        verify(version=2)
        MigrationExecutor(connection).migrate([("runtime", "0007_fulfilment_v3")])
        verify(version=3)
        MigrationExecutor(connection).migrate([("runtime", "0009_aftercare_v4")])
        verify(version=4)
        # New definitions are additive metadata; no group/account assignment is
        # created. Keep this transaction atomic with final transfer publication.
        from django.contrib.contenttypes.management import create_contenttypes
        from django.contrib.auth.management import create_permissions

        with transaction.atomic():
            for app in apps.get_app_configs():
                create_contenttypes(app, verbosity=0, interactive=False, using=connection.alias)
            for app in apps.get_app_configs():
                create_permissions(app, verbosity=0, interactive=False, using=connection.alias)
            self.journal.state, self.journal.completed_at = "complete", timezone.now()
            self.journal.save(update_fields=["state", "completed_at"])
        return {"state": "complete", "manifest_sha256": self.identifier, "tables": report}


def validate_history():
    """Historical invariants use retained snapshots, not today's revoked grants."""
    from apps.orders.models import SellerOrder, Negotiation

    for order in SellerOrder.construction.select_related("outcome", "negotiation").iterator(chunk_size=100):
        lines = list(order.lines.model.construction.filter(order_id=order.pk))
        if not lines or sum((line.goods_amount for line in lines), Decimal(0)) != order.goods_total:
            raise TransferError("Historical agreement total/line set is incomplete.")
        if any(
            (line.quantity * line.unit_price).quantize(Decimal(".01"), rounding=ROUND_HALF_UP) != line.goods_amount
            for line in lines
        ):
            raise TransferError("Historical line arithmetic differs.")
        from apps.orders.models import Invoice, OrderEvent, NegotiationRevision

        if Invoice.construction.filter(order_id=order.pk).count() != 1:
            raise TransferError("Historical agreement lacks its unique invoice.")
        action = "negotiated_order_accepted" if order.negotiation_id else "fixed_order_accepted"
        if not OrderEvent.construction.filter(order_id=order.pk, action=action).exists():
            raise TransferError("Historical acceptance event missing.")
        if order.negotiation_id:
            request = order.negotiation
            if (request.buyer_id, request.seller_id, request.currency) != (
                order.buyer_id,
                order.seller_id,
                order.currency,
            ):
                raise TransferError("Historical negotiated party/currency binding differs.")
            proposal = NegotiationRevision.construction.get(request=request, number=request.revision).body
            caps = {(row["variant"], row["tier"]): row for row in proposal["lines"]}
            if (
                request.state != "accepted"
                or order.snapshot.get("proposal") != proposal
                or set(caps) != {(str(line.variant_id), line.tier) for line in lines}
            ):
                raise TransferError("Historical negotiated agreement/line set differs.")
            for line in lines:
                cap = caps[(str(line.variant_id), line.tier)]
                if (
                    line.quantity > Decimal(cap["max_quantity"])
                    or line.unit_price > Decimal(cap["max_unit_price"])
                    or line.snapshot.get("max_quantity") != cap["max_quantity"]
                    or line.snapshot.get("max_unit_price") != cap["max_unit_price"]
                ):
                    raise TransferError("Historical buyer caps differ.")
        else:
            origin = order.outcome
            if (
                origin.state != "accepted"
                or origin.seller_id != order.seller_id
                or origin.submission.buyer_id != order.buyer_id
                or origin.submission.payload["currency"] != order.currency
            ):
                raise TransferError("Historical fixed order party/currency/outcome differs.")
    from apps.orders.models import NegotiationRevision, NegotiationEvent

    for request in Negotiation.construction.iterator(chunk_size=100):
        events = list(NegotiationEvent.construction.filter(request=request).order_by("version"))
        expected_action = "resubmitted" if request.state == "submitted" and request.version > 1 else request.state
        if (
            [event.version for event in events] != list(range(1, request.version + 1))
            or not events
            or events[-1].revision != request.revision
            or events[-1].action != expected_action
        ):
            raise TransferError("Historical request event/head differs.")
        selected = None
        revisions = list(NegotiationRevision.construction.filter(request=request).order_by("number"))
        if [revision.number for revision in revisions] != list(range(1, request.revision + 1)):
            raise TransferError("Historical buyer revisions are incomplete.")
        for revision in revisions:
            rows = revision.body["lines"]
            keys = {(row["variant"], row["tier"]) for row in rows}
            if not 1 <= len(rows) <= 100 or len(keys) != len(rows) or (selected is not None and keys != selected):
                raise TransferError("Historical proposal line set differs.")
            selected = keys
            for row in rows:
                if not (
                    0 < Decimal(row["quantity"]) <= Decimal(row["max_quantity"])
                    and 0 < Decimal(row["unit_price"]) <= Decimal(row["max_unit_price"])
                ):
                    raise TransferError("Historical buyer proposal caps differ.")
    from apps.messaging.models import Message

    for message in Message.construction.iterator(chunk_size=100):
        images = list(message.attachments.all())
        if (
            not message.body.strip()
            and not images
            or len(images) > 3
            or any(
                image.creator_id != message.author_id or image.conversation_id != message.conversation_id
                for image in images
            )
        ):
            raise TransferError("Historical message content/binding is incomplete.")

    # Decrypt privately only to prove continuity. Never persist or print plaintext.
    from cryptography.fernet import Fernet, InvalidToken
    from apps.accounts.models import Authenticator

    cipher = Fernet(settings.MFA_ENCRYPTION_KEY.encode())
    for factor in Authenticator.objects.iterator(chunk_size=100):
        try:
            cipher.decrypt(factor.encrypted_secret.encode())
        except (InvalidToken, AttributeError, ValueError):
            raise TransferError(
                "Authenticator encryption continuity failed; preserve and review the source key."
            ) from None
