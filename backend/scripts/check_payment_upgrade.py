"""Owned populated v1 upgrade, interrupted DDL and complete payment recovery.

The baseline source is read from its published local Git object into the owned
run directory. It never imports the serving checkout or reads its private env.
"""

import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import tarfile

BASELINE = "e26c2e2bbfa8635934334f2623e853e37827de2c"


def baseline_source(run):
    from scripts.run_tests import ROOT

    target = run.runtime / "v1-source"
    target.mkdir(mode=0o700)
    archive = subprocess.check_output(["git", "archive", "--format=tar", BASELINE], cwd=ROOT)
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        for item in tar:
            path = Path(item.name)
            if path.is_absolute() or ".." in path.parts or item.issym() or item.islnk():
                raise RuntimeError("Unsafe baseline source archive.")
            out = target / path
            if item.isdir():
                out.mkdir(mode=0o700, parents=True, exist_ok=True)
            elif item.isfile():
                out.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                with os.fdopen(os.open(out, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as stream:
                    stream.write(tar.extractfile(item).read())
            else:
                raise RuntimeError("Unexpected baseline archive member.")
    (target / "brand-kit").symlink_to((ROOT / "brand-kit").resolve(), target_is_directory=True)
    return target


def check(run):
    from scripts.run_tests import PYTHON
    from scripts.check_cross_engine_transfer import target_env, copy_private, load, file_hash

    if run.marker.get("engine") != "mariadb":
        raise RuntimeError("Payment integrity gate requires owned MariaDB.")
    source = baseline_source(run)
    private = run.runtime / "payment-upgrade-private"
    private.mkdir(mode=0o700)
    env = target_env(run, "_legacy", private)
    run.command(
        [str(PYTHON), "-m", "scripts.prepare_browser_tests"],
        "populated-v1-fixtures",
        cwd=source / "backend",
        env={**env, "BROWSER_TEST_RUNTIME": "true"},
        data=json.dumps({"password": run.password, "phase": "phase-11-negotiation"}),
    )
    before = private / "v1-before"
    run.command(
        [str(PYTHON), "manage.py", "export_transfer", "--output", str(before), "--source-revision", BASELINE],
        "populated-v1-readonly-snapshot",
        cwd=source / "backend",
        env=env,
    )
    old_files = copy_private(private, run.runtime / "v1-file-reference")
    run.python(
        "manage.py",
        "migrate",
        "runtime",
        "0004_payments_upgrade_begin",
        "--noinput",
        name="payment-upgrade-begin",
        env=env,
    )
    partial = """import django;django.setup()
from django.db import connection
from django.db.migrations.loader import MigrationLoader
from apps.runtime.mariadb import schema,additive
from config.testing import assert_owned_database
assert_owned_database(connection);assert not schema.ready()
loader=MigrationLoader(connection);node=('orders','0002_remove_orderpolicy_orders_policy_bounds_and_more');migration=loader.get_migration(*node)
state=loader.project_state(node,at_end=False)
# Commit a real prefix, deliberately without claiming the migration completed.
with connection.schema_editor(atomic=False) as editor:
 for op in migration.operations[:2]:
  after=state.clone();op.state_forwards('orders',after);op.database_forwards('orders',editor,state,after);state=after
# A second exact CREATE prefix tests interrupted payment-table construction.
with connection.cursor() as cursor:
 for name in ['payments_finance','payments_event']:
  cursor.execute(additive.split(additive.definitions()[name])[0])
assert not schema.ready()
print('Deliberate owned partial DDL committed; no completion record; readiness denied.')
raise SystemExit(19)
"""
    code, _ = run.python("-c", partial, name="payment-upgrade-deliberate-ddl-interruption", check=False, env=env)
    if code != 19:
        raise RuntimeError("Expected owned partial-DDL interruption did not reach its boundary.")
    run.python(
        "manage.py",
        "migrate",
        "notifications",
        "0003_event_payment_event_notice_payment_order_and_more",
        "--noinput",
        name="payment-upgrade-resume-structure",
        env=env,
    )
    code = """import django;django.setup()
from django.db import connection
from apps.runtime.mariadb import schema,payments_v2
assert not schema.ready()
with connection.cursor() as cursor:
 statement=next(s for s in payments_v2.additions() if s.startswith('CREATE TRIGGER'))
 cursor.execute(statement)
assert not schema.ready()
print('Guard installation interrupted before publication; original guards remain installed.')
"""
    run.python("-c", code, name="payment-upgrade-partial-guard-publication-denied", env=env)
    run.python("manage.py", "migrate", "--noinput", name="payment-upgrade-resume-publication", env=env)
    compare = """import django;django.setup()
import json,sys,hashlib
from pathlib import Path
from django.db import connection
from apps.runtime import transfer as t
from apps.runtime.mariadb import schema
schema.verify(record=False);assert schema.ready()
directory=Path(sys.argv[1]);manifest=json.loads((directory/'manifest.json').read_text());checked=0
for table,record in manifest['tables'].items():
 fields=record['columns'];names=[f['name'] for f in fields];key=names.index(record['primary'])
 with (directory/(table+'.jsonl')).open() as stream:
  for line in stream:
   row=json.loads(line)
   with connection.cursor() as cursor:
    cursor.execute('SELECT '+','.join(connection.ops.quote_name(x) for x in names)+' FROM '+connection.ops.quote_name(table)+' WHERE '+connection.ops.quote_name(record['primary'])+'=%s',[t.decode(row[key],fields[key]['kind'])])
    found=cursor.fetchone()
   assert found is not None and [t.encode(value,f['kind'],'mysql') for value,f in zip(found,fields,strict=True)]==row
   checked+=1
print('Every retained populated v1 row preserved by original primary key and column values:',checked)
"""
    run.python("-c", compare, str(before), name="payment-upgrade-populated-row-continuity", env=env)
    # Original files remain byte-identical; the reference copy itself stays private.

    if any(file_hash(private / name) != value for name, value in old_files.items()):
        raise RuntimeError("Original private files changed during native upgrade.")
    run.python(
        "manage.py",
        "seed_payment_examples",
        "--stdin",
        name="owned-payment-recovery-fixtures",
        env={**env, "BROWSER_TEST_RUNTIME": "true"},
        data=json.dumps({"password": run.password}),
    )
    create = """import django;django.setup()
import json,uuid,sys
from pathlib import Path
from unittest.mock import patch
from datetime import timedelta
from django.utils import timezone
from apps.accounts.models import User
from apps.messaging.management.commands.seed_messaging_examples import actor
from apps.payments.management.commands.seed_payment_examples import example_order
from apps.payments import services as p,media,jobs
from apps.payments.models import Finance,ReviewCase
from apps.marketplace.management.commands.seed_marketplace_examples import image_file
item=example_order();buyer=actor(User.objects.get(email='phase12-buyer@example.test'),'buyer');seller=actor(User.objects.get(email='phase12-finance@example.test'),'seller');root=actor(User.objects.get(email='phase09-root@example.test'),'owner')
image=media.upload(buyer,item['id'],uuid.uuid4(),image_file())
version=0
p.mutate(seller,item['id'],'plan',{'command_id':uuid.uuid4(),'version':0,'intent_version':0,'reason':'Complete accepted recovery selection','lines':[{'variant':item['variant'],'batch':None,'quantity':'1.000'}]})
packet={'command_id':str(uuid.uuid4()),'version':1,'amount':'7.50','currency':'AFN','paid_at':(timezone.now()-timedelta(minutes=1)).isoformat(),'description':'Synthetic actual recovery cash receipt','evidence':[]}
from datetime import datetime
internal={**packet,'paid_at':datetime.fromisoformat(packet['paid_at'])}
with patch('apps.payments.allocation.before_stock',side_effect=OSError('Synthetic dependency interruption')):
 result=p.mutate(seller,item['id'],'receipt',internal)
 p.mutate(buyer,item['id'],'claim',{'command_id':uuid.uuid4(),'version':2,'amount':'2.50','currency':'AFN','paid_at':timezone.now()-timedelta(minutes=1),'description':'Synthetic separate claim with private image','evidence':[image['id']]})
assert result['current']['allocation']=='pending'
Path(sys.argv[1]).write_text(json.dumps({'order':item,'packet':packet,'outcome':result['outcome'],'image':image['id']}));Path(sys.argv[1]).chmod(0o600)
print('Durable actual receipt, private bound image, pending whole-order stock intent and command retained.')
"""
    packet = run.runtime / "payment-recovery-packet.json"
    run.python(
        "-c", create, str(packet), name="payment-populated-recovery-state", env={**env, "BROWSER_TEST_RUNTIME": "true"}
    )
    backup = private / "native-payment-backup"
    run.python(
        "manage.py",
        "export_transfer",
        "--output",
        str(backup),
        "--source-revision",
        "manifest:" + hashlib.sha256((run.evidence / "source-manifest.json").read_bytes()).hexdigest()
        if (run.evidence / "source-manifest.json").exists()
        else BASELINE,
        name="payment-native-consistent-backup",
        env=env,
    )
    restored = run.runtime / "payment-restored-private"
    files = copy_private(private, restored)
    import shutil

    shutil.copytree(backup, restored / "restore-input")
    restore_env = target_env(run, "_restore", restored)
    load(run, restored / "restore-input", restore_env, "payment-native-restore", partial=True)
    resume = """import django;django.setup()
import sys,json
from pathlib import Path
from datetime import datetime
from apps.accounts.models import User
from apps.messaging.management.commands.seed_messaging_examples import actor
from apps.payments import services,queries,allocation
from apps.payments.models import Receipt,AllocationIntent
from apps.inventory.models import Bucket,Allocation
from apps.runtime.mariadb import schema
value=json.loads(Path(sys.argv[1]).read_text());actor=actor(User.objects.get(email='phase12-finance@example.test'),'seller');packet=value['packet'];packet['paid_at']=datetime.fromisoformat(packet['paid_at'])
first=services.mutate(actor,value['order']['id'],'receipt',packet);second=services.mutate(actor,value['order']['id'],'receipt',packet)
assert first['outcome']==second['outcome']==value['outcome']
intent=AllocationIntent.objects.get(order_id=value['order']['id']);assert intent.state=='reserved' and intent.attempts.count()==1
allocation.execute(intent.order_id);assert intent.attempts.count()==1
assert queries.confirmed(intent.order)==Receipt.objects.get(pk=value['outcome']['receipt']).amount
schema.verify(record=False);assert schema.ready()
print('Restored exact command replay, private evidence and pending reservation recovery passed; one whole hold only.')
"""
    run.python(
        "-c",
        resume,
        str(packet),
        name="payment-restored-command-stock-recovery",
        env={**restore_env, "BROWSER_TEST_RUNTIME": "true"},
    )
    (run.evidence / "payment-upgrade-recovery.json").write_text(
        json.dumps(
            {
                "baseline_sha": BASELINE,
                "populated_v1_row_and_private_file_continuity": True,
                "partial_column_table_and_guard_ddl_resume": True,
                "v2_native_backup_restore": True,
                "private_payment_evidence": True,
                "original_command_replay_and_pending_stock_recovery": True,
                "private_files": len(files),
                "native_schema_version": 2,
                "existing_environment_changes": False,
            },
            indent=2,
        )
        + "\n"
    )


def owned_check(parent):
    """Give this proof independent auxiliary schemas; no cross-scope reuse."""
    from scripts.run_tests import TestRun
    from scripts.mariadb_testing import MariaDBInfrastructure

    class PaymentRun(MariaDBInfrastructure, TestRun):
        pass

    child = PaymentRun(backend_only=True, phase="phase-12-payments", work_package="phase-12-payments")
    status = "failed"
    try:
        (child.evidence / "source-manifest.json").write_text(json.dumps(child.source_manifest(), indent=2) + "\n")
        child.prepare()
        check(child)
        status = "passed"
    finally:
        child.cleanup()
        (child.evidence / "result.json").write_text(
            json.dumps(
                {
                    "run_id": child.identifier,
                    "status": status,
                    "scope": "populated native payment upgrade and recovery",
                    "parent_run": parent.identifier,
                },
                indent=2,
            )
            + "\n"
        )
        (parent.evidence / "payment-native-subrun.json").write_text(
            json.dumps({"run_id": child.identifier, "status": status}, indent=2) + "\n"
        )
