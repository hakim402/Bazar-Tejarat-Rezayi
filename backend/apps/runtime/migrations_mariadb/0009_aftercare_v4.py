"""Publish only the exact complete Phase 14 native successor."""

from django.db import migrations
from apps.runtime.mariadb.aftercare_v4 import publish


class Migration(migrations.Migration):
    atomic = False
    dependencies = [
        ("runtime", "0008_aftercare_upgrade_begin"),
        ("inventory", "0004_allocationreduction"),
        ("fulfilment", "0002_deliveryrefund_deliveryrefunddecision_and_more"),
        ("notifications", "0005_aftercareemail_aftercareemailattempt_and_more"),
        ("orders", "0003_aftercare_amendment_cancellationrequest_and_more"),
        ("payments", "0002_refundreport_refunddue_alter_finance_options_and_more"),
    ]
    operations = [migrations.RunPython(publish)]
