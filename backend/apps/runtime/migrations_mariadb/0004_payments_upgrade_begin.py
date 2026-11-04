from django.db import migrations
from apps.runtime.mariadb.payments_v2 import begin


class Migration(migrations.Migration):
    atomic=False
    dependencies=[("runtime","0003_mariadb_guards")]
    operations=[migrations.RunPython(begin)]
