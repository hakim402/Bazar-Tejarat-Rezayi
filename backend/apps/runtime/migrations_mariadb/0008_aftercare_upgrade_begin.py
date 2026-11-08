from django.db import migrations
from apps.runtime.mariadb.aftercare_v4 import begin


class Migration(migrations.Migration):
    atomic = False
    dependencies = [("runtime", "0007_fulfilment_v3")]
    operations = [migrations.RunPython(begin)]
