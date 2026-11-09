"""Publish only the exact complete Phase 15 native successor."""

from django.db import migrations
from apps.runtime.mariadb.disputes_v5 import publish


class Migration(migrations.Migration):
    atomic = False
    dependencies = [
        ("runtime", "0010_disputes_upgrade_begin"),
        ("orders", "0004_disputerequest_alter_aftercare_options_review_and_more"),
        ("messaging", "0002_report_order_report_product_report_store_and_more"),
        ("notifications", "0006_remove_notice_notifications_typed_resource_and_more"),
        ("payments", "0003_remove_evidencebinding_payments_evidence_target_and_more"),
        ("fulfilment", "0002_deliveryrefund_deliveryrefunddecision_and_more"),
    ]
    operations = [migrations.RunPython(publish)]
