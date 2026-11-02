"""Native integrity and readiness publication for a new verified target."""
from django.db import migrations
from apps.runtime.mariadb.schema import install


def initialize_defaults(apps, schema_editor):
    from apps.site.defaults import TEXT
    from apps.foundation.contracts import BRAND_NAMES
    alias = schema_editor.connection.alias
    site, created = apps.get_model("site", "SiteSettings").objects.using(alias).get_or_create(pk=1)
    if not created:
        return
    slide = apps.get_model("site", "HeroSlide").objects.using(alias).create(
        settings=site, label="Approved marketplace introduction", enabled=True, bundled_image=True)
    for locale, values in TEXT.items():
        title, description, label, alt, maintenance_title, maintenance_message = values
        apps.get_model("site", "SiteLocale").objects.using(alias).create(
            settings=site, locale=locale, name=BRAND_NAMES[locale], description=description,
            maintenance_title=maintenance_title, maintenance_message=maintenance_message)
        apps.get_model("site", "HeroLocale").objects.using(alias).create(
            slide=slide, locale=locale, title=title, description=description, alt=alt,
            cta_label=label, cta_url="/how-it-works")


class Migration(migrations.Migration):
    atomic = False
    dependencies = [("runtime", "0002_mariadb_staging")]
    operations = [migrations.RunPython(initialize_defaults, atomic=True), migrations.RunPython(install)]
