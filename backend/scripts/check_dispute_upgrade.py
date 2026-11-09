"""Owned populated native v4 -> v5 upgrade and exact private recovery.

The predecessor is the committed v4 source, not current models under an old
schema. A separate staged v3 -> v4 check preserves that earlier continuity.
Every endpoint, credential, source archive and interruption belongs to this run.
"""

import hashlib
import json

from scripts.check_fulfilment_upgrade import (
    PHASE13_BASELINE,
    baseline_source,
    compare_snapshot,
    recover_private,
    seed_aftercare_history,
    seed_delivery_history,
)

PHASE14_BASELINE = "d4e2b4032b2df8a46f75bafe14e21a8337dba0bb"


def require_snapshot(path, version, tables):
    manifest = json.loads((path / "manifest.json").read_text())
    if manifest.get("format") != 3 or manifest.get("native_schema_version") != version:
        raise RuntimeError(f"The populated snapshot is not transport format 3 / native v{version}.")
    for table in tables:
        if not manifest["tables"].get(table, {}).get("count"):
            raise RuntimeError("Snapshot lacks required retained history: " + table)
    if not manifest["payment_evidence_files"] or not manifest["delivery_evidence_files"]:
        raise RuntimeError("Snapshot lacks required original private evidence.")
    if set(manifest["control_archive"]) != {
        "runtime_schema", "runtime_transfer", "runtime_scheduler", "django_migrations",
    }:
        raise RuntimeError("Snapshot lacks the native control archive.")
    return manifest


def unchanged_files(private, files):
    from scripts.check_cross_engine_transfer import file_hash

    if any(file_hash(private / name) != digest for name, digest in files.items()):
        raise RuntimeError("An original private file changed during the native upgrade.")


def export_old(run, source, env, private, version, revision):
    from scripts.run_tests import PYTHON

    target = private / f"v{version}-before"
    run.command(
        [str(PYTHON), "manage.py", "export_transfer", "--output", str(target), "--source-revision", revision],
        f"disputes-populated-v{version}-readonly-snapshot", cwd=source / "backend", env=env,
    )
    return target


def check_predecessor_continuity(run, v4_source):
    """Publish v4 explicitly before comparing, never migrate all the way to v5."""
    from scripts.run_tests import PYTHON
    from scripts.check_cross_engine_transfer import target_env, copy_private

    source = baseline_source(run, PHASE13_BASELINE, "disputes-phase13-source")
    private = run.runtime / "disputes-v3-continuity-private"
    private.mkdir(mode=0o700)
    env = target_env(run, "_transfer", private)
    run.command(
        [str(PYTHON), "-m", "scripts.prepare_browser_tests"], "disputes-populated-v3-fixtures",
        cwd=source / "backend", env={**env, "BROWSER_TEST_RUNTIME": "true"},
        data=json.dumps({"password": run.password, "phase": "phase-13-fulfilment"}),
    )
    seed_delivery_history(run, env, cwd=source / "backend", tag="disputes-v3-populated-delivery-history")
    before = export_old(run, source, env, private, 3, PHASE13_BASELINE)
    manifest = json.loads((before / "manifest.json").read_text())
    if manifest.get("format") != 3 or manifest.get("native_schema_version") != 3:
        raise RuntimeError("The staged predecessor snapshot must be native v3.")
    for table in ("fulfilment_completion", "fulfilment_evidencebinding", "inventory_stocktransition", "payments_receipt"):
        if not manifest["tables"][table]["count"]:
            raise RuntimeError("Predecessor lacks populated history: " + table)
    files = copy_private(private, run.runtime / "disputes-v3-file-reference")
    # Run the committed v4 installer. Current v5 application models must never
    # seed or export a still-v3/v4 target, nor publish v5 before this comparison.
    stage = """import django;django.setup()
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from config.testing import assert_owned_database
from apps.runtime.mariadb import schema
assert_owned_database(connection)
executor=MigrationExecutor(connection)
executor.migrate([('runtime','0009_aftercare_v4')])
schema.verify(record=False,version=4);assert schema.ready()
print('Populated v3 predecessor migrated only through committed native v4 publication.')
"""
    run.command(
        [str(PYTHON), "-c", stage], "disputes-staged-v3-to-v4-publication",
        cwd=v4_source / "backend", env=env,
    )
    compare_snapshot(
        run, before, env, version=4, tag="disputes-populated-v3-to-v4-continuity", require_ready=False,
    )
    unchanged_files(private, files)
    return len(files)


