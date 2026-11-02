"""Fresh unservable import boundary; all target tables/constraints, no guard removal."""
from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [('accounts', '0001_mariadb_schema'), ('organizations', '0001_mariadb_schema'), ('verification', '0001_mariadb_schema'), ('site', '0001_mariadb_schema'), ('catalogue', '0001_mariadb_schema'), ('inventory', '0001_mariadb_schema'), ('marketplace', '0001_mariadb_schema'), ('messaging', '0001_mariadb_schema'), ('notifications', '0001_mariadb_schema'), ('cart', '0001_mariadb_schema'), ('orders', '0001_mariadb_schema'), ('runtime', '0001_mariadb_schema')]
    dependencies += [("admin", "0003_logentry_add_action_flag_choices"),
                     ("auth", "0012_alter_user_first_name_max_length"),
                     ("contenttypes", "0002_remove_content_type_name"),
                     ("sessions", "0001_initial")]
    operations = []
