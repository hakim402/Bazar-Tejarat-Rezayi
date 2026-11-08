from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0001_mariadb_schema'),
    ]

    operations = [
        migrations.AlterField(
            model_name='auditevent',
            name='resource_type',
            field=models.CharField(blank=True, max_length=64),
        ),
    ]
