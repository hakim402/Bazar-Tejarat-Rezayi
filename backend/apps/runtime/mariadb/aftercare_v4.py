"""Explicit v3 -> v4 publication, retaining exact historical installer meanings."""

import re
from django.utils import timezone
from . import schema
from .payments_v2 import PROBE, probe_statement

UPGRADING = "phase14-upgrading-v4"
REPLACED = {
    "payments_event_insert_guard",
    "payments_command_insert_source_guard",
    "payments_command_insert_result_guard",
    "payments_evidencebinding_insert_guard",
    "payments_stockplanseal_insert_guard",
    "payments_reviewcase_insert_guard",
    "payments_caseevent_insert_guard",
    "payments_reminder_insert_guard",
    "fulfilment_event_insert_guard",
    "fulfilment_blocker_insert_source_guard",
    "fulfilment_blockerclosure_insert_guard",
    "fulfilment_publication_insert_guard",
    "fulfilment_shipment_insert_guard",
    "fulfilment_partialpermission_insert_guard",
    "fulfilment_completion_insert_guard",
    "fulfilment_reviewcase_insert_guard",
    "fulfilment_reviewcase_insert_target_guard",
    "fulfilment_caseevent_insert_guard",
    "fulfilment_evidence_insert_guard",
    "fulfilment_evidencebinding_insert_guard",
    "notifications_notice_update_guard",
    "notifications_notice_insert_guard",
    "notifications_event_insert_guard",
}


def begin(apps, editor, *, version=4, marker=UPGRADING):
    if editor.connection.vendor != "mysql":
        return
    State = apps.get_model("runtime", "Schema")
    row = State.objects.using(editor.connection.alias).get(pk=1)
    if row.contract == marker:
        return
    schema.verify(record=False, version=version - 1)
    State.objects.using(editor.connection.alias).filter(pk=1).update(contract=marker, verified_at=timezone.now())


def additions():
    from .common import uuid_statements
    from apps.orders.mariadb_guards import aftercare_statements
    from apps.payments.mariadb_guards import refund_statements
    from apps.fulfilment.mariadb_guards import refund_statements as delivery_refunds
    from apps.notifications.mariadb_guards import aftercare_statements as notice_guards

    old = set(schema.reference(3)["ddl"])
    statements = (
        list(uuid_statements(version=4))
        + aftercare_statements()
        + refund_statements()
        + delivery_refunds()
        + notice_guards()
    )
    # Applied history stores each statement once: an unchanged retained guard
    # already sits in the v3 bytes and is not re-issued.
    seen, delta = set(old), []
    for statement in statements:
        if statement not in seen:
            seen.add(statement)
            delta.append(statement)
    return delta


def apply_guards(cursor, *, expected=None, version=4, replaced=REPLACED, delta=None):
    original = schema.reference(version - 1)["triggers"]
    statements = additions() if delta is None else delta
    actual = schema.guard_inventory(cursor)
    for name, digest in original.items():
        if name == PROBE:
            continue
        allowed = {digest}
        if name in replaced:
            # A reviewed replacement can be absent after DROP, or already be
            # the exact target body after CREATE; neither permits an unknown body.
            allowed.add(None)
            if expected:
                allowed.add(expected["triggers"][name])
        if actual.get(name) not in allowed:
            raise RuntimeError(f"An existing v{version - 1}/v{version} guard differs; upgrade refused.")
    for statement in statements:
        match = re.match(r"CREATE TRIGGER `([^`]+)`", statement)
        if not match:
            cursor.execute(schema.resumable_statement(statement))
            continue
        name = match[1]
        actual = schema.guard_inventory(cursor)
        if name in actual:
            if expected and actual[name] == expected["triggers"].get(name):
                continue
            if name not in replaced or actual[name] != original.get(name):
                raise RuntimeError(f"Unexpected native v{version} guard; no object overwritten.")
            cursor.execute(f"DROP TRIGGER `{name}`")
        try:
            cursor.execute(statement)
        except Exception as error:
            raise RuntimeError("Native guard construction failed: " + name) from error


def publish(apps, editor, *, version=4, marker=UPGRADING, replaced=REPLACED, delta=None):
    if editor.connection.vendor != "mysql":
        return
    State = apps.get_model("runtime", "Schema")
    row = State.objects.using(editor.connection.alias).get(pk=1)
    expected = schema.reference(version)
    if row.contract == schema.contract(version):
        schema.verify(record=False, version=version)
        return
    if row.contract != marker:
        raise RuntimeError(f"Explicit v{version - 1}-to-v{version} upgrade marker is required.")
    with editor.connection.cursor() as cursor:
        apply_guards(cursor, expected=expected, version=version, replaced=replaced, delta=delta)
        actual = schema.guard_inventory(cursor)
        if actual.get(PROBE) not in {None, schema.reference(version - 1)["triggers"][PROBE], expected["triggers"][PROBE]}:
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
                f"Incomplete/unknown native v{version} DDL remains unready: " + json.dumps(differences, sort_keys=True)
            )
    State.objects.using(editor.connection.alias).filter(pk=1).update(
        contract=schema.contract(version), guards=observed, verified_at=timezone.now()
    )
    schema.verify(record=False, version=version)
