from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("accounts", "0003_buyer_profile_fields")]
    operations = [
        migrations.AddField(model_name="actiontoken", name="code_digest", field=models.CharField(blank=True, default="", max_length=64)),
        migrations.AddField(model_name="actiontoken", name="failed_attempts", field=models.PositiveSmallIntegerField(default=0)),
    ]
