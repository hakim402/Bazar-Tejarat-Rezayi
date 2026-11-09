"""Exact, resumable Phase 15 DDL; unknown existing definitions fail closed.

Version 1-4 construction and their stored references are unchanged. Only the
new v5 migration operations call this module. Publication is a separate step.
The reviewed column/index/constraint comparison logic is shared with v4 so a
later phase cannot silently relax an earlier graph's fail-closed behaviour.
"""

from django.db import migrations, models

from . import additive_v4
from .additive import column, current, split
from .additive_v4 import create_tables


def definitions():
    return additive_v4.definitions(5)


def dispute_tables(apps, editor):
    create_tables(editor, "orders_", version=5, label="Phase 15")


def payments_dispute_tables(apps, editor):
    create_tables(editor, "payments_", {"payments_evidencebinding"}, version=5, label="Phase 15")


def report_target_tables(apps, editor):
    create_tables(editor, "messaging_", {"messaging_report"}, version=5, label="Phase 15")


def notice_target_tables(apps, editor):
    create_tables(
        editor,
        "notifications_",
        {"notifications_event", "notifications_notice", "notifications_preference", "notifications_aftercareemail"},
        version=5,
        label="Phase 15",
    )


class AlterField(migrations.AlterField):
    def database_forwards(self, app_label, editor, from_state, to_state):
        model = to_state.apps.get_model(app_label, self.model_name)
        table = model._meta.db_table
        name = model._meta.get_field(self.name).column
        target = column(definitions()[table], name)
        predecessor = column(additive_v4.definitions(4)[table], name)
        with editor.connection.cursor() as cursor:
            found = column(current(cursor, table), name)
        if found != target:
            if found != predecessor:
                raise RuntimeError("Unknown predecessor dispute column; alteration refused.")
            # The reviewed v5 capture came from Django's own alteration sequence.
            super().database_forwards(app_label, editor, from_state, to_state)
        # An interrupted alteration may have dropped, but not re-added, its FK.
        with editor.connection.cursor() as cursor:
            known = editor.connection.introspection.get_constraints(cursor, table)
            for clause in split(definitions()[table])[1]:
                if "FOREIGN KEY (`" + name + "`)" in clause and not known.get(clause.split("`", 2)[1], {}).get("foreign_key"):
                    cursor.execute("ALTER TABLE `" + table + "` ADD " + clause)


class AddField(additive_v4.AddField):
    version = 5
    label = "dispute"
    defaults = {}


class RemoveConstraint(additive_v4.RemoveConstraint):
    version = 5
    label = "dispute"


class AddConstraint(additive_v4.AddConstraint):
    version = 5
    label = "dispute"

    def database_forwards(self, app_label, editor, from_state, to_state):
        if not isinstance(self.constraint, models.UniqueConstraint):
            return super().database_forwards(app_label, editor, from_state, to_state)
        table = to_state.apps.get_model(app_label, self.model_name)._meta.db_table
        prefix = "UNIQUE KEY `" + self.constraint.name + "` "
        target = next(line.strip().rstrip(",") for line in definitions()[table].splitlines() if line.strip().startswith(prefix))
        with editor.connection.cursor() as cursor:
            known = editor.connection.introspection.get_constraints(cursor, table)
            if self.constraint.name not in known:
                cursor.execute("ALTER TABLE `" + table + "` ADD " + target)
            if target not in [line.strip().rstrip(",") for line in current(cursor, table).splitlines()]:
                raise RuntimeError("Unknown successor dispute unique index; publication refused.")