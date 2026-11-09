"""Owned populated v2/v3 upgrades and complete v3/v4 private snapshot recovery.

Published baseline source comes only from local reviewed Git objects. All
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
PHASE13_BASELINE = "39e05e26096f3f5943f77ae22bc4c660be9c6e82"


def baseline_source(run, revision=BASELINE, directory="phase12-source"):
    from scripts.run_tests import ROOT

    target = run.runtime / directory
    target.mkdir(mode=0o700)
    raw = subprocess.check_output(["git", "archive", "--format=tar", revision], cwd=ROOT)
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


def compare_snapshot(run, snapshot, env, *, version, tag, invoice_advance=0, exact=False, require_ready=True):
    code = """import django;django.setup()
import json,sys
from pathlib import Path
from django.db import connection
from config.testing import assert_owned_database
from apps.runtime import transfer as t
from apps.runtime.mariadb import schema
assert_owned_database(connection)
schema.verify(record=False,version=int(sys.argv[2]));assert schema.ready()==(sys.argv[5]=='ready')
root=Path(sys.argv[1]);manifest=json.loads((root/'manifest.json').read_text());checked=0
for table,record in manifest['tables'].items():
 fields=record['columns'];names=[f['name'] for f in fields];key=names.index(record['primary'])
 for line in (root/(table+'.jsonl')).read_text().splitlines():
  row=json.loads(line)
  with connection.cursor() as cursor:
   cursor.execute('SELECT '+','.join(connection.ops.quote_name(n) for n in names)+' FROM '+connection.ops.quote_name(table)+' WHERE '+connection.ops.quote_name(record['primary'])+'=%s',[t.decode(row[key],fields[key]['kind'])]);actual=cursor.fetchone()
  assert actual is not None and [t.encode(v,f['kind'],'mysql') for v,f in zip(actual,fields,strict=True)]==row,table
  checked+=1
 if sys.argv[4]=='exact':
  with connection.cursor() as cursor:
   cursor.execute('SELECT COUNT(*) FROM '+connection.ops.quote_name(table));assert cursor.fetchone()[0]==record['count'],table
# Native publication metadata intentionally changes during upgrade (and the
# restore integrity probe refreshes verification time); verify() above checks it.
# Retain every other archived original control row, including migration IDs/times.
if int(sys.argv[2])>=4:
 kinds=t.field_kinds()
 for table,record in manifest['control_archive'].items():
  if table=='runtime_schema':continue
  names=record['columns']
  with connection.cursor() as cursor:primary=connection.introspection.get_primary_key_column(cursor,table)
  key=names.index(primary)
  for row in record['rows']:
   with connection.cursor() as cursor:
    cursor.execute('SELECT '+','.join(connection.ops.quote_name(n) for n in names)+' FROM '+connection.ops.quote_name(table)+' WHERE '+connection.ops.quote_name(primary)+'=%s',[t.decode(row[key],kinds[table][primary])]);actual=cursor.fetchone()
   assert actual is not None and [t.encode(v,kinds[table][n],'mysql') for v,n in zip(actual,names,strict=True)]==row,table
with connection.cursor() as cursor:
 cursor.execute('SELECT next_not_cached_value FROM orders_invoice_number');assert cursor.fetchone()[0]==manifest['invoice_next']+int(sys.argv[3])
