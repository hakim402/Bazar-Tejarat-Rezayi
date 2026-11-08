"""Versioned native snapshot restore into an empty private target only.

Restore uses reviewed CREATE TABLE definitions with real constraints, loads rows
before installing guards, then verifies the snapshot's complete contract version.
No serving guard is removed and no applied migration is faked. Native source migration
records are reconstructed from a hash-verified trusted private snapshot of the
same graph. Hashes prove consistency; operator provenance remains required.
"""

import hashlib
import json
import re
from pathlib import Path
from django.db import connection, transaction
from django.utils import timezone
from . import transfer as t
from .mariadb import schema


def descriptor(version=4):
    if version not in {2, 3, 4}:
        raise t.TransferError("Unsupported native recovery version.")
    path = Path(__file__).with_name("mariadb") / f"restore_v{version}.json"
    data = path.read_bytes()
    return {**json.loads(data), "sha256": hashlib.sha256(data).hexdigest()}


def normalized(ddl):
    return re.sub(r" AUTO_INCREMENT=\d+", "", ddl)


def split_foreign(ddl):
    lines = ddl.splitlines()
    foreign = []
    kept = []
    for line in lines:
        if re.match(r"\s*CONSTRAINT `[^`]+` FOREIGN KEY", line):
            foreign.append(line.strip().rstrip(","))
        else:
            kept.append(line)
    for index in range(len(kept) - 1, 0, -1):
        if kept[index].startswith(")"):
            kept[index - 1] = kept[index - 1].rstrip(",")
            break
    return "\n".join(kept), foreign


def initialize(identifier, manifest):
    version = manifest.get("native_schema_version")
    expected = descriptor(version)
    tables = expected["tables"]
    if (
        version not in {2, 3, 4}
        or manifest.get("restore_ddl_sha256") != expected["sha256"]
        or manifest.get("source_vendor") != "mariadb"
    ):
        raise t.TransferError("Unsupported native snapshot version or reviewed restore schema.")
    from .models import Transfer

    existing_tables = set(connection.introspection.table_names()) - {"bazar_owned_run"}
    if existing_tables:
        if "runtime_transfer" not in existing_tables:
            raise t.TransferError("Native restore requires an empty target or its exact private journal.")
        existing = Transfer.objects.first()
        if not existing or existing.pk != identifier or existing.state not in {"loading", "validated"}:
            raise t.TransferError("This native target is initialized or belongs to another restore.")
    else:
        with connection.cursor() as cursor:
            cursor.execute(tables["runtime_transfer"])
        Transfer.objects.create(digest=identifier, manifest=manifest)
    with connection.cursor() as cursor:
        current = schema.guard_inventory(cursor)
        if current and current != {
            name: value for name, value in schema.reference(version)["triggers"].items() if name in current
        }:
            raise t.TransferError("Unexpected native guards found; no object replaced.")
        for name, ddl in tables.items():
            if name in set(connection.introspection.table_names(cursor)):
                continue
            bare, _ = split_foreign(ddl)
            cursor.execute(bare)
        for name, ddl in tables.items():
            _, foreign = split_foreign(ddl)
            constraints = connection.introspection.get_constraints(cursor, name)
            for clause in foreign:
                key = re.match(r"CONSTRAINT `([^`]+)`", clause)[1]
                if not constraints.get(key, {}).get("foreign_key"):
                    cursor.execute("ALTER TABLE `" + name + "` ADD " + clause)
        for name, ddl in tables.items():
            cursor.execute("SHOW CREATE TABLE `" + name + "`")
            if normalized(cursor.fetchone()[1]) != ddl:
                raise t.TransferError("Existing table differs from the reviewed native snapshot schema.")
    return Transfer.objects.get(pk=identifier)