def check(run):
    from scripts.run_tests import BACKEND, PYTHON
    from scripts.check_cross_engine_transfer import target_env, copy_private

    if run.marker.get("engine") != "mariadb":
        raise RuntimeError("Dispute recovery requires the owned native MariaDB target.")
    source = baseline_source(run, PHASE14_BASELINE, "disputes-phase14-source")
    # Retained Phase 14 fixes/bytes are prerequisites, not objects this check may
    # republish or silently amend. Refuse a drifting predecessor reference.
    old_reference = json.loads((source / "backend/apps/runtime/mariadb/contract_v4.json").read_text())
    current_v4 = json.loads((BACKEND / "apps/runtime/mariadb/contract_v4.json").read_text())
    current_v5 = json.loads((BACKEND / "apps/runtime/mariadb/contract_v5.json").read_text())
    if old_reference != current_v4 or current_v5["ddl"][:len(old_reference["ddl"])] != old_reference["ddl"]:
        raise RuntimeError("The exact committed v4 contract/guard fixes must precede v5 unchanged.")

    predecessor_files = check_predecessor_continuity(run, source)
    private = run.runtime / "disputes-upgrade-private"
    private.mkdir(mode=0o700)
    env = target_env(run, "_legacy", private)
    run.command(
        [str(PYTHON), "-m", "scripts.prepare_browser_tests"], "disputes-populated-v4-fixtures",
        cwd=source / "backend", env={**env, "BROWSER_TEST_RUNTIME": "true"},
        data=json.dumps({"password": run.password, "phase": "phase-14-aftercare"}),
    )
    seed_delivery_history(run, env, cwd=source / "backend", tag="disputes-v4-populated-delivery-history")
    seed_aftercare_history(run, env, cwd=source / "backend")
    before = export_old(run, source, env, private, 4, PHASE14_BASELINE)
    require_snapshot(before, 4, (
        "fulfilment_completion", "fulfilment_evidencebinding", "inventory_stocktransition", "payments_receipt",
        "orders_cancellationdecision", "orders_amendmentdecision", "orders_invoiceadjustment",
        "payments_refundreport", "payments_refunddecision", "fulfilment_deliveryrefunddecision",
        "inventory_allocationreduction",
    ))
    original_files = copy_private(private, run.runtime / "disputes-v4-file-reference")
    run.python(
        "manage.py", "migrate", "runtime", "0010_disputes_upgrade_begin", "--noinput",
        name="disputes-upgrade-begin-verify-v4", env=env,
    )
    partial = """import django;django.setup()
from django.db import connection
from config.testing import assert_owned_database
from apps.runtime.models import Schema
from apps.runtime.mariadb import schema,additive_v5,disputes_v5
assert_owned_database(connection);assert not schema.ready()
assert Schema.objects.get(pk=1).contract==disputes_v5.UPGRADING
with connection.cursor() as cursor:
 for name in ['orders_disputerequest','orders_disputeresponse','orders_review']:
  cursor.execute(additive_v5.split(additive_v5.definitions()[name])[0])
assert not schema.ready()
print('Known native v5 table prefix committed without publication; readiness denied.')
raise SystemExit(19)
"""
    code, _ = run.python("-c", partial, name="disputes-deliberate-table-interruption", env=env, check=False)
    if code != 19:
        raise RuntimeError("The owned native v5 table interruption did not reach its boundary.")
    unknown = """import django;django.setup()
from django.db import connection
from config.testing import assert_owned_database
from apps.runtime.models import Schema
from apps.runtime.mariadb import schema,additive_v5
assert_owned_database(connection);assert not schema.ready()
with connection.cursor() as cursor:
 cursor.execute('ALTER TABLE orders_disputerequest ADD COLUMN owned_unexpected INT NULL')
 cursor.execute('SHOW CREATE TABLE orders_disputerequest');previous=cursor.fetchone()[1]
 guards=schema.guard_inventory(cursor);control=list(Schema.objects.values())
 try:
  try:
   with connection.schema_editor(atomic=False) as editor:additive_v5.dispute_tables(None,editor)
  except RuntimeError:pass
  else:raise AssertionError('Unknown native v5 table was accepted')
  cursor.execute('SHOW CREATE TABLE orders_disputerequest');assert cursor.fetchone()[1]==previous
  assert schema.guard_inventory(cursor)==guards and list(Schema.objects.values())==control
 finally:cursor.execute('ALTER TABLE orders_disputerequest DROP COLUMN owned_unexpected')
assert not schema.ready()
print('Unknown native v5 table refused unchanged; only the owned probe column removed.')
"""
    run.python("-c", unknown, name="disputes-unknown-table-refusal", env=env)
    dependencies = """import django;django.setup()
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.db.migrations.recorder import MigrationRecorder
from config.testing import assert_owned_database
from apps.runtime.mariadb import schema
assert_owned_database(connection);assert not schema.ready()
executor=MigrationExecutor(connection)
publication=executor.loader.get_migration('runtime','0011_disputes_v5')
executor.migrate(publication.dependencies)
assert not MigrationRecorder(connection).migration_qs.filter(app='runtime',name='0011_disputes_v5').exists()
assert not schema.ready()
print('Known domain-table prefix resumed; native v5 publication remains unapplied.')
"""
    run.python("-c", dependencies, name="disputes-resume-domain-tables", env=env)
    guards = """import django;django.setup()
from django.db import connection
from config.testing import assert_owned_database
from apps.runtime.mariadb import schema,aftercare_v4,disputes_v5
assert_owned_database(connection);assert not schema.ready()
with connection.cursor() as cursor:
 class InterruptedCursor:
  created=0
  def __getattr__(self,name):return getattr(cursor,name)
  def execute(self,statement,*args,**kwargs):
   result=cursor.execute(statement,*args,**kwargs)
   if statement.startswith('CREATE TRIGGER'):
    self.created+=1
    if self.created==3:
     assert not schema.ready()
     print('Known native v5 guard prefix committed; publication interrupted and readiness denied.')
     raise SystemExit(19)
   return result
 aftercare_v4.apply_guards(InterruptedCursor(),expected=schema.reference(5),version=5,
                          replaced=disputes_v5.REPLACED,delta=disputes_v5.additions())
raise AssertionError('Native v5 guard prefix interruption was not reached')
"""
    code, _ = run.python("-c", guards, name="disputes-deliberate-guard-interruption", env=env, check=False)
    if code != 19:
        raise RuntimeError("The owned native v5 guard interruption did not reach its boundary.")
    refusal = """import django;django.setup()
from django.db import connection
from config.testing import assert_owned_database
from apps.runtime.models import Schema
from apps.runtime.mariadb import schema,aftercare_v4,disputes_v5
assert_owned_database(connection);assert not schema.ready()
with connection.cursor() as cursor:
 statement=next(s for s in disputes_v5.additions() if s.startswith('CREATE TRIGGER')
                and ' BEFORE DELETE ON ' in s and s.split('`',2)[1] not in schema.reference(4)['triggers'])
 name=statement.split('`',2)[1]
 if name in schema.guard_inventory(cursor):cursor.execute('DROP TRIGGER `'+name+'`')
 cursor.execute(statement.split(' FOR EACH ROW ',1)[0]+" FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Owned unknown native v5 probe'")
 previous=schema.guard_inventory(cursor)[name];control=list(Schema.objects.values())
 try:
  try:aftercare_v4.apply_guards(cursor,expected=schema.reference(5),version=5,
                              replaced=disputes_v5.REPLACED,delta=disputes_v5.additions())
  except RuntimeError:pass
  else:raise AssertionError('Unknown native v5 guard was accepted')
  assert schema.guard_inventory(cursor)[name]==previous and list(Schema.objects.values())==control
 finally:
  cursor.execute('DROP TRIGGER `'+name+'`');cursor.execute(statement)
assert not schema.ready()
print('Unknown native v5 guard refused unchanged; only the introduced probe restored to reviewed bytes.')
"""
    run.python("-c", refusal, name="disputes-unknown-guard-refusal", env=env)
    run.python("manage.py", "migrate", "--noinput", name="disputes-resume-v5-publication", env=env)
    compare_snapshot(run, before, env, version=5, tag="disputes-populated-v4-to-v5-continuity")
    unchanged_files(private, original_files)
    run.python(
        "manage.py", "seed_dispute_examples", "--stdin", name="disputes-owned-v5-recovery-fixtures",
        env={**env, "BROWSER_TEST_RUNTIME": "true"}, data=json.dumps({"password": run.password}),
    )
    after = private / "v5-snapshot"
    revision = "manifest:" + hashlib.sha256(json.dumps(run.source_manifest(), sort_keys=True).encode()).hexdigest()
    run.python(
        "manage.py", "export_transfer", "--output", str(after), "--source-revision", revision,
        name="disputes-v5-readonly-snapshot", env=env,
    )
    manifest = require_snapshot(after, 5, (
        "orders_disputerequest", "orders_disputeresponse", "orders_disputedecision",
        "orders_review", "orders_reviewdecision", "orders_aftercareevent", "orders_aftercarecommand",
        "payments_refunddue", "payments_refundreport", "payments_refunddecision", "payments_evidencebinding",
        "messaging_report", "messaging_caseevent", "messaging_caseaccess",
        "fulfilment_blocker", "fulfilment_blockerclosure", "fulfilment_completion",
    ))
    # Disputes use payment evidence, not a new transport/file inventory. The
    # shared all-evidence recovery probe removes EVERY such file in turn,
    # including dispute-bound images and the independently confirmed refund.
    fixture = json.loads((private / "data/dispute-examples.json").read_text())
    evidence_ids = {row["id"] for row in manifest["payment_evidence_files"]}
    if not {row["evidence"] for row in fixture["disputes"].values()}.issubset(evidence_ids):
        raise RuntimeError("Native v5 snapshot omits private dispute evidence.")
    unchanged_files(private, original_files)
    files = recover_private(run, private, after, tag="disputes", version=5, all_evidence=True)
    (run.evidence / "native-upgrade-recovery.json").write_text(json.dumps({
        "source_baseline": PHASE14_BASELINE, "predecessor_baseline": PHASE13_BASELINE,
        "transport_format": 3, "native_schema_version": 5,
        "populated_v3_to_v4_staged_continuity": True, "populated_v4_to_v5_upgrade": True,
        "known_table_and_guard_prefix_resumption": True, "unknown_table_and_guard_definitions_refused": True,
        "original_application_and_control_rows_and_invoice_next": True,
        "retained_v4_contract_and_guard_fixes": True,
        "predecessor_private_files": predecessor_files, "original_private_files": len(original_files),
        "recovered_private_files": len(files), "interrupted_v5_restore": True,
        "all_payment_delivery_and_dispute_missing_evidence_denials": True,
        "exact_restored_application_and_archived_control_rows": True,
        "existing_environment_changes": False,
    }, indent=2) + "\n")


