from django.db import migrations, models
import django.db.models.deletion


def preserve_selection(apps, schema_editor):
    Site = apps.get_model('site', 'SiteSettings')
    Slide = apps.get_model('site', 'HeroSlide')
    alias = schema_editor.connection.alias
    for site in Site.objects.using(alias).all():
        site.hero_mode = 'video_carousel' if 'video' in site.hero_mode else 'image_carousel'
        site.promotion_one = Slide.objects.using(alias).filter(settings=site, placement='promo_1', enabled=True).first()
        site.promotion_two = Slide.objects.using(alias).filter(settings=site, placement='promo_2', enabled=True).first()
        site.version += 1
        site.save(using=alias, update_fields=['hero_mode', 'promotion_one', 'promotion_two', 'version'])
    Slide.objects.using(alias).filter(placement__in=['promo_1', 'promo_2']).update(placement='promotion')


class Migration(migrations.Migration):
    dependencies = [('site', '0003_independent_promotions')]
    operations = [
        migrations.RemoveConstraint(model_name='heroslide', name='site_enabled_promo_slot'),
        migrations.AddField(model_name='sitemedia', name='pending_delete', field=models.BooleanField(default=False, editable=False)),
        migrations.AddField(model_name='heroslide', name='is_draft', field=models.BooleanField(default=False)),
        migrations.AddField(model_name='heroslide', name='draft_of', field=models.OneToOneField(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='pending_draft', to='site.heroslide')),
        migrations.AddField(model_name='heroslide', name='updated_at', field=models.DateTimeField(auto_now=True)),
        migrations.AddField(model_name='sitesettings', name='promotion_one', field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='selected_first', to='site.heroslide')),
        migrations.AddField(model_name='sitesettings', name='promotion_two', field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='selected_second', to='site.heroslide')),
        migrations.AlterField(model_name='heroslide', name='placement', field=models.CharField(choices=[('main', 'Main hero'), ('promotion', 'Promotional post')], default='main', max_length=9)),
        migrations.RunPython(preserve_selection, migrations.RunPython.noop),
        migrations.AlterField(model_name='sitesettings', name='hero_mode', field=models.CharField(choices=[('image_carousel', 'Image Carousel'), ('video_carousel', 'Video Carousel')], default='image_carousel', max_length=16)),
        migrations.AddConstraint(model_name='heroslide', constraint=models.CheckConstraint(condition=models.Q(draft_of__isnull=True) | models.Q(is_draft=True), name='site_draft_child_private')),
        migrations.CreateModel(name='SiteDraft', fields=[('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')), ('section', models.CharField(max_length=20)), ('form_data', models.JSONField(default=dict)), ('updated_at', models.DateTimeField(auto_now=True)), ('settings', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='section_drafts', to='site.sitesettings'))], options={'constraints':[models.UniqueConstraint(fields=('settings','section'),name='site_one_section_draft')]}),
        migrations.CreateModel(name='SiteDraftUpload', fields=[('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')), ('field', models.CharField(max_length=100)), ('asset', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to='site.sitemedia')), ('draft', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='uploads', to='site.sitedraft'))], options={'constraints':[models.UniqueConstraint(fields=('draft','field'),name='site_one_draft_upload')]}),
    ]
