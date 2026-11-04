"""Reviewed resumable operations for the never-deployed Phase12 successor.

Only these new operations use this helper. Original applied v1 bytes and its
installer retain their meaning. Unknown existing definitions always fail closed.
"""

import json
import re
from pathlib import Path
from django.db import migrations
from . import schema


def definitions():
    return json.loads(Path(__file__).with_name("restore_v2.json").read_text())["tables"]


def normalize(ddl):
    return re.sub(r" AUTO_INCREMENT=\d+", "", ddl)


def split(ddl):
    kept = []
    foreign = []
    for line in ddl.splitlines():
        if re.match(r"\s*CONSTRAINT `[^`]+` FOREIGN KEY", line):
            foreign.append(line.strip().rstrip(","))
        else:
            kept.append(line)
    for i in range(len(kept) - 1, 0, -1):
        if kept[i].startswith(")"):
            kept[i - 1] = kept[i - 1].rstrip(",")
            break
    return "\n".join(kept), foreign


def current(cursor, name):
    cursor.execute("SHOW CREATE TABLE `" + name + "`")
    return normalize(cursor.fetchone()[1])


def complete_foreign(cursor, name):
    _, foreign = split(definitions()[name])
    known = schema.connection.introspection.get_constraints(cursor, name)
    for clause in foreign:
        key = re.match(r"CONSTRAINT `([^`]+)`", clause)[1]
        if not known.get(key, {}).get("foreign_key"):
            cursor.execute("ALTER TABLE `" + name + "` ADD " + clause)


def payment_tables(apps, editor):
    expected = {name: ddl for name, ddl in definitions().items() if name.startswith("payments_")}
    if editor.connection.vendor != "mysql":
        raise RuntimeError("Native additive tables require MariaDB.")
    with editor.connection.cursor() as cursor:
        existing = set(editor.connection.introspection.table_names(cursor))
        for name, ddl in expected.items():
            bare, _ = split(ddl)
            if name not in existing:
                cursor.execute(bare)
            elif split(current(cursor, name))[0] != bare:
                raise RuntimeError("An existing payment table differs from its exact reviewed construction definition.")
        for name in expected:
            complete_foreign(cursor, name)
        for name, ddl in expected.items():
            if current(cursor, name) != ddl:
                raise RuntimeError("Payment construction is incomplete or differs; publication refused.")


def column(ddl, name):
    return next(
        (line.strip().rstrip(",") for line in ddl.splitlines() if line.lstrip().startswith("`" + name + "` ")), None
    )


class AddField(migrations.AddField):
    def database_forwards(self, app_label, editor, from_state, to_state):
        model = to_state.apps.get_model(app_label, self.model_name)
        field = model._meta.get_field(self.name)
        table = model._meta.db_table
        with editor.connection.cursor() as cursor:
            exists = column(current(cursor, table), field.column)
        if exists is None:
            return super().database_forwards(app_label, editor, from_state, to_state)
        expected = column(definitions()[table], field.column)
        if exists != expected:
            # Django adds a literal default to populate old rows, then removes
            # the database default. Resume only that exact known intermediate.
            defaults = {
                ("orders_orderpolicy", "reminder_hours"): "24",
                ("notifications_preference", "payment_email"): "1",
            }
            default = defaults.get((table, field.column))
            if default is None or exists.replace(" DEFAULT " + default, "") != expected:
                raise RuntimeError("An existing additive column differs; no data or definition replaced.")
            with editor.connection.cursor() as cursor:
                cursor.execute("ALTER TABLE `" + table + "` ALTER COLUMN `" + field.column + "` DROP DEFAULT")
        # A terminated schema-editor may not have executed its deferred FK.
        with editor.connection.cursor() as cursor:
            _, foreign = split(definitions()[table])
            known = editor.connection.introspection.get_constraints(cursor, table)
            for clause in foreign:
                if "FOREIGN KEY (`" + field.column + "`)" not in clause:
                    continue
                key = re.match(r"CONSTRAINT `([^`]+)`", clause)[1]
                if not known.get(key, {}).get("foreign_key"):
                    cursor.execute("ALTER TABLE `" + table + "` ADD " + clause)


class RemoveConstraint(migrations.RemoveConstraint):
    def database_forwards(self, app_label, editor, from_state, to_state):
        table = from_state.apps.get_model(app_label, self.model_name)._meta.db_table
        with editor.connection.cursor() as cursor:
            cursor.execute(
                "SELECT CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME=%s AND CONSTRAINT_NAME=%s",
                [table, self.name],
            )
            found = cursor.fetchone()
        if not found:
            return
        final = [row[2] for row in schema.reference(2)["structure"]["checks"] if row[:2] == [table, self.name]]
        old = [row[2] for row in schema.reference(1)["structure"]["checks"] if row[:2] == [table, self.name]]
        if final and found[0] == final[0]:
            return
        if not old or found[0] != old[0]:
            raise RuntimeError("Unexpected original constraint; removal refused.")
        return super().database_forwards(app_label, editor, from_state, to_state)


class AddConstraint(migrations.AddConstraint):
    def database_forwards(self, app_label, editor, from_state, to_state):
        table = to_state.apps.get_model(app_label, self.model_name)._meta.db_table
        with editor.connection.cursor() as cursor:
            cursor.execute(
                "SELECT CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME=%s AND CONSTRAINT_NAME=%s",
                [table, self.constraint.name],
            )
            found = cursor.fetchone()
        if not found:
            return super().database_forwards(app_label, editor, from_state, to_state)
        final = [
            row[2] for row in schema.reference(2)["structure"]["checks"] if row[:2] == [table, self.constraint.name]
        ]
        if not final or found[0] != final[0]:
            raise RuntimeError("Existing additive constraint differs; no replacement performed.")


class AddIndex(migrations.AddIndex):
    def database_forwards(self, app_label, editor, from_state, to_state):
        table = to_state.apps.get_model(app_label, self.model_name)._meta.db_table
        with editor.connection.cursor() as cursor:
            indexes = schema.structural_inventory(cursor)["indexes"]
        found = [row for row in indexes if row[:2] == [table, self.index.name]]
        if not found:
            return super().database_forwards(app_label, editor, from_state, to_state)
        expected = [row for row in schema.reference(2)["structure"]["indexes"] if row[:2] == [table, self.index.name]]
        if found != expected:
            raise RuntimeError("Existing additive index differs; no replacement performed.")
