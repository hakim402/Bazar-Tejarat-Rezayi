from django.db import migrations
from apps.runtime.mariadb.disputes_v5 import begin


class Migration(migrations.Migration):
    atomic = False
    dependencies = [("runtime", "0009_aftercare_v4")]
    operations = [migrations.RunPython(begin)]
