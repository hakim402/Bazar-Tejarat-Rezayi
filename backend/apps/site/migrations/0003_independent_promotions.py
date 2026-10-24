from django.db import migrations, models


def copy_current_cards(apps, schema_editor):
    Slide = apps.get_model("site", "HeroSlide")
    Locale = apps.get_model("site", "HeroLocale")
    Settings = apps.get_model("site", "SiteSettings")
    alias = schema_editor.connection.alias
    for site in Settings.objects.using(alias).all():
        if site.hero_mode != "image_carousel":
            continue
        sources = list(Slide.objects.using(alias).filter(settings=site, enabled=True, placement="main", kind="image").order_by("position", "id"))[1:3]
        for index, source in enumerate(sources, 1):
            values = {field: getattr(source, field) for field in ["image_id", "image_url", "bundled_image"]}
            card = Slide.objects.using(alias).create(settings=site, placement=f"promo_{index}", label=f"Promotional card {index}", enabled=True, kind="image", **values)
            for row in Locale.objects.using(alias).filter(slide=source):
                Locale.objects.using(alias).create(slide=card, locale=row.locale, **{field: getattr(row, field) for field in ["title", "description", "alt", "cta_label", "cta_url"]})
        if sources:
            Settings.objects.using(alias).filter(pk=site.pk).update(version=models.F("version") + 1)


class Migration(migrations.Migration):
    dependencies = [("site", "0002_defaults")]
    operations = [
        migrations.AddField(model_name="heroslide", name="placement", field=models.CharField(choices=[("main", "Main hero"), ("promo_1", "Promotional card 1"), ("promo_2", "Promotional card 2")], default="main", max_length=8)),
        migrations.AddField(model_name="heroslide", name="source_url", field=models.CharField(blank=True, max_length=500, verbose_name="Video source destination")),
        migrations.AddConstraint(model_name="heroslide", constraint=models.UniqueConstraint(condition=models.Q(enabled=True, placement__in=["promo_1", "promo_2"]), fields=("settings", "placement"), name="site_enabled_promo_slot")),
        migrations.RunPython(copy_current_cards, migrations.RunPython.noop),
    ]