print('Every original application row and exact invoice sequence preserved:',checked)
"""
    run.python(
        "-c", code, str(snapshot), str(version), str(invoice_advance), "exact" if exact else "original",
        "ready" if require_ready else "unready", name=tag, env=env,
    )


def seed_delivery_history(run, env, *, cwd=None, tag="fulfilment-populated-private-history"):
    from scripts.run_tests import BACKEND, PYTHON

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
    run.command(
        [str(PYTHON), "-c", scenario], tag,
        cwd=cwd or BACKEND, env={**env, "BROWSER_TEST_RUNTIME": "true"},
    )


def recover_private(run, private, snapshot, *, tag, version, all_evidence=False):
    from scripts.check_cross_engine_transfer import target_env, copy_private, file_hash, load

    recovered = run.runtime / (tag + "-restored-private")
    files = copy_private(private, recovered)
    restore_input = recovered / "restore-input"
    shutil.copytree(snapshot, restore_input)
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
import sys,json,hashlib
assert_owned_database(connection)
source=Path(sys.argv[1]);manifest=sys.argv[2]
inventory=json.loads((source/'manifest.json').read_text())
if sys.argv[3]=='all':
 records=inventory['payment_evidence_files']+inventory['delivery_evidence_files']
 assert inventory['payment_evidence_files'] and inventory['delivery_evidence_files']
else:records=[inventory['delivery_evidence_files'][0]]
for record in records:
 path=Path(storages[record['storage_alias']].path(record['key']));saved=path.with_suffix('.owned-missing-probe')
 assert path.is_file() and not saved.exists() and path.resolve().is_relative_to(Path(settings.DATA_ROOT).resolve())
 assert hashlib.sha256(path.read_bytes()).hexdigest()==record['sha256']
 path.rename(saved)
 try:
  try:Importer(source,expected_digest=manifest).run()
  except TransferError as error:
   assert str(error) in {'A private payment evidence object is missing from recovery.','A private delivery evidence object is missing from recovery.'}
  else:raise AssertionError('Missing private evidence was accepted')
  assert not schema.ready()
 finally:saved.rename(path)
 assert hashlib.sha256(path.read_bytes()).hexdigest()==record['sha256']
print('Missing private evidence blocked publication; synthetic bytes restored for resumption:',len(records))
"""
        run.python(
            "-c", probe, str(restore_input), file_hash(restore_input / "manifest.json"),
            "all" if all_evidence else "delivery",
            name=tag + "-missing-private-evidence-denial", env=restore_env,
        )

    load(run, restore_input, restore_env, f"{tag}-v{version}-recovery", partial=True, before_resume=missing_evidence)
    if any(file_hash(recovered / name) != digest for name, digest in files.items()):
        raise RuntimeError("Recovered private file bytes differ.")
    if all_evidence:
        # load's numbering probe consumes exactly one value after publication.
        compare_snapshot(
            run, restore_input, restore_env, version=version, tag=tag + "-restored-row-continuity",
            invoice_advance=1, exact=True,
        )
    return files


def check(run):
    from scripts.run_tests import PYTHON
    from scripts.check_cross_engine_transfer import target_env, copy_private, file_hash

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
    compare_snapshot(run, before, env, version=3, tag="fulfilment-populated-v2-continuity")
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
    seed_delivery_history(run, env)
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
    files = recover_private(run, private, after, tag="fulfilment", version=3)
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
    compare_snapshot(run, before, older_env, version=3, tag="fulfilment-restored-v2-continuity")
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