def owned_check(parent):
    from scripts.run_tests import TestRun
    from scripts.mariadb_testing import MariaDBInfrastructure

    class DisputeRun(MariaDBInfrastructure, TestRun):
        pass

    if parent.phase != "phase-15-disputes" or parent.marker.get("engine") != "mariadb":
        raise RuntimeError("Select the explicit owned MariaDB Phase 15 verification scope.")
    run = DisputeRun(backend_only=True, phase=parent.phase, work_package=parent.work_package or parent.phase)
    status = "failed"
    original = run.source_manifest()
    try:
        (run.evidence / "source-manifest.json").write_text(json.dumps(original, indent=2) + "\n")
        run.prepare()
        check(run)
        if run.source_manifest() != original:
            raise RuntimeError("Shared application source changed during the native verification.")
        status = "passed"
    finally:
        run.cleanup()
        result = {
            "run_id": run.identifier, "status": status,
            "scope": "populated staged v3-to-v4 and v4-to-v5 upgrades, exact native v5 private recovery",
            "phase": run.phase, "work_package": run.work_package, "parent_run": parent.identifier,
        }
        (run.evidence / "result.json").write_text(json.dumps(result, indent=2) + "\n")
        (parent.evidence / "disputes-native-subrun.json").write_text(json.dumps(result, indent=2) + "\n")
