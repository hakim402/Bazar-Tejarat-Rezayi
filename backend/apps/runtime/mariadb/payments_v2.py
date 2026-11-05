"""Explicit additive v1 -> v2 publication. Existing v1 bytes retain their meaning."""

import hashlib
import re
from django.utils import timezone
from . import schema
from .ddl import trigger, reject, same

UPGRADING = "phase12-upgrading-v2"
REPLACED = {
    "notifications_notice_update_guard",
    "notifications_notice_insert_guard",
    "notifications_event_insert_guard",
}
PROBE = "runtime_guardprobe_insert_guard"


def begin(apps, schema_editor):
    db = schema_editor.connection
    if db.vendor != "mysql":
        return
    Schema = apps.get_model("runtime", "Schema")
    row = Schema.objects.using(db.alias).get(pk=1)
    if row.contract == UPGRADING:
        return
    schema.verify(record=False, version=1)
    Schema.objects.using(db.alias).filter(pk=1).update(contract=UPGRADING, verified_at=timezone.now())


def notification_statements():
    result = []
    from apps.payments.mariadb_guards import published_event

    result.append(
        trigger(
            "notifications_notice",
            "UPDATE",
            reject(
                f"NOT ({same('id event_id account_id conversation_id order_id negotiation_id payment_order_id created_at')}) OR (OLD.read_at IS NOT NULL AND NOT (NEW.read_at <=> OLD.read_at))"
            ),
        )
    )
    invalid = """(NEW.payment_order_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM notifications_event e JOIN payments_event p ON p.id=e.payment_event_id WHERE e.id=NEW.event_id AND e.kind='payment' AND p.order_id=NEW.payment_order_id))
        OR (NEW.negotiation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM notifications_event e JOIN orders_negotiationevent r ON r.id=e.negotiation_event_id WHERE e.id=NEW.event_id AND r.request_id=NEW.negotiation_id AND e.kind='negotiation'))
        OR (NEW.order_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM notifications_event e WHERE e.id=NEW.event_id AND e.order_id=NEW.order_id AND e.kind='order_accepted'))
        OR (NEW.conversation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM notifications_event e WHERE e.id=NEW.event_id AND e.order_id IS NULL AND e.negotiation_event_id IS NULL AND e.payment_event_id IS NULL))"""
    result.append(trigger("notifications_notice", "INSERT", reject(invalid)))
    result.append(
        trigger(
            "notifications_event",
            "INSERT",
            reject(
                f"NEW.message_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM messaging_message m WHERE m.id=NEW.message_id AND m.published) OR NEW.payment_event_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM payments_event e JOIN payments_finance f ON f.order_id=e.order_id WHERE e.id=NEW.payment_event_id AND e.version<=f.version AND ({published_event('e.id', 'e.action')}))"
            ),
        )
    )
    return result


def additions():
    from .common import uuid_statements
    from apps.payments.mariadb_guards import statements

    original = set(schema.reference(1)["ddl"])
    return [s for s in uuid_statements(version=2) if s not in original] + statements() + notification_statements()


def apply_guards(cursor, *, expected=None):
    old = schema.reference(1)["triggers"]
    actual = schema.guard_inventory(cursor)
    for name, value in old.items():
        if name in REPLACED or name == PROBE:
            continue
        if actual.get(name) != value:
            raise RuntimeError("An unchanged v1 guard differs; upgrade refused.")
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
            if name not in REPLACED or actual[name] != old[name]:
                raise RuntimeError("Unexpected existing v2 guard; no object overwritten.")
            cursor.execute(f"DROP TRIGGER `{name}`")
        cursor.execute(statement)


def probe_statement(guards):
    values = {name: value for name, value in guards.items() if name != PROBE}
    signature = hashlib.sha256(
        "|".join(f"{name}:{value}" for name, value in sorted(values.items())).encode()
    ).hexdigest()
    body = f"""DECLARE actual_signature CHAR(64);
        SELECT SHA2(GROUP_CONCAT(CONCAT(TRIGGER_NAME,':',SHA2(ACTION_STATEMENT,256)) ORDER BY BINARY TRIGGER_NAME SEPARATOR '|'),256)
        INTO actual_signature FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME<>'{PROBE}';
        IF NOT (actual_signature <=> '{signature}') THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='bazar_guard_contract_changed'; END IF;
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='bazar_guard_contract_ready';"""
    return trigger("runtime_guardprobe", "INSERT", body)


def publish(apps, schema_editor):
    db = schema_editor.connection
    if db.vendor != "mysql":
        return
    Schema = apps.get_model("runtime", "Schema")
    row = Schema.objects.using(db.alias).get(pk=1)
    expected = schema.reference(2)
    if row.contract == schema.contract(2):
        schema.verify(record=False, version=2)
        return
    if row.contract != UPGRADING:
        raise RuntimeError("Explicit v1-to-v2 upgrade marker required.")
    with db.cursor() as cursor:
        apply_guards(cursor, expected=expected)
        actual = schema.guard_inventory(cursor)
        if actual.get(PROBE) not in {None, schema.reference(1)["triggers"][PROBE], expected["triggers"][PROBE]}:
            raise RuntimeError("Unexpected metadata probe; upgrade refused.")
        if actual.get(PROBE) != expected["triggers"][PROBE]:
            cursor.execute(f"DROP TRIGGER IF EXISTS `{PROBE}`")
            cursor.execute(probe_statement(expected["triggers"]))
        observed = {"triggers": schema.guard_inventory(cursor), "structure": schema.structural_inventory(cursor)}
        if observed != {"triggers": expected["triggers"], "structure": expected["structure"]}:
            raise RuntimeError("Native v2 DDL differs from reviewed contract; remains unready.")
    Schema.objects.using(db.alias).filter(pk=1).update(
        contract=schema.contract(2), guards=observed, verified_at=timezone.now()
    )
    schema.verify(record=False, version=2)