def seed_aftercare_history(run, env, *, cwd=None):
    from scripts.run_tests import BACKEND, PYTHON

    scenario = """import django;django.setup()
import uuid
from datetime import timedelta
from django.db import connection
from django.test import override_settings
from django.utils import timezone
from config.testing import assert_owned_database
from apps.accounts.models import User
from apps.messaging.management.commands.seed_messaging_examples import actor
from apps.marketplace.management.commands.seed_marketplace_examples import image_file
from apps.orders.management.commands.seed_commerce_examples import example_aftercare_order,finance_version,aftercare_version
from apps.fulfilment.management.commands.seed_fulfilment_examples import example_delivery,command,review
from apps.orders import models as o,cancellations,amendments
from apps.payments import models as p,services as goods,refunds,media as goods_media,allocation
from apps.fulfilment import models as f,queries as delivery,media as delivery_media
from apps.inventory.models import AllocationReduction

@override_settings(OWNER_MFA_REQUIRED=False)
def seed():
 assert_owned_database(connection)
 buyer=actor(User.objects.get(email='phase12-buyer@example.test'),'buyer')
 seller=actor(User.objects.get(email='phase12-owner@example.test'),'seller')
 root=actor(User.objects.get(email='phase09-root@example.test'),'owner')
 def reserved():
  order=example_aftercare_order(buyer,'P12-FIXED','2.000')
  line=order.lines.get()
  goods.mutate(seller,order.pk,'plan',{'command_id':uuid.uuid4(),'version':finance_version(order),'intent_version':0,'reason':'Synthetic whole accepted selection','lines':[{'variant':str(line.variant_id),'batch':None,'quantity':'2.000'}]})
  goods.mutate(seller,order.pk,'receipt',{'command_id':uuid.uuid4(),'version':finance_version(order),'amount':format(order.goods_total,'.2f'),'currency':'AFN','paid_at':timezone.now()-timedelta(minutes=1),'description':'Synthetic actual advance funds'})
  allocation.execute(order.pk)
  assert p.AllocationIntent.objects.get(order=order).allocation.state=='held'
  return order
 def decide(service,row,version_field,action,financial=False,**extra):
  row.refresh_from_db()
  return service.decide(root,row.pk,{'command_id':uuid.uuid4(),'version':finance_version(row.order) if financial else aftercare_version(row.order),version_field:row.version,'action':action,'reason':'Independent synthetic recovery decision',**extra})
 def confirm_goods(order):
  due=p.RefundDue.objects.get(order=order)
  image=goods_media.upload(seller,order.pk,uuid.uuid4(),image_file())
  result=refunds.mutate(seller,order.pk,'report',{'command_id':uuid.uuid4(),'version':finance_version(order),'due':str(due.pk),'amount':format(due.amount,'.2f'),'sent_at':timezone.now()-timedelta(minutes=1),'reference':'SYNTHETIC-RECOVERY','description':'Synthetic actual goods refund','evidence':[image['id']]})
  decide(refunds,due,'due_version','assign',financial=True,assigned_to=root.user.pk)
  decide(refunds,due,'due_version','confirm',financial=True)
  assert p.RefundDecision.objects.filter(report_id=result['report'],action='confirmed').exists()
  assert p.EvidenceBinding.objects.filter(evidence_id=image['id'],report_id=result['report']).exists()
  return due
 cancelled=reserved()
 cancellations.mutate(buyer,cancelled.pk,'request',{'command_id':uuid.uuid4(),'version':aftercare_version(cancelled),'reason':'Synthetic recovery cancellation'})
 request=o.CancellationRequest.objects.get(order=cancelled)
 decide(cancellations,request,'request_version','assign',assigned_to=root.user.pk)
 decide(cancellations,request,'request_version','approve')
 assert p.AllocationIntent.objects.get(order=cancelled).allocation.state=='released'
 assert confirm_goods(cancelled).cause=='cancellation'
 assert o.InvoiceAdjustment.objects.filter(cancellation=request).exists()
 amended=reserved();line=amended.lines.get()
 amendments.mutate(seller,amended.pk,'propose',{'command_id':uuid.uuid4(),'version':aftercare_version(amended),'lines':[{'line':str(line.pk),'quantity':'1.000','unit_price':format(line.unit_price,'.2f')}],'reason':'Synthetic recovery quantity reduction'})
 amendment=o.Amendment.objects.get(order=amended)
 decide(amendments,amendment,'amendment_version','assign',assigned_to=root.user.pk)
 decide(amendments,amendment,'amendment_version','approve')
 assert AllocationReduction.objects.filter(allocation=p.AllocationIntent.objects.get(order=amended).allocation).exists()
 assert confirm_goods(amended).cause=='amendment'
 assert o.InvoiceAdjustment.objects.filter(amendment=amendment).exists()
 value=example_delivery('cod',stage='prepared',charge='5.00');order=o.SellerOrder.objects.get(pk=value['id'])
 charge=delivery.current_charge(order)
 command(order,buyer,'claim',charge=charge.pk,amount='5.00',currency='AFN',paid_at=timezone.now()-timedelta(minutes=1),description='Synthetic confirmed provider funds')
 review(f.ReviewCase.objects.get(order=order,kind='payment'),root)
 image=delivery_media.upload(seller,order.pk,uuid.uuid4(),'refund',image_file())
 result=command(order,seller,'refund',provider=charge.provider_id,amount='2.00',currency='AFN',sent_at=timezone.now()-timedelta(minutes=1),reference='SYNTHETIC-PROVIDER-REFUND',description='Synthetic actual provider refund',evidence=[image['id']])
 review(f.ReviewCase.objects.get(order=order,kind='refund'),root)
 assert f.DeliveryRefundDecision.objects.filter(refund_id=result['refund'],action='confirmed').exists()
 assert f.EvidenceBinding.objects.filter(evidence_id=image['id'],refund_id=result['refund']).exists()
 print('Actual cancellation, amendment, stock releases, invoice adjustments and independently confirmed goods/delivery refunds with bound private evidence created.')
seed()
"""
    run.command(
        [str(PYTHON), "-c", scenario], "aftercare-populated-private-history",
        cwd=cwd or BACKEND, env={**env, "BROWSER_TEST_RUNTIME": "true"},
    )


