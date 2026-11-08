from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0003_auditevent_reason_auditevent_resource_id_and_more'),
    ]

    operations = [
        migrations.AlterField(
            model_name='auditevent',
            name='resource_type',
            field=models.CharField(blank=True, max_length=64),
        ),
    ]
