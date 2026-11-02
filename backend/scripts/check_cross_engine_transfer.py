"""Owned populated PostgreSQL→MariaDB transfer and native logical restore proof."""
import hashlib
import json
import os
import shutil


def file_hash(path):
    value=hashlib.sha256()
    with path.open('rb') as stream:
        while block:=stream.read(1024*1024):
            value.update(block)
    return value.hexdigest()


def copy_private(source, target):
    target.mkdir(mode=0o700)
    result={}
    for folder in ('data','site-public'):
        root=source/folder
        if not root.exists():
            continue
        for path in sorted(root.rglob('*')):
            if path.is_symlink():
                raise RuntimeError('Private copy refuses symlinks.')
            relative=path.relative_to(source)
            destination=target/relative
            if path.is_dir():
                destination.mkdir(mode=0o700,parents=True,exist_ok=True)
            elif path.is_file():
                destination.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
                with path.open('rb') as inp, os.fdopen(os.open(destination,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'wb') as out:
                    shutil.copyfileobj(inp,out)
                result[str(relative)]=file_hash(path)
                if file_hash(destination)!=result[str(relative)]:
                    raise RuntimeError('Private file transfer checksum differs.')
    return result


def target_env(run, suffix, private_root):
    name=run.marker['database']+suffix
    if name not in run.marker['auxiliary_databases']:
        raise RuntimeError('Target was not allocated by this disposable run.')
    url=run.env['REZAYI_TEST_DATABASE_URL'].replace('/'+run.marker['database']+'?', '/'+name+'?')
    return {**run.env,'REZAYI_TEST_DATABASE_URL':url,'REZAYI_TEST_STORAGE_ROOT':str(private_root),'BROWSER_TEST_RUNTIME':'false'}


def load(run, directory, env, tag, *, partial=False):
    digest=file_hash(directory/'manifest.json')
    run.python('manage.py','prepare_import_target',name=tag+'-prepare',env=env)
    if partial:
        code='''import django;django.setup()
from config.testing import assert_owned_database
from django.db import connection
assert_owned_database(connection)
from apps.runtime.transfer import Importer
from apps.runtime.mariadb.schema import ready
import sys
value=Importer(sys.argv[1],expected_digest=sys.argv[2]).run(stop_after=12)
assert value['state']=='loading' and not ready()
print('Committed partial transfer retained; HTTP/jobs remain unavailable.')
'''
        run.python('-c',code,str(directory),digest,name=tag+'-interrupted-load',env=env)
    run.python('manage.py','import_transfer','--input',str(directory),'--expected-manifest',digest,name=tag+'-resume-complete',env=env)
    # A repeat cannot overwrite a ready app, even with the original exact files.
    code='''import django;django.setup()
from apps.runtime.transfer import Importer,TransferError
from apps.runtime.mariadb.schema import ready,verify
from apps.accounts.models import Authenticator
from apps.orders.models import Invoice
from django.db import connection
import sys
verify()
assert ready()
for row in Authenticator.objects.all():assert len(row.secret)==20
with connection.cursor() as cursor:
    cursor.execute('SELECT NEXT VALUE FOR orders_invoice_number')
    number=cursor.fetchone()[0]
assert not Invoice.objects.filter(number=f'BR-{number:08d}').exists()
try:Importer(sys.argv[1],expected_digest=sys.argv[2])
except TransferError:pass
else:raise AssertionError('Ready target must refuse re-import')
print('Retained encrypted factors, numbering, native guards and completed-target re-import denial passed.')
'''
    run.python('-c',code,str(directory),digest,name=tag+'-integrity',env=env)


def check(run):
    try:
        from scripts.run_tests import TestRun
    except ModuleNotFoundError:
        from run_tests import TestRun
    if run.marker.get('engine')!='mariadb':
        raise RuntimeError('Cross-engine target must be the allocated MariaDB cluster.')
    results=[]
    for legacy in (True,False):
        tag='legacy47' if legacy else 'phase11'
        source=TestRun(True,(), 'phase-11-negotiation',work_package='cpanel-only-preparation')
        for key in ('REZAYI_TEST_SIGNING_KEY','REZAYI_TEST_ENCRYPTION_KEY'):
            source.generated[key]=run.generated[key]
            source.env[key]=run.generated[key]
        source.env.update(DJANGO_SECRET_KEY=run.generated['REZAYI_TEST_SIGNING_KEY'],MFA_ENCRYPTION_KEY=run.generated['REZAYI_TEST_ENCRYPTION_KEY'],
                          REZAYI_TEST_FIXTURE_PASSWORD=source.password)
        try:
            source.prepare()
            if legacy:
                source.python('-m','scripts.seed_legacy_transfer',name='legacy-source-fixture')
            else:
                source.env['BROWSER_TEST_RUNTIME']='true'
                source.python('-m','scripts.prepare_browser_tests',name='populated-source-fixture',data=json.dumps({'password':source.password,'phase':'phase-11-negotiation'}))
                source.python('-m','scripts.check_negotiation_documents','--output',str(source.evidence/'source-invoices'),name='populated-source-negotiated-agreement')
                source.python('-c', '''import django;django.setup()
from apps.accounts.models import User,Authenticator
u=User.objects.filter(is_superuser=True).first()
a=Authenticator.objects.filter(user=u).first()
if a is None:
    a=Authenticator(user=u,name='Synthetic continuity factor',confirmed=True)
    a.set_secret();a.save()
print('Synthetic encrypted continuity factor retained.')
''',name='source-encryption-continuity')
            folder=source.runtime/'export'
            identity='manifest:'+hashlib.sha256(json.dumps(source.source_manifest(),sort_keys=True).encode()).hexdigest()
            source.python('manage.py','export_transfer','--output',str(folder),'--source-revision',identity,name='source-readonly-export')
            private_root=run.runtime/(tag+'-private')
            files=copy_private(source.runtime,private_root)
            target=private_root/'transfer'
            shutil.copytree(folder,target)
            env=target_env(run,'_legacy' if legacy else '_transfer',private_root)
            load(run,target,env,tag,partial=True)
            manifest=json.loads((target/'manifest.json').read_text())
            entry={'scope':tag,'source_tables':len(manifest['tables']),'source_rows':sum(v['count'] for v in manifest['tables'].values()),
                   'private_files':len(files),'private_sha256':hashlib.sha256(json.dumps(files,sort_keys=True).encode()).hexdigest(),
                   'source_evidence':str(source.evidence.relative_to(source.evidence.parents[5]))}
            if not legacy:
                backup=private_root/'native-backup'
                backup_code = """import django;django.setup()
import sys
from django.core.management import call_command
from apps.runtime.models import Schema,Transfer,Scheduler
models=(Schema,Transfer,Scheduler)
before=[list(model.objects.order_by('pk').values()) for model in models]
call_command('export_transfer',output=sys.argv[1],source_revision=sys.argv[2])
assert before==[list(model.objects.order_by('pk').values()) for model in models]
print('Consistent native backup changed no control rows; generated columns are archived as derived metadata.')
"""
                run.python('-c',backup_code,str(backup),identity,name='native-consistent-backup',env=env)
                restore_root=run.runtime/'restored-private'
                restored=copy_private(private_root,restore_root)
                assert restored==files
                shutil.copytree(backup,restore_root/'transfer')
                restore_env=target_env(run,'_restore',restore_root)
                load(run,restore_root/'transfer',restore_env,'native-restore',partial=True)
                run.python('-c', '''import django;django.setup()
from apps.orders.models import Invoice
from apps.orders.documents import pdf_bytes
from apps.runtime.jobs import acquire_scheduler,release_scheduler,claim,finish
for invoice in Invoice.objects.all()[:2]:
    for locale in ('fa-AF','ps','ar','en'):assert pdf_bytes(invoice,locale).startswith(b'%PDF')
lease=acquire_scheduler();assert lease and acquire_scheduler() is None
assert release_scheduler(lease)
row=claim()
if row:assert finish(row.pk,row.lease)
print('Restored native operation, scheduler fencing and four-language private invoices passed.')
''',name='restored-native-operation',env=restore_env)
                entry['native_backup_restore']='passed'
            results.append(entry)
        finally:
            source.cleanup()
    (run.evidence/'cross-engine-transfer.json').write_text(json.dumps(results,indent=2)+'\n')