def check_aftercare(run):
    from scripts.run_tests import PYTHON
    from scripts.check_cross_engine_transfer import target_env, copy_private, file_hash

    if run.marker.get("engine") != "mariadb":
        raise RuntimeError("Aftercare recovery requires the owned native MariaDB target.")
    source = baseline_source(run, PHASE13_BASELINE, "phase13-source")
    private = run.runtime / "aftercare-upgrade-private"
    private.mkdir(mode=0o700)
    env = target_env(run, "_legacy", private)
    run.command(
        [str(PYTHON), "-m", "scripts.prepare_browser_tests"], "populated-v3-fixtures",
        cwd=source / "backend", env={**env, "BROWSER_TEST_RUNTIME": "true"},
        data=json.dumps({"password": run.password, "phase": "phase-13-fulfilment"}),
    )
    seed_delivery_history(run, env, cwd=source / "backend")
    before = private / "v3-before"
    run.command(
        [str(PYTHON), "manage.py", "export_transfer", "--output", str(before), "--source-revision", PHASE13_BASELINE],
        "populated-v3-readonly-snapshot", cwd=source / "backend", env=env,
    )
    baseline_manifest = json.loads((before / "manifest.json").read_text())
    if baseline_manifest.get("format") != 3 or baseline_manifest.get("native_schema_version") != 3:
        raise RuntimeError("The reviewed Phase 13 snapshot is not native v3.")
    for table in ("fulfilment_completion", "fulfilment_evidencebinding", "inventory_stocktransition", "payments_receipt"):
        if not baseline_manifest["tables"][table]["count"]:
            raise RuntimeError("The native v3 snapshot lacks required populated history: " + table)
    original_files = copy_private(private, run.runtime / "v3-file-reference")
    run.python(
        "manage.py", "migrate", "runtime", "0008_aftercare_upgrade_begin", "--noinput",
        name="aftercare-upgrade-begin", env=env,
    )
    partial = """import django;django.setup()
from django.db import connection
from config.testing import assert_owned_database
from apps.runtime.mariadb import schema,additive_v4
assert_owned_database(connection);assert not schema.ready()
with connection.cursor() as cursor:
 for name in ['orders_aftercare','orders_aftercareevent','inventory_allocationreduction']:
  cursor.execute(additive_v4.split(additive_v4.definitions()[name])[0])
assert not schema.ready()
print('Known Phase 14 table prefix committed without migration completion; readiness remains denied.')
raise SystemExit(19)
"""
    code, _ = run.python("-c", partial, name="aftercare-deliberate-ddl-interruption", env=env, check=False)
    if code != 19:
        raise RuntimeError("The owned Phase 14 DDL interruption did not reach its boundary.")
    unknown = """import django;django.setup()
from django.db import connection
from config.testing import assert_owned_database
from apps.runtime.mariadb import schema,additive_v4
assert_owned_database(connection)
with connection.cursor() as cursor:
 cursor.execute('ALTER TABLE orders_aftercare ADD COLUMN owned_unexpected INT NULL')
 try:
  try:
   with connection.schema_editor(atomic=False) as editor:additive_v4.aftercare_tables(None,editor)
  except RuntimeError:pass
  else:raise AssertionError('Unknown Phase 14 table was accepted')
  cursor.execute('SHOW COLUMNS FROM orders_aftercare LIKE %s',['owned_unexpected']);assert cursor.fetchone()
 finally:cursor.execute('ALTER TABLE orders_aftercare DROP COLUMN owned_unexpected')
assert not schema.ready()
print('Unknown Phase 14 table refused without overwrite; only the owned probe column removed.')
"""
    run.python("-c", unknown, name="aftercare-unknown-table-refusal", env=env)
    dependencies = """import django;django.setup()
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from config.testing import assert_owned_database
from apps.runtime.mariadb import schema
assert_owned_database(connection);assert not schema.ready()
executor=MigrationExecutor(connection)
publication=executor.loader.get_migration('runtime','0009_aftercare_v4')
executor.migrate(publication.dependencies)
assert not schema.ready()
print('Exact publication prerequisites resumed; v4 publication remains unapplied.')
"""
    run.python("-c", dependencies, name="aftercare-resume-additive-tables", env=env)
    guards = """import django;django.setup()
from django.db import connection
from config.testing import assert_owned_database
from apps.runtime.mariadb import schema,aftercare_v4
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
     print('Known Phase 14 guard prefix committed; publication interrupted and readiness denied.')
     raise SystemExit(19)
   return result
 aftercare_v4.apply_guards(InterruptedCursor(),expected=schema.reference(4))
raise AssertionError('Guard prefix interruption was not reached')
"""
    code, _ = run.python("-c", guards, name="aftercare-deliberate-guard-interruption", env=env, check=False)
    if code != 19:
        raise RuntimeError("The owned Phase 14 guard interruption did not reach its boundary.")
    refusal = """import django;django.setup()
from django.db import connection
from config.testing import assert_owned_database
from apps.runtime.mariadb import schema,aftercare_v4
assert_owned_database(connection);assert not schema.ready()
with connection.cursor() as cursor:
 statement=next(s for s in aftercare_v4.additions() if s.startswith('CREATE TRIGGER') and ' BEFORE DELETE ON ' in s and s.split('`',2)[1] not in schema.reference(3)['triggers'])
 name=statement.split('`',2)[1]
 if name in schema.guard_inventory(cursor):cursor.execute('DROP TRIGGER `'+name+'`')
 cursor.execute(statement.split(' FOR EACH ROW ',1)[0]+" FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Owned unknown Phase 14 probe'")
 previous=schema.guard_inventory(cursor)[name]
 try:
  try:aftercare_v4.apply_guards(cursor,expected=schema.reference(4))
  except RuntimeError:pass
  else:raise AssertionError('Unknown Phase 14 guard was accepted')
  assert schema.guard_inventory(cursor)[name]==previous
 finally:
  cursor.execute('DROP TRIGGER `'+name+'`')
  cursor.execute(statement)
assert not schema.ready()
print('Unknown Phase 14 guard refused unchanged; only the introduced probe restored to reviewed bytes.')
"""
    run.python("-c", refusal, name="aftercare-unknown-guard-refusal", env=env)
    run.python("manage.py", "migrate", "--noinput", name="aftercare-resume-publication", env=env)
    compare_snapshot(run, before, env, version=4, tag="aftercare-populated-v3-continuity")
    if any(file_hash(private / name) != digest for name, digest in original_files.items()):
        raise RuntimeError("An original private file changed during the Phase 14 upgrade.")
    seed_aftercare_history(run, env)
    after = private / "v4-snapshot"
    revision = "manifest:" + hashlib.sha256(json.dumps(run.source_manifest(), sort_keys=True).encode()).hexdigest()
    run.python(
        "manage.py", "export_transfer", "--output", str(after), "--source-revision", revision,
        name="aftercare-v4-readonly-snapshot", env=env,
    )
    manifest = json.loads((after / "manifest.json").read_text())
    if manifest.get("format") != 3 or manifest.get("native_schema_version") != 4:
        raise RuntimeError("The aftercare snapshot is not native v4.")
    for table in (
        "orders_cancellationdecision", "orders_amendmentdecision", "orders_invoiceadjustment",
        "payments_refundreport", "payments_refunddecision", "fulfilment_deliveryrefunddecision",
        "inventory_allocationreduction",
    ):
        if not manifest["tables"][table]["count"]:
            raise RuntimeError("The native v4 snapshot lacks required aftercare history: " + table)
    if any(file_hash(private / name) != digest for name, digest in original_files.items()):
        raise RuntimeError("An original private file changed while seeding aftercare history.")
    files = recover_private(run, private, after, tag="aftercare", version=4, all_evidence=True)
    (run.evidence / "native-upgrade-recovery.json").write_text(
        json.dumps({
            "source_baseline": PHASE13_BASELINE,
            "native_schema_version": 4,
            "populated_v3_upgrade": True,
            "known_table_and_guard_prefix_resumption": True,
            "unknown_table_and_guard_definitions_refused": True,
            "all_original_application_rows_and_invoice_sequence": True,
            "original_private_files": len(original_files),
            "recovered_private_files": len(files),
            "cancellation_amendment_goods_and_delivery_refund_history": True,
            "interrupted_v4_restore": True,
            "all_payment_and_delivery_missing_evidence_denials": True,
            "exact_restored_application_rows": True,
            "existing_environment_changes": False,
        }, indent=2) + "\n"
    )


