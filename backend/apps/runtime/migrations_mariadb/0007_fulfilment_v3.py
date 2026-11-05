"""Publish only the exact complete Phase 13 native successor."""

from django.db import migrations
from apps.runtime.mariadb.fulfilment_v3 import publish


class Migration(migrations.Migration):
    atomic = False
    dependencies = [
        ("runtime", "0006_fulfilment_upgrade_begin"),
        ("fulfilment", "0001_initial"),
        ("inventory", "0003_stocktransition"),
        ("notifications", "0004_remove_event_notifications_typed_event_and_more"),
    ]
    operations = [migrations.RunPython(publish)]
