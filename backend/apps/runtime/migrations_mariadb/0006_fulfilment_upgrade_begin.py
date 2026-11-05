from django.db import migrations
from apps.runtime.mariadb.fulfilment_v3 import begin


class Migration(migrations.Migration):
    atomic = False
    dependencies = [("runtime", "0005_payments_v2")]
    operations = [migrations.RunPython(begin)]