def owned_check(parent):
    from scripts.run_tests import TestRun
    from scripts.mariadb_testing import MariaDBInfrastructure

    class FulfilmentRun(MariaDBInfrastructure, TestRun):
        pass

    if parent.phase not in {"phase-13-fulfilment", "phase-14-aftercare"}:
        raise RuntimeError("Select the explicit fulfilment or aftercare native verification scope.")
    aftercare = parent.phase == "phase-14-aftercare"
    run = FulfilmentRun(backend_only=True, phase=parent.phase, work_package=parent.work_package or parent.phase)
    status = "failed"
    try:
        (run.evidence / "source-manifest.json").write_text(json.dumps(run.source_manifest(), indent=2) + "\n")
        run.prepare()
        (check_aftercare if aftercare else check)(run)
        status = "passed"
    finally:
        run.cleanup()
        result = {
            "run_id": run.identifier,
            "status": status,
            "scope": (
                "populated native v3-to-v4 upgrade, aftercare history and complete v4 private recovery"
                if aftercare else "populated native v2 upgrade and complete v3 private recovery"
            ),
            "phase": run.phase,
            "work_package": run.work_package,
            "parent_run": parent.identifier,
        }
        (run.evidence / "result.json").write_text(json.dumps(result, indent=2) + "\n")
        receipt = "aftercare-native-subrun.json" if aftercare else "fulfilment-native-subrun.json"
        (parent.evidence / receipt).write_text(json.dumps(result, indent=2) + "\n")
