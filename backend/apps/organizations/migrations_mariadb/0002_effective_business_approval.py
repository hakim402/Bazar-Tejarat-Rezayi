from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("organizations", "0001_mariadb_schema"), ("verification", "0001_mariadb_schema")]
    operations = [
        migrations.AddField(
            model_name="businessprofile", name="effective_case",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="+", to="verification.reviewcase"),
        ),
    ]
