"""One-time capture of the reviewed native v5 contract and restore artifacts.

Runs against the disposable run-owned MariaDB base database after v5 domain DDL
but before ``runtime.0011_disputes_v5`` publication. It applies the exact Phase 15 guard
delta (the same statements ``runtime.0011_disputes_v5`` will publish), recomputes
the metadata probe, then records the resulting contract and full restore schema.
The disposable database is discarded by the runner; no private or production
database is ever touched. This tool only writes the two reviewed JSON artifacts.
"""

import json
from pathlib import Path

from django.db import connection

from apps.runtime.mariadb import schema
from apps.runtime.mariadb.additive import normalize
from apps.runtime.mariadb.aftercare_v4 import apply_guards
from apps.runtime.mariadb.disputes_v5 import REPLACED, additions
from apps.runtime.mariadb.payments_v2 import PROBE, probe_statement

TARGET = Path(__file__).resolve().parents[1] / "apps" / "runtime" / "mariadb"


def _write(name, data):
    (TARGET / name).write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False) + "\n")


def prepare():
    from django.db import migrations
    from django.db.migrations.executor import MigrationExecutor
    from config.testing import assert_owned_database

    assert_owned_database(connection)
    executor = MigrationExecutor(connection)
    nodes = (
        ("orders", "0004_disputerequest_alter_aftercare_options_review_and_more"),
        ("payments", "0003_remove_evidencebinding_payments_evidence_target_and_more"),
        ("messaging", "0002_report_order_report_product_report_store_and_more"),
        ("notifications", "0006_remove_notice_notifications_typed_resource_and_more"),
    )
    if any(node in executor.loader.applied_migrations for node in nodes):
        raise RuntimeError("Capture requires a fresh owned database, not an existing v5 migration graph.")
    # Capture uses Django DDL once to bootstrap the exact resumable reference.
    for node in nodes:
        migration = executor.loader.get_migration(*node)
        operations = []
        for operation in migration.operations:
            if isinstance(operation, migrations.SeparateDatabaseAndState):
                operations.extend(operation.state_operations)
            elif operation.__class__.__module__.endswith("additive_v5"):
                name, args, kwargs = operation.deconstruct()
                operations.append(getattr(migrations, name)(*args, **kwargs))
            else:
                operations.append(operation)
        migration.operations = operations
    publication = executor.loader.get_migration("runtime", "0011_disputes_v5")
    executor.migrate(publication.dependencies)


def capture():
    from config.testing import assert_owned_database

    assert_owned_database(connection)
    if connection.vendor != "mysql" or not connection.mysql_is_mariadb:
        raise RuntimeError("Native v5 capture requires the disposable MariaDB target.")

    from apps.runtime.models import Schema

    row = Schema.objects.get(pk=1)
    from apps.runtime.mariadb.disputes_v5 import UPGRADING

    if row.contract != UPGRADING:
        raise RuntimeError("Capture requires the owned v5 domain graph before guard publication.")

    delta = additions()
    with connection.cursor() as cursor:
        apply_guards(cursor, expected=None, version=5, replaced=REPLACED, delta=delta)
        actual = schema.guard_inventory(cursor)
        if actual.get(PROBE) not in {None, schema.reference(4)["triggers"][PROBE]}:
            raise RuntimeError("Unexpected native metadata probe before v5 capture.")
        cursor.execute(f"DROP TRIGGER IF EXISTS `{PROBE}`")
        probe = probe_statement(actual)
        cursor.execute(probe)
        triggers = schema.guard_inventory(cursor)
        structure = schema.structural_inventory(cursor)
        tables = {}
        for entry in structure["tables"]:
            name = entry[0]
            cursor.execute(f"SHOW CREATE TABLE `{name}`")
            tables[name] = normalize(cursor.fetchone()[1])

    contract = {"ddl": list(schema.reference(4)["ddl"]) + delta + [probe], "triggers": triggers, "structure": structure}
    restore = {"tables": dict(sorted(tables.items()))}
    _write("contract_v5.json", contract)
    _write("restore_v5.json", restore)
    print(
        f"Captured native v5: {len(contract['ddl'])} ddl (+{len(delta)}), "
        f"{len(triggers)} triggers, {len(structure['tables'])} tables."
    )


if __name__ == "__main__":
    import django

    django.setup()
    prepare()
    capture()