def publish(manifest, journal):
    from .models import Schema

    version = manifest["native_schema_version"]
    expected = schema.reference(version)
    with connection.cursor() as cursor:
        # Select the final reviewed definition for every guard. The DDL history
        # retains older definitions verbatim; restoration never installs an old
        # superseded probe/guard over the selected version's final definition.
        final = {}
        for statement in expected["ddl"]:
            match = re.match(r"CREATE TRIGGER `([^`]+)`", statement)
            if match:
                final[match[1]] = statement
        for name, statement in final.items():
            actual = schema.guard_inventory(cursor)
            if name in actual:
                if actual[name] != expected["triggers"].get(name):
                    raise t.TransferError("A restoration guard differs; publication refused.")
                continue
            cursor.execute(statement)
        cursor.execute(
            "CREATE SEQUENCE IF NOT EXISTS orders_invoice_number START WITH %s INCREMENT BY 1 NOCACHE",
            [manifest["invoice_next"]],
        )
        cursor.execute("ALTER SEQUENCE orders_invoice_number RESTART WITH %s", [manifest["invoice_next"]])
        cursor.execute("SELECT next_not_cached_value FROM orders_invoice_number")
        if int(cursor.fetchone()[0]) != int(manifest["invoice_next"]):
            raise t.TransferError("Restored invoice sequence differs from snapshot.")
        observed = {"triggers": schema.guard_inventory(cursor), "structure": schema.structural_inventory(cursor)}
        if observed != {"triggers": expected["triggers"], "structure": expected["structure"]}:
            raise t.TransferError("Native restored contract differs; remains unready.")
    archived = manifest["control_archive"]["runtime_schema"]
    columns = archived["columns"]
    if len(archived["rows"]) != 1:
        raise t.TransferError("Snapshot lacks its single native schema publication record.")
    values = {
        name: t.decode(value, t.field_kinds()["runtime_schema"][name])
        for name, value in zip(columns, archived["rows"][0], strict=True)
    }
    if not Schema.objects.exists():
        with connection.cursor() as cursor:
            cursor.execute(
                "INSERT INTO runtime_schema ("
                + ",".join(connection.ops.quote_name(k) for k in values)
                + ") VALUES ("
                + ",".join(["%s"] * len(values))
                + ")",
                list(values.values()),
            )
    schema.verify(record=False, version=version)


class NativeImporter(t.Importer):
    def __init__(self, directory, *, expected_digest):
        t.target_only()
        self.directory = t.private_directory(directory)
        path = t.private_file(self.directory / "manifest.json")
        self.identifier = t.digest(path.read_bytes())
        self.manifest = json.loads(path.read_text())
        if not re.fullmatch(r"[0-9a-f]{64}", expected_digest) or self.identifier != expected_digest:
            raise t.TransferError("Native snapshot differs from its separately retained source digest.")
        self.version = self.manifest.get("native_schema_version")
        if self.version not in {2, 3, 4}:
            raise t.TransferError("Unsupported native snapshot version.")
        if self.manifest.get("generated_columns") != schema.reference(self.version)["structure"]["generated"]:
            raise t.TransferError("Native snapshot derived columns differ.")
        self.tables = self.manifest["tables"]
        self.structure = {}
        # Authenticate every file before constructing any target table.
        for name, record in self.tables.items():
            if name not in descriptor(self.version)["tables"] or name in t.EXCLUDED:
                raise t.TransferError("Unsupported native snapshot table.")
            path = t.private_file(self.directory / (name + ".jsonl"))
            check = hashlib.sha256()
            count = 0
            with path.open("rb") as stream:
                for line in stream:
                    check.update(line)
                    count += 1
            if count != record["count"] or check.hexdigest() != record["sha256"]:
                raise t.TransferError("Native snapshot file checksum differs.")
        if set(self.tables) != (set(descriptor(self.version)["tables"]) - t.EXCLUDED):
            raise t.TransferError("Native snapshot omits authoritative tables.")
        self.journal = initialize(self.identifier, self.manifest)
        self.validate_files()

    def run(self, *, stop_after=None):
        from .models import Schema

        finalized = Schema.objects.exists()
        if not finalized:
            for index, table in enumerate(self.order(), 1):
                self.load_table(table)
                if stop_after is not None and index >= stop_after:
                    return {"state": "loading", "loaded_tables": index}
            self.restore_relationships()
        report = self.verify_rows()
        t.validate_history()
        validate_payments()
        validate_evidence(self.manifest)
        if self.version in {3, 4}:
            from apps.fulfilment.recovery import validate_history, validate_evidence as validate_delivery_evidence

            validate_history()
            validate_delivery_evidence(self.manifest)
        if self.version == 4:
            from apps.orders.recovery import validate_history as validate_aftercare

            validate_aftercare()
        self.journal.state = "validated"
        self.journal.save(update_fields=["state"])
        # Restore recorded native migrations, never forge PostgreSQL/native IDs.
        recorded = {tuple(x) for x in self.manifest["source_migrations"]}
        from django.db.migrations.loader import MigrationLoader

        graph = MigrationLoader(connection, ignore_no_migrations=True).graph
        publication = {2: "0005_payments_v2", 3: "0007_fulfilment_v3", 4: "0009_aftercare_v4"}[self.version]
        required = set(graph.forwards_plan(("runtime", publication)))
        if not required.issubset(recorded) or not recorded.issubset(set(graph.nodes)):
            raise t.TransferError("Snapshot migration graph is incomplete or older than its reviewed native graph.")
        archived = self.manifest["control_archive"]["django_migrations"]
        names = archived["columns"]
        kinds = t.field_kinds()["django_migrations"]
        with transaction.atomic(), connection.cursor() as cursor:
            for row in archived["rows"]:
                values = [t.decode(value, kinds[name]) for name, value in zip(names, row, strict=True)]
                cursor.execute(
                    "SELECT "
                    + ",".join(connection.ops.quote_name(x) for x in names)
                    + " FROM django_migrations WHERE id=%s",
                    [values[names.index("id")]],
                )
                existing = cursor.fetchone()
                if existing is None:
                    cursor.execute(
                        "INSERT INTO django_migrations ("
                        + ",".join(connection.ops.quote_name(x) for x in names)
                        + ") VALUES ("
                        + ",".join(["%s"] * len(names))
                        + ")",
                        values,
                    )
                elif list(existing) != values:
                    raise t.TransferError("Restored migration history differs from its exact native snapshot.")
        publish(self.manifest, self.journal)
        self.journal.state = "complete"
        self.journal.completed_at = timezone.now()
        self.journal.save(update_fields=["state", "completed_at"])
        schema.verify(record=False, version=self.version)
        if self.version == 4 and not schema.ready():
            raise t.TransferError("Restored current schema did not pass native readiness.")
        return {
            "state": "complete",
            "native_schema_version": self.version,
            "requires_upgrade": self.version != 4,
            "manifest_sha256": self.identifier,
            "tables": report,
        }


