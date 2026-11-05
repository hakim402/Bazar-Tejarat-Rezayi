"""Explicit v2 -> v3 publication, retaining exact historical installer meanings."""

import re
from django.utils import timezone
from . import schema
from .ddl import trigger, reject
from .payments_v2 import PROBE, probe_statement

UPGRADING = "phase13-upgrading-v3"
REPLACED = {
    "notifications_notice_update_guard",
    "notifications_notice_insert_guard",
    "notifications_event_insert_guard",
}


def begin(apps, editor):
    if editor.connection.vendor != "mysql":
        return
    State = apps.get_model("runtime", "Schema")
    row = State.objects.using(editor.connection.alias).get(pk=1)
    if row.contract == UPGRADING:
        return
    schema.verify(record=False, version=2)
    State.objects.using(editor.connection.alias).filter(pk=1).update(contract=UPGRADING, verified_at=timezone.now())


def notification_statements():
    from .payments_v2 import notification_statements as old_statements

    old = old_statements()
    result = []
    for statement in old:
        if statement.startswith("CREATE TRIGGER `notifications_notice_update_guard`"):
            statement = statement.replace(
                "OLD.`payment_order_id` <=> NEW.`payment_order_id`",
                "OLD.`payment_order_id` <=> NEW.`payment_order_id`) AND (OLD.`fulfilment_order_id` <=> NEW.`fulfilment_order_id`",
            )
        elif statement.startswith("CREATE TRIGGER `notifications_notice_insert_guard`"):
            statement = trigger(
                "notifications_notice",
                "INSERT",
                reject(
                    "NEW.fulfilment_order_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM notifications_event e JOIN fulfilment_event f ON f.id=e.fulfilment_event_id JOIN fulfilment_publication pub ON pub.event_id=f.id WHERE e.id=NEW.event_id AND e.kind='fulfilment' AND f.order_id=NEW.fulfilment_order_id) OR NEW.fulfilment_order_id IS NULL AND EXISTS(SELECT 1 FROM notifications_event e WHERE e.id=NEW.event_id AND e.kind='fulfilment')"
                ),
            )
            # Keep the original typed old-resource scope checks as a separate guard.
            old_body = old[1].split("FOR EACH ROW BEGIN ", 1)[1].rsplit(" END", 1)[0]
            result.append(trigger("notifications_notice", "INSERT", old_body, suffix="old_scope_guard"))
        else:
            prefix = statement.rsplit(" END", 1)[0]
            statement = (
                prefix
                + " "
                + reject(
                    "NEW.fulfilment_event_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM fulfilment_event e JOIN fulfilment_publication p ON p.event_id=e.id WHERE e.id=NEW.fulfilment_event_id)"
                )
                + " END"
            )
        result.append(statement)
    return result


def additions():
    from .common import uuid_statements
    from apps.fulfilment.mariadb_guards import statements

    old = set(schema.reference(2)["ddl"])
    return [s for s in uuid_statements(version=3) if s not in old] + statements() + notification_statements()


def apply_guards(cursor, *, expected=None):
    original = schema.reference(2)["triggers"]
    actual = schema.guard_inventory(cursor)
    for name, digest in original.items():
        if name not in REPLACED | {PROBE} and actual.get(name) != digest:
            raise RuntimeError("An unchanged v2 guard differs; upgrade refused.")
    for statement in additions():
        match = re.match(r"CREATE TRIGGER `([^`]+)`", statement)
        if not match:
            cursor.execute(schema.resumable_statement(statement))
            continue
        name = match[1]
        actual = schema.guard_inventory(cursor)
        if name in actual:
            if expected and actual[name] == expected["triggers"].get(name):
                continue
            if name not in REPLACED or actual[name] != original[name]:
                raise RuntimeError("Unexpected native v3 guard; no object overwritten.")
            cursor.execute(f"DROP TRIGGER `{name}`")
        try:
            cursor.execute(statement)
        except Exception as error:
            raise RuntimeError("Native guard construction failed: " + name) from error


def publish(apps, editor):
    if editor.connection.vendor != "mysql":
        return
    State = apps.get_model("runtime", "Schema")
    row = State.objects.using(editor.connection.alias).get(pk=1)
    expected = schema.reference(3)
    if row.contract == schema.contract(3):
        schema.verify(record=False, version=3)
        return
    if row.contract != UPGRADING:
        raise RuntimeError("Explicit v2-to-v3 upgrade marker is required.")
    with editor.connection.cursor() as cursor:
        apply_guards(cursor, expected=expected)
        actual = schema.guard_inventory(cursor)
        if actual.get(PROBE) not in {None, schema.reference(2)["triggers"][PROBE], expected["triggers"][PROBE]}:
            raise RuntimeError("Unexpected native metadata probe.")
        if actual.get(PROBE) != expected["triggers"][PROBE]:
            cursor.execute(f"DROP TRIGGER IF EXISTS `{PROBE}`")
            cursor.execute(probe_statement(expected["triggers"]))
        observed = {"triggers": schema.guard_inventory(cursor), "structure": schema.structural_inventory(cursor)}
        if observed != {"triggers": expected["triggers"], "structure": expected["structure"]}:
            import json

            differences = {}
            for group in expected["structure"]:
                actual_rows = {json.dumps(x, sort_keys=True) for x in observed["structure"][group]}
                wanted_rows = {json.dumps(x, sort_keys=True) for x in expected["structure"][group]}
                if actual_rows != wanted_rows:
                    differences[group] = {
                        "missing": sorted(wanted_rows - actual_rows)[:8],
                        "unexpected": sorted(actual_rows - wanted_rows)[:8],
                    }
            differences["guards"] = [
                name
                for name in set(expected["triggers"]) | set(observed["triggers"])
                if observed["triggers"].get(name) != expected["triggers"].get(name)
            ]
            raise RuntimeError(
                "Incomplete/unknown native v3 DDL remains unready: " + json.dumps(differences, sort_keys=True)
            )
    State.objects.using(editor.connection.alias).filter(pk=1).update(
        contract=schema.contract(3), guards=observed, verified_at=timezone.now()
    )
    schema.verify(record=False, version=3)
