"""Owned populated v2 upgrade/resumption and complete v3 private snapshot recovery.

Published Phase 12 source comes only from the local reviewed Git object. All
schemas, generated credentials, file copies and interruption probes belong to
this disposable run. Existing services/configuration are never used.
"""

import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import shutil
import tarfile

BASELINE = "8f1759c501da3e728db1558563aef571fd0468fc"


def baseline_source(run):
    from scripts.run_tests import ROOT

    target = run.runtime / "phase12-source"
    target.mkdir(mode=0o700)
    raw = subprocess.check_output(["git", "archive", "--format=tar", BASELINE], cwd=ROOT)
    with tarfile.open(fileobj=io.BytesIO(raw)) as archive:
        for member in archive:
            relative = Path(member.name)
            if relative.is_absolute() or ".." in relative.parts or member.issym() or member.islnk():
                raise RuntimeError("Unsafe reviewed baseline archive.")
            out = target / relative
            if member.isdir():
                out.mkdir(parents=True, exist_ok=True, mode=0o700)
            elif member.isfile():
                out.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                with os.fdopen(os.open(out, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as stream:
                    stream.write(archive.extractfile(member).read())
            else:
                raise RuntimeError("Unexpected baseline archive entry.")
    (target / "brand-kit").symlink_to((ROOT / "brand-kit").resolve(), target_is_directory=True)
    return target


def check(run):
    from scripts.run_tests import PYTHON
    from scripts.check_cross_engine_transfer import target_env, copy_private, file_hash, load

    if run.marker.get("engine") != "mariadb":
        raise RuntimeError("Fulfilment recovery requires the owned native MariaDB target.")
    source = baseline_source(run)
    private = run.runtime / "fulfilment-upgrade-private"
    private.mkdir(mode=0o700)
    env = target_env(run, "_legacy", private)
    run.command(
        [str(PYTHON), "-m", "scripts.prepare_browser_tests"],
        "populated-v2-fixtures",
        cwd=source / "backend",
        env={**env, "BROWSER_TEST_RUNTIME": "true"},
        data=json.dumps({"password": run.password, "phase": "phase-12-payments"}),
    )
    before = private / "v2-before"
    run.command(
        [str(PYTHON), "manage.py", "export_transfer", "--output", str(before), "--source-revision", BASELINE],
        "populated-v2-readonly-snapshot",
        cwd=source / "backend",
        env=env,
    )
    original_files = copy_private(private, run.runtime / "v2-file-reference")
    run.python(
        "manage.py",
        "migrate",
        "runtime",
        "0006_fulfilment_upgrade_begin",
        "--noinput",
        name="fulfilment-upgrade-begin",
        env=env,
    )
    partial = """import django;django.setup()
from django.db import connection
from config.testing import assert_owned_database
from apps.runtime.mariadb import schema, additive_v3
assert_owned_database(connection);assert not schema.ready()
with connection.cursor() as cursor:
 for name in ['fulfilment_state','fulfilment_event','inventory_stocktransition']:
  cursor.execute(additive_v3.split(additive_v3.definitions()[name])[0])
assert not schema.ready()
print('Known partial Phase 13 tables committed without migration completion; HTTP/jobs remain denied.')
raise SystemExit(19)
"""
    code, _ = run.python("-c", partial, name="fulfilment-deliberate-ddl-interruption", env=env, check=False)
    if code != 19:
        raise RuntimeError("The deliberate owned DDL interruption did not reach its boundary.")
    unknown = """import django;django.setup()
from django.db import connection
from apps.runtime.mariadb import schema,additive_v3
from config.testing import assert_owned_database
assert_owned_database(connection)
with connection.cursor() as cursor:
 cursor.execute('ALTER TABLE fulfilment_state ADD COLUMN owned_unexpected INT NULL')
 try:
  with connection.schema_editor(atomic=False) as editor:additive_v3.fulfilment_tables(None,editor)
 except RuntimeError:pass
 else:raise AssertionError('Unknown existing table was accepted')
 cursor.execute("SHOW COLUMNS FROM fulfilment_state LIKE %s",["owned_unexpected"]);assert cursor.fetchone()
 cursor.execute('ALTER TABLE fulfilment_state DROP COLUMN owned_unexpected')
assert not schema.ready()
print('Unknown owned construction was refused without overwrite; only the introduced probe column was removed.')
"""
    run.python("-c", unknown, name="fulfilment-unknown-table-refusal", env=env)
    run.python(
        "manage.py",
        "migrate",
        "notifications",
        "0004_remove_event_notifications_typed_event_and_more",
        "--noinput",
        name="fulfilment-resume-typed-columns",
        env=env,
    )
    run.python(
        "manage.py",
        "migrate",
        "inventory",
        "0003_stocktransition",
        "--noinput",
        name="fulfilment-resume-stock-witness",
        env=env,
    )
    guards = """import django;django.setup()
from django.db import connection
from config.testing import assert_owned_database
from apps.runtime.mariadb import schema,fulfilment_v3
assert_owned_database(connection);assert not schema.ready()
with connection.cursor() as cursor:
 statement=next(s for s in fulfilment_v3.additions() if s.startswith('CREATE TRIGGER'))
 cursor.execute(statement)
 wrong='fulfilment_event_delete_guard'
 cursor.execute("CREATE TRIGGER `"+wrong+"` BEFORE DELETE ON fulfilment_event FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Owned unknown probe'")
 previous=schema.guard_inventory(cursor)[wrong]
 try:fulfilment_v3.apply_guards(cursor,expected=schema.reference(3))
 except RuntimeError:pass
 else:raise AssertionError('Unknown guard was accepted')
 assert schema.guard_inventory(cursor)[wrong]==previous
 cursor.execute('DROP TRIGGER `'+wrong+'`')
assert not schema.ready()
print('Partial guards remain unready; unknown guard refused without replacement, introduced probe removed.')
"""
    run.python("-c", guards, name="fulfilment-partial-guard-refusal", env=env)
    run.python("manage.py", "migrate", "--noinput", name="fulfilment-resume-publication", env=env)
    compare = """import django;django.setup()
import json,sys
from pathlib import Path
from django.db import connection
from apps.runtime import transfer as t
from apps.runtime.mariadb import schema
schema.verify(record=False,version=3);assert schema.ready()
root=Path(sys.argv[1]);manifest=json.loads((root/'manifest.json').read_text());checked=0
for table,record in manifest['tables'].items():
 fields=record['columns'];names=[f['name'] for f in fields];key=names.index(record['primary'])
 for line in (root/(table+'.jsonl')).read_text().splitlines():
  row=json.loads(line)
  with connection.cursor() as cursor:
   cursor.execute('SELECT '+','.join(connection.ops.quote_name(n) for n in names)+' FROM '+connection.ops.quote_name(table)+' WHERE '+connection.ops.quote_name(record['primary'])+'=%s',[t.decode(row[key],fields[key]['kind'])]);actual=cursor.fetchone()
  assert actual is not None and [t.encode(v,f['kind'],'mysql') for v,f in zip(actual,fields,strict=True)]==row
  checked+=1
with connection.cursor() as cursor:
 cursor.execute('SELECT next_not_cached_value FROM orders_invoice_number');assert cursor.fetchone()[0]==manifest['invoice_next']
print('Every populated original v2 row and invoice sequence preserved:',checked)
"""
    run.python("-c", compare, str(before), name="fulfilment-populated-v2-continuity", env=env)
    if any(file_hash(private / name) != digest for name, digest in original_files.items()):
        raise RuntimeError("An original private file changed during upgrade.")
    run.python(
        "manage.py",
        "seed_fulfilment_examples",
        "--stdin",
        name="owned-fulfilment-recovery-fixtures",
        env={**env, "BROWSER_TEST_RUNTIME": "true"},
        data=json.dumps({"password": run.password}),
    )
    scenario = """import django;django.setup()
from django.utils import timezone
from datetime import timedelta
from apps.fulfilment.management.commands.seed_fulfilment_examples import example_delivery,command,review
from apps.orders.models import SellerOrder
from apps.accounts.models import User
from apps.messaging.management.commands.seed_messaging_examples import actor
from apps.fulfilment import models as m,queries,media
from apps.payments import services as goods
from apps.payments.models import Finance
from apps.marketplace.management.commands.seed_marketplace_examples import image_file
import uuid
value=example_delivery('cod',stage='delivered',charge='5.00');order=SellerOrder.objects.get(pk=value['id'])
buyer=actor(User.objects.get(email='phase12-buyer@example.test'),'buyer');seller=actor(User.objects.get(email='phase12-owner@example.test'),'seller');root=actor(User.objects.get(email='phase09-root@example.test'),'owner')
goods.mutate(seller,order.pk,'receipt',{'command_id':uuid.uuid4(),'version':Finance.objects.get(order=order).version,'amount':'12.50','currency':'AFN','paid_at':timezone.now()-timedelta(minutes=1),'description':'Synthetic recovered actual goods receipt'})
image=media.upload(buyer,order.pk,uuid.uuid4(),'claim',image_file())
command(order,buyer,'claim',charge=queries.current_charge(order).pk,amount='5.00',currency='AFN',paid_at=timezone.now()-timedelta(minutes=1),description='Synthetic recovered provider receipt',evidence=[image['id']])
review(m.ReviewCase.objects.get(order=order,kind='payment'),root)
assert m.Completion.objects.filter(order=order).count()==1
print('Populated private recipient, shipment, native stock proof, delivery money/evidence and completion created.')
"""
    run.python("-c", scenario, name="fulfilment-populated-private-history", env={**env, "BROWSER_TEST_RUNTIME": "true"})
    after = private / "v3-snapshot"
    revision = "manifest:" + hashlib.sha256(json.dumps(run.source_manifest(), sort_keys=True).encode()).hexdigest()
    run.python(
        "manage.py",
        "export_transfer",
        "--output",
        str(after),
        "--source-revision",
        revision,
        name="fulfilment-v3-readonly-snapshot",
        env=env,
    )
    recovered = run.runtime / "fulfilment-restored-private"
    files = copy_private(private, recovered)
    restore_input = recovered / "restore-input"
    shutil.copytree(after, restore_input)
    restore_env = target_env(run, "_restore", recovered)

    def missing_evidence():
        probe = """import django;django.setup()
from pathlib import Path
from django.conf import settings
from django.db import connection
from django.core.files.storage import storages
from config.testing import assert_owned_database
from apps.runtime.transfer import Importer,TransferError
from apps.runtime.mariadb import schema
import sys,json
assert_owned_database(connection)
source=Path(sys.argv[1]);manifest=sys.argv[2]
record=json.loads((source/'manifest.json').read_text())['delivery_evidence_files'][0]
path=Path(storages[record['storage_alias']].path(record['key']));saved=path.with_suffix('.owned-missing-probe')
assert path.is_file() and not saved.exists() and path.resolve().is_relative_to(Path(settings.DATA_ROOT).resolve())
path.rename(saved)
try:
 try:Importer(source,expected_digest=manifest).run()
 except TransferError:pass
 else:raise AssertionError('Missing private evidence was accepted')
 assert not schema.ready()
finally:saved.rename(path)
print('Missing delivery evidence blocked publication; original synthetic bytes restored for resumption.')
"""
        run.python(
            "-c",
            probe,
            str(restore_input),
            file_hash(restore_input / "manifest.json"),
            name="fulfilment-missing-private-evidence-denial",
            env=restore_env,
        )

    load(run, restore_input, restore_env, "fulfilment-v3-recovery", partial=True, before_resume=missing_evidence)
    if any(file_hash(recovered / name) != digest for name, digest in files.items()):
        raise RuntimeError("Recovered private file bytes differ.")
    # Prove old native v2 files are still supported, explicitly unready for the
    # current app until the additive upgrade is reviewed/applied in this target.
    older_private = run.runtime / "fulfilment-old-format-private"
    copy_private(run.runtime / "v2-file-reference", older_private)
    older_input = older_private / "restore-input"
    shutil.copytree(before, older_input)
    older_env = target_env(run, "_transfer", older_private)
    digest = file_hash(before / "manifest.json")
    run.python(
        "manage.py",
        "prepare_import_target",
        "--schema-version",
        "2",
        name="fulfilment-v2-recovery-target",
        env=older_env,
    )
    run.python(
        "manage.py",
        "import_transfer",
        "--input",
        str(older_input),
        "--expected-manifest",
        digest,
        name="fulfilment-v2-exact-recovery",
        env=older_env,
    )
    run.python(
        "-c",
        "import django;django.setup();from apps.runtime.mariadb import schema;schema.verify(record=False,version=2);assert not schema.ready();print('Historical v2 native recovery is exact and remains unready for the v3 app.')",
        name="fulfilment-v2-recovery-unready",
        env=older_env,
    )
    run.python("manage.py", "migrate", "--noinput", name="fulfilment-restored-v2-additive-upgrade", env=older_env)
    run.python("-c", compare, str(before), name="fulfilment-restored-v2-continuity", env=older_env)
    (run.evidence / "native-upgrade-recovery.json").write_text(
        json.dumps(
            {
                "source_baseline": BASELINE,
                "native_schema_version": 3,
                "populated_v2_upgrade": True,
                "known_prefix_resumption": True,
                "unknown_definitions_refused": True,
                "original_private_files": len(original_files),
                "recovered_private_files": len(files),
                "interrupted_v3_restore": True,
                "historical_v2_restore_and_upgrade": True,
                "existing_environment_changes": False,
            },
            indent=2,
        )
        + "\n"
    )


def owned_check(parent):
    from scripts.run_tests import TestRun
    from scripts.mariadb_testing import MariaDBInfrastructure

    class FulfilmentRun(MariaDBInfrastructure, TestRun):
        pass

    run = FulfilmentRun(backend_only=True, phase="phase-13-fulfilment", work_package="phase-13-fulfilment")
    status = "failed"
    try:
        (run.evidence / "source-manifest.json").write_text(json.dumps(run.source_manifest(), indent=2) + "\n")
        run.prepare()
        check(run)
        status = "passed"
    finally:
        run.cleanup()
        result = {
            "run_id": run.identifier,
            "status": status,
            "scope": "populated native v2 upgrade and complete v3 private recovery",
            "parent_run": parent.identifier,
        }
        (run.evidence / "result.json").write_text(json.dumps(result, indent=2) + "\n")
        (parent.evidence / "fulfilment-native-subrun.json").write_text(json.dumps(result, indent=2) + "\n")