def validate_payments():
    from decimal import Decimal
    from apps.payments import models as p, queries

    for state in p.Finance.objects.select_related("order").iterator(chunk_size=100):
        paid = queries.confirmed(state.order)
        if not Decimal(0) <= paid <= Decimal("9999999999999999999999.99"):
            raise t.TransferError("Restored confirmed payment total exceeds its exact bound.")
        events = list(
            p.Event.construction.filter(order=state.order).order_by("version").values_list("version", flat=True)
        )
        if events != list(range(1, state.version + 1)):
            raise t.TransferError("Restored financial history/head is incomplete.")
    for receipt in p.Receipt.objects.select_related("claim").iterator(chunk_size=100):
        if not p.ReviewCase.objects.filter(receipt=receipt, kind="receipt").exists():
            raise t.TransferError("Restored published receipt lacks independent review coordination.")
        if (
            receipt.claim_id
            and not p.ClaimDecision.objects.filter(
                claim_id=receipt.claim_id, action="confirmed", event_id=receipt.event_id
            ).exists()
        ):
            raise t.TransferError("Restored claim confirmation differs from its receipt.")
    for intent in p.AllocationIntent.objects.select_related("order", "first_receipt").iterator(chunk_size=100):
        if intent.order.payment_method != "advance" or intent.first_receipt.order_id != intent.order_id:
            raise t.TransferError("Restored stock intent differs from its advance receipt.")
        if intent.allocation_id and not intent.attempts.filter(operation_id=intent.allocation.operation_id).exists():
            raise t.TransferError("Restored reservation has no retained payment attempt.")


def validate_evidence(manifest):
    from django.core.files.storage import storages
    from apps.payments.models import Evidence

    rows = {str(row.pk): row for row in Evidence.objects.all()}
    records = manifest.get("payment_evidence_files")
    if not isinstance(records, list) or {record["id"] for record in records} != set(rows):
        raise t.TransferError("Native snapshot payment file inventory is incomplete.")
    for record in records:
        row = rows[record["id"]]
        if any(record[field] != getattr(row, field) for field in ["storage_alias", "key", "sha256", "size"]):
            raise t.TransferError("Payment evidence metadata differs from native snapshot.")
        checksum = hashlib.sha256()
        size = 0
        try:
            with storages[row.storage_alias].open(row.key, "rb") as stream:
                while block := stream.read(65536):
                    checksum.update(block)
                    size += len(block)
        except OSError:
            raise t.TransferError("A private payment evidence object is missing from recovery.") from None
        if size != row.size or checksum.hexdigest() != row.sha256:
            raise t.TransferError("Recovered private payment evidence checksum differs.")
