"""Reviewed one-off re-publication of the two corrected Phase 14 aftercare guards.

The local preview database was upgraded to v4 before the notice-insert/email-scope guard
fixes. This tool refuses any unknown installed definition, captures rollback material
privately, then drops/recreates exactly the two corrected triggers plus the metadata probe
and refreshes the Schema contract row. Idempotent: an already-correct database only verifies.
"""

import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import django

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.development")
django.setup()

from django.conf import settings  # noqa: E402
from django.db import connection  # noqa: E402

from apps.notifications.mariadb_guards import aftercare_statements  # noqa: E402
from apps.runtime.mariadb import schema  # noqa: E402
from apps.runtime.mariadb.payments_v2 import PROBE, probe_statement  # noqa: E402
from apps.runtime.models import Schema  # noqa: E402

NOTICE = "notifications_notice_insert_guard"
SCOPE = "notifications_aftercareemail_insert_scope_guard"

NEW_NOTICE_CLAUSE = "OR (NEW.aftercare_order_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM notifications_event e WHERE e.id=NEW.event_id AND e.kind='aftercare' AND (EXISTS(SELECT 1 FROM orders_aftercareevent a WHERE a.id=e.aftercare_event_id AND a.order_id=NEW.aftercare_order_id) OR EXISTS(SELECT 1 FROM payments_event p WHERE p.id=e.payment_event_id AND p.order_id=NEW.aftercare_order_id) OR EXISTS(SELECT 1 FROM fulfilment_event f WHERE f.id=e.fulfilment_event_id AND f.order_id=NEW.aftercare_order_id))))"
OLD_NOTICE_CLAUSE = "OR (NEW.aftercare_order_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM notifications_event e JOIN orders_aftercareevent a ON a.id=e.aftercare_event_id WHERE e.id=NEW.event_id AND a.order_id=NEW.aftercare_order_id AND e.kind='aftercare'))"
NEW_BUNDLES = "JSON_CONTAINS(m.bundles,'\"orders_negotiation\"') OR JSON_CONTAINS(m.bundles,'\"payments_refunds\"')"
OLD_BUNDLES = "JSON_CONTAINS(m.bundles,'\"payments_refunds\"')"


def digest(statement):
    return hashlib.sha256(statement.split("FOR EACH ROW ", 1)[1].encode()).hexdigest()


def main():
    if settings.DATABASES["default"]["NAME"] != "bazar_local_preview_20261102":
        raise SystemExit("This tool only targets the local preview database.")
    expected = schema.reference(4)
    generated = {s.split("`", 2)[1]: s for s in aftercare_statements() if s.startswith("CREATE TRIGGER")}
    new_notice, new_scope = generated[NOTICE], generated[SCOPE]
    old_notice = new_notice.replace(NEW_NOTICE_CLAUSE, OLD_NOTICE_CLAUSE)
    old_scope = new_scope.replace(NEW_BUNDLES, OLD_BUNDLES)
    if old_notice == new_notice or old_scope == new_scope:
        raise SystemExit("Reviewed clause reversal did not apply; refusing.")
    old_triggers = dict(expected["triggers"])
    old_triggers[NOTICE], old_triggers[SCOPE] = digest(old_notice), digest(old_scope)
    old_triggers[PROBE] = digest(probe_statement(old_triggers))

    with connection.cursor() as cursor:
        installed = schema.guard_inventory(cursor)
        structure = schema.structural_inventory(cursor)
    row = Schema.objects.filter(pk=1).first()
    if row is None:
        raise SystemExit("No native contract row; refusing.")

    targets = {NOTICE, SCOPE, PROBE}
    if all(installed.get(n) == expected["triggers"][n] for n in targets):
        schema.verify(record=False, version=4)
        print("Already corrected; verification passed.")
        return
    for name in targets:
        if installed.get(name) != old_triggers[name]:
            raise SystemExit(f"Unknown installed definition for {name}; refusing.")
    for name, value in expected["triggers"].items():
        if name not in targets and installed.get(name) != value:
            raise SystemExit(f"Unrelated guard differs: {name}; refusing.")
    if structure != expected["structure"]:
        raise SystemExit("Structural inventory differs; refusing.")

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    evidence = Path(settings.BASE_DIR).parent / "doc/progress/phase-14-aftercare/evidence" / f"preview-guard-republication-{stamp}"
    evidence.mkdir(parents=True, exist_ok=False)
    rollback = {"schema_contract": row.contract, "triggers": {}}
    with connection.cursor() as cursor:
        for name in sorted(targets):
            cursor.execute(f"SHOW CREATE TRIGGER `{name}`")
            rollback["triggers"][name] = cursor.fetchone()[2]
    rollback_path = evidence / "rollback.json"
    rollback_path.write_text(json.dumps(rollback, indent=2))
    rollback_path.chmod(0o600)

    with connection.cursor() as cursor:
        for name in sorted(targets):
            cursor.execute(f"DROP TRIGGER `{name}`")
        for statement in (new_notice, new_scope, probe_statement(expected["triggers"])):
            cursor.execute(statement)
        observed = schema.guard_inventory(cursor)
        observed_structure = schema.structural_inventory(cursor)
    if observed != expected["triggers"] or observed_structure != expected["structure"]:
        raise SystemExit("Post-publication inventory differs; restore from rollback.json.")
    row.contract = schema.contract(4)
    row.guards = {"triggers": observed, "structure": observed_structure}
    row.verified_at = datetime.now(timezone.utc)
    row.save(update_fields=["contract", "guards", "verified_at"])
    schema.verify(record=False, version=4)
    print(f"Re-published two guards and probe; rollback captured at {rollback_path}")
    print("schema.ready():", schema.ready())


if __name__ == "__main__":
    main()