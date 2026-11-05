"""Exact, resumable Phase 13 DDL; unknown existing definitions fail closed.

Version 1/2 construction and their stored references are unchanged. Only the
new v3 migration operations call this module. Publication is a separate step.
"""

import json
from pathlib import Path
from django.db import migrations
from . import schema
from .additive import split, column, current


def definitions():
    return json.loads(Path(__file__).with_name("restore_v3.json").read_text())["tables"]


def create_tables(editor, prefix):
    if editor.connection.vendor != "mysql":
        raise RuntimeError("Phase 13 native construction requires MariaDB.")
    expected = {name: ddl for name, ddl in definitions().items() if name.startswith(prefix)}
    with editor.connection.cursor() as cursor:
        existing = set(editor.connection.introspection.table_names(cursor))
        for name, ddl in expected.items():
            bare, _ = split(ddl)
            if name not in existing:
                cursor.execute(bare)
            elif split(current(cursor, name))[0] != bare:
                raise RuntimeError("An existing Phase 13 table differs; no object replaced.")
        for name, ddl in expected.items():
            known = editor.connection.introspection.get_constraints(cursor, name)
            for clause in split(ddl)[1]:
                key = clause.split("`", 2)[1]
                if not known.get(key, {}).get("foreign_key"):
                    cursor.execute("ALTER TABLE `" + name + "` ADD " + clause)
            if current(cursor, name) != ddl:
                raise RuntimeError("Phase 13 table construction is incomplete or differs.")


def fulfilment_tables(apps, editor):
    create_tables(editor, "fulfilment_")


def stock_transition_table(apps, editor):
    create_tables(editor, "inventory_stocktransition")


def nullable_stock_account(apps, editor):
    with editor.connection.cursor() as cursor:
        table = "inventory_operation"
        before = column(
            json.loads(Path(__file__).with_name("restore_v2.json").read_text())["tables"][table], "account_id"
        )
        target = column(definitions()[table], "account_id")
        actual = column(current(cursor, table), "account_id")
        if actual == target:
            return
        if actual != before:
            raise RuntimeError("Unknown stock operation identity column; alteration refused.")
        cursor.execute("ALTER TABLE `inventory_operation` MODIFY COLUMN " + target)
        if column(current(cursor, table), "account_id") != target:
            raise RuntimeError("Stock identity alteration did not match its reviewed definition.")


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
                cursor.execute("ALTER TABLE `" + table + "` ADD COLUMN " + target)
            elif found != target:
                raise RuntimeError("Unknown additive delivery column; no object replaced.")
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
                        raise RuntimeError("Unknown additive delivery identity index.")
            known = editor.connection.introspection.get_constraints(cursor, table)
            for clause in split(expected)[1]:
                key = clause.split("`", 2)[1]
                if "FOREIGN KEY (`" + name + "`)" in clause and not known.get(key, {}).get("foreign_key"):
                    cursor.execute("ALTER TABLE `" + table + "` ADD " + clause)


def check_clause(cursor, table, name):
    cursor.execute(
        "SELECT CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME=%s AND CONSTRAINT_NAME=%s",
        [table, name],
    )
    row = cursor.fetchone()
    return row[0] if row else None


def reference_clause(version, table, name):
    return next((row[2] for row in schema.reference(version)["structure"]["checks"] if row[:2] == [table, name]), None)


class RemoveConstraint(migrations.RemoveConstraint):
    def database_forwards(self, app_label, editor, from_state, to_state):
        table = from_state.apps.get_model(app_label, self.model_name)._meta.db_table
        with editor.connection.cursor() as cursor:
            found = check_clause(cursor, table, self.name)
        if found is None or found == reference_clause(3, table, self.name):
            return
        if found != reference_clause(2, table, self.name):
            raise RuntimeError("Unknown predecessor notification constraint; removal refused.")
        return super().database_forwards(app_label, editor, from_state, to_state)


class AddConstraint(migrations.AddConstraint):
    def database_forwards(self, app_label, editor, from_state, to_state):
        table = to_state.apps.get_model(app_label, self.model_name)._meta.db_table
        with editor.connection.cursor() as cursor:
            found = check_clause(cursor, table, self.constraint.name)
        if found is None:
            return super().database_forwards(app_label, editor, from_state, to_state)
        if found != reference_clause(3, table, self.constraint.name):
            raise RuntimeError("Unknown successor notification constraint; publication refused.")
