"""Publish only the fully verified additive financial native contract."""

from django.db import migrations
from apps.runtime.mariadb.payments_v2 import publish


class Migration(migrations.Migration):
    atomic = False
    dependencies = [
        ("runtime", "0004_payments_upgrade_begin"),
        ("payments", "0001_initial"),
        ("notifications", "0003_event_payment_event_notice_payment_order_and_more"),
    ]
    operations = [migrations.RunPython(publish)]
