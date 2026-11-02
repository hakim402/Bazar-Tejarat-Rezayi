"""A synthetic47-migration source; no real data or original runtime is opened."""
import hashlib
import json
import os
from pathlib import Path
from datetime import timedelta
from uuid import UUID
import django
from cryptography.fernet import Fernet
from django.conf import settings
from django.contrib.auth.hashers import make_password
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.utils import timezone
from config.testing import assert_owned_database


def main():
    django.setup()
    assert_owned_database(connection)
    if connection.vendor != 'postgresql':
        raise RuntimeError('This historical fixture requires its owned PostgreSQL source.')
    executor=MigrationExecutor(connection)
    allowed={tuple(row) for row in json.loads((Path(__file__).parents[1]/'tests/fixtures/source47_migrations.json').read_text())}
    targets=[node for node in allowed if not any(child.key in allowed for child in executor.loader.graph.node_map[node].children)]
    executor.migrate(targets)
    state=executor.loader.project_state(targets).apps
    user=state.get_model('accounts','User').objects.create(id=UUID('00000001-0000-1000-8000-ffffffffffff'),
        email='legacy-transfer@example.test',display_name='Synthetic retained root',password=make_password(os.environ['REZAYI_TEST_FIXTURE_PASSWORD']),
        email_verified=True,is_staff=True,is_superuser=True,owner_authority=False)
    for context in ('buyer','seller'):
        state.get_model('accounts','Account').objects.create(user=user,context=context)
    ct=state.get_model('contenttypes','ContentType').objects.create(app_label='accounts',model='user')
    permission=state.get_model('auth','Permission').objects.create(content_type=ct,codename='view_user',name='Synthetic native user view')
    group=state.get_model('auth','Group').objects.create(name='Synthetic retained group')
    group.permissions.add(permission)
    user.groups.add(group)
    cipher=Fernet(settings.MFA_ENCRYPTION_KEY.encode())
    state.get_model('accounts','Authenticator').objects.create(user=user,name='Retained synthetic factor',confirmed=True,
        encrypted_secret=cipher.encrypt(os.urandom(20)).decode())
    raw='Synthetic-transfer-token-not-for-real-use'
    token=state.get_model('accounts','ActionToken').objects.create(user=user,purpose='reset',digest=hashlib.sha256(raw.encode()).hexdigest(),
        credential_state='0'*64,expires_at=timezone.now()+timedelta(hours=1))
    payload=json.dumps({'raw':raw,'locale':'en'}).encode()
    state.get_model('accounts','AccountMail').objects.create(token=token,encrypted_payload=cipher.encrypt(payload).decode(),expires_at=token.expires_at)
    with connection.cursor() as cursor:
        cursor.execute('SELECT COUNT(*) FROM django_migrations')
        assert cursor.fetchone()[0]==47
    print('Synthetic47-migration source retained credentials, roles, native groups, encrypted factor and pending mail; no upgrade performed.')


if __name__=='__main__':
    main()
