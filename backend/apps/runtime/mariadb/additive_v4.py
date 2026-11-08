"""Exact, resumable Phase 14 DDL; unknown existing definitions fail closed.

Version 1/2/3 construction and their stored references are unchanged. Only
the new v4 migration operations call this module. Publication is a separate step.
"""

import json
from pathlib import Path
from django.db import migrations
from . import schema
from .additive import split, column, current


def definitions():
    return json.loads(Path(__file__).with_name("restore_v4.json").read_text())["tables"]


def create_tables(editor, prefix, skip=()):
    if editor.connection.vendor != "mysql":
        raise RuntimeError("Phase 14 native construction requires MariaDB.")
    # Tables that already exist and gain columns here are built by the additive
    # operations that precede them; their foreign keys would otherwise point at
    # tables this same migration has not created yet.
    expected = {
        name: ddl for name, ddl in definitions().items() if name.startswith(prefix) and name not in skip
    }
    with editor.connection.cursor() as cursor:
        existing = set(editor.connection.introspection.table_names(cursor))
        for name, ddl in expected.items():
            bare, _ = split(ddl)
            if name not in existing:
                cursor.execute(bare)
            elif split(current(cursor, name))[0] != bare:
                raise RuntimeError("An existing Phase 14 table differs; no object replaced.")
        for name, ddl in expected.items():
            known = editor.connection.introspection.get_constraints(cursor, name)
            for clause in split(ddl)[1]:
                key = clause.split("`", 2)[1]
                if not known.get(key, {}).get("foreign_key"):
                    cursor.execute("ALTER TABLE `" + name + "` ADD " + clause)
            if current(cursor, name) != ddl:
                raise RuntimeError("Phase 14 table construction is incomplete or differs.")


def aftercare_tables(apps, editor):
    create_tables(editor, "orders_")


def payments_refund_tables(apps, editor):
    create_tables(editor, "payments_", {"payments_evidencebinding"})


def fulfilment_refund_tables(apps, editor):
    create_tables(editor, "fulfilment_", {"fulfilment_evidencebinding", "fulfilment_reviewcase"})


def notification_aftercare_tables(apps, editor):
    create_tables(editor, "notifications_", {"notifications_event", "notifications_notice", "notifications_preference"})


def stock_reduction_table(apps, editor):
    create_tables(editor, "inventory_allocationreduction")


def check_clause(cursor, table, name):
    cursor.execute(
        "SELECT CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME=%s AND CONSTRAINT_NAME=%s",
        [table, name],
    )
    row = cursor.fetchone()
    return row[0] if row else None


def reference_clause(version, table, name):
    return next((row[2] for row in schema.reference(version)["structure"]["checks"] if row[:2] == [table, name]), None)


class AddField(migrations.AddField):
    def database_forwards(self, app_label, editor, from_state, to_state):
        model = to_state.apps.get_model(app_label, self.model_name)
        name = model._meta.get_field(self.name).column
        table = model._meta.db_table
        expected = definitions()[table]
        with editor.connection.cursor() as cursor:
            found = column(current(cursor, table), name)
            target = column(expected, name)
            if found is None:
                # A NOT NULL boolean is populated with its literal default
                # first, then the database default is removed.
                defaults = {("notifications_preference", "aftercare_email"): "1"}
                default = defaults.get((table, name))
                if default is not None and "NOT NULL" in target:
                    cursor.execute("ALTER TABLE `" + table + "` ADD COLUMN " + target + " DEFAULT " + default)
                    cursor.execute("ALTER TABLE `" + table + "` ALTER COLUMN `" + name + "` DROP DEFAULT")
                else:
                    cursor.execute("ALTER TABLE `" + table + "` ADD COLUMN " + target)
            elif found != target:
                defaults = {("notifications_preference", "aftercare_email"): "1"}
                default = defaults.get((table, name))
                # Resume the exact reviewed add-with-default intermediate.
                if default is None or found != target + " DEFAULT " + default:
                    raise RuntimeError("Unknown additive aftercare column; no object replaced.")
                cursor.execute("ALTER TABLE `" + table + "` ALTER COLUMN `" + name + "` DROP DEFAULT")
            # A OneToOne column must acquire its reviewed unique index before
            # its FK; otherwise MariaDB invents a nonunique FK support index.
            known = editor.connection.introspection.get_constraints(cursor, table)
            for line in expected.splitlines():
                clause = line.strip().rstrip(",")
                if clause.startswith("UNIQUE KEY `") and "(`" + name + "`)" in clause:
                    key = clause.split("`", 2)[1]
                    if key not in known:
                        cursor.execute("ALTER TABLE `" + table + "` ADD " + clause)
                    elif not known[key].get("unique") or known[key].get("columns") != [name]:
                        raise RuntimeError("Unknown additive aftercare identity index.")
            known = editor.connection.introspection.get_constraints(cursor, table)
            for clause in split(expected)[1]:
                key = clause.split("`", 2)[1]
                if "FOREIGN KEY (`" + name + "`)" in clause and not known.get(key, {}).get("foreign_key"):
                    cursor.execute("ALTER TABLE `" + table + "` ADD " + clause)


class RemoveConstraint(migrations.RemoveConstraint):
    def database_forwards(self, app_label, editor, from_state, to_state):
        table = from_state.apps.get_model(app_label, self.model_name)._meta.db_table
        with editor.connection.cursor() as cursor:
            found = check_clause(cursor, table, self.name)
        if found is None or found == reference_clause(4, table, self.name):
            return
        if found != reference_clause(3, table, self.name):
            raise RuntimeError("Unknown predecessor aftercare constraint; removal refused.")
        return super().database_forwards(app_label, editor, from_state, to_state)


class AddConstraint(migrations.AddConstraint):
    def database_forwards(self, app_label, editor, from_state, to_state):
        table = to_state.apps.get_model(app_label, self.model_name)._meta.db_table
        with editor.connection.cursor() as cursor:
            found = check_clause(cursor, table, self.constraint.name)
        if found is None:
            return super().database_forwards(app_label, editor, from_state, to_state)
        if found != reference_clause(4, table, self.constraint.name):
            raise RuntimeError("Unknown successor aftercare constraint; publication refused.")
