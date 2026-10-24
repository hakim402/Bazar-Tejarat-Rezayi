"""Owned predecessor fixtures from inactive original migration source; never runtime setup."""
import importlib.util
import hashlib
import json
import uuid
from pathlib import Path
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.db.migrations.recorder import MigrationRecorder
from django.contrib.contenttypes.models import ContentType
from django.contrib.auth.models import Permission, Group
from django.contrib.admin.models import LogEntry, CHANGE
from config.testing import assert_owned_database

TABLES = ("content_contentitem", "content_contentrevision", "content_publication", "content_contentevent")


def predecessor(user):
    assert_owned_database(connection)
    path = Path(__file__).resolve().parents[1] / "retired_migrations/content/0001_initial.py"
    spec = importlib.util.spec_from_file_location("inactive_content_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    migration = module.Migration("0001_initial", "content")
    state = MigrationExecutor(connection).loader.project_state()
    if TABLES[0] not in connection.introspection.table_names():
        with connection.schema_editor() as editor:
            state = migration.apply(state, editor)
        MigrationRecorder(connection).record_applied("content", "0001_initial")
    else:
        for operation in migration.operations:
            operation.state_forwards("content", state)
    Item, Revision, Publication, Event = [state.apps.get_model("content", name) for name in ["ContentItem", "ContentRevision", "Publication", "ContentEvent"]]
    item = Item.objects.create(key="preserve-" + uuid.uuid4().hex, kind="article")
    source = None
    for number, locale in enumerate(["fa-AF", "en", "ps", "ar"], 1):
        revision = Revision.objects.create(item_id=item.pk, number=number, locale=locale, payload={"title": "DEMO historical " + locale}, author_id=user.pk, source=source, state="published")
        Publication.objects.create(item_id=item.pk, revision=revision, locale=locale, publisher_id=user.pk)
        Event.objects.create(item_id=item.pk, revision=revision, actor_id=user.pk, context="owner", action="publish", reason="DEMO historical fixture")
        if source is None:
            source = revision
    ct, _ = ContentType.objects.get_or_create(app_label="content", model="contentitem")
    permission, _ = Permission.objects.get_or_create(content_type=ct, codename="edit_content", defaults={"name": "Historical edit content"})
    group, _ = Group.objects.get_or_create(name="Rezayi:Editorial")
    group.permissions.add(permission)
    user.groups.add(group)
    LogEntry.objects.log_actions(user_id=user.pk, queryset=Item.objects.filter(pk=item.pk), action_flag=CHANGE, change_message="DEMO legacy admin history")
    return state, item.pk


def fingerprints(excluded_migrations=("site",)):
    """Deterministic values/schema, without disclosing fixture or runtime row contents."""
    result = {}
    excluded = {"django_migrations"}
    for table in sorted(connection.introspection.table_names()):
        if table.startswith("site_") or table in excluded:
            continue
        quoted = connection.ops.quote_name(table)
        with connection.cursor() as cursor:
            cursor.execute(f"SELECT row_to_json(t)::text FROM {quoted} t ORDER BY row_to_json(t)::text")
            rows = cursor.fetchall()
            cursor.execute("SELECT column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=%s ORDER BY ordinal_position", [table])
            columns = cursor.fetchall()
            cursor.execute("SELECT conname,pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid=%s::regclass ORDER BY conname", [table])
            constraints = cursor.fetchall()
        result[table] = hashlib.sha256(json.dumps([rows, columns, constraints], default=str).encode()).hexdigest()
    with connection.cursor() as cursor:
        cursor.execute("SELECT app,name,applied FROM django_migrations WHERE app NOT IN (" + ",".join(["%s"] * len(excluded_migrations)) + ") ORDER BY app,name", list(excluded_migrations))
        result["migration_history"] = hashlib.sha256(json.dumps(cursor.fetchall(), default=str).encode()).hexdigest()
    return result
