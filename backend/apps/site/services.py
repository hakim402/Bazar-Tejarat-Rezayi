"""Publish validated fixed settings sections with optimistic concurrency and safe uploads."""
from django.db import transaction
from django.core.exceptions import ValidationError
from apps.accounts.services import get_grant, audit
from .models import SiteSettings, SiteLocale, HeroLocale, HeroSlide, SiteDraft
from .forms import SITE_TEXT, HERO_TEXT
from .validation import configuration
from .media import store_upload, discard_created, schedule_media_cleanup


def save_settings(request, form, slides=None, seo=None, promotions=()):
    get_grant(request, "owner")
    created = []
    try:
        with transaction.atomic():
            current = SiteSettings.objects.select_for_update().get(pk=1)
            if current.version != form.cleaned_data["version"]:
                raise ValidationError("Settings changed in another session. Your input is retained. Reload and compare before saving again.")
            draft = SiteDraft.objects.filter(settings=current, section=form.section.key).first() if form.section else None
            saved_uploads = {upload.field: upload.asset for upload in draft.uploads.select_related("asset")} if draft else {}
            retired = set()
            def uploaded(editor, field, kind, previous=None):
                file = editor.cleaned_data.get(field)
                asset = store_upload(file, kind, created) if file else saved_uploads.get(editor.add_prefix(field))
                if asset and previous:
                    retired.add(previous.pk)
                return asset
            settings = form.save(commit=False)
            settings.pk = 1
            settings.version = current.version + 1
            for field, target in [("favicon_file", "favicon"), ("og_file", "og_image")]:
                asset = uploaded(form, field, "image", getattr(current, target))
                if asset:
                    setattr(settings, target, asset)
            locales = {}
            for code, _ in SiteLocale._meta.get_field("locale").choices:
                row = SiteLocale.objects.get(settings=current, locale=code)
                for name in SITE_TEXT:
                    key = f"{code}_{name}"
                    if key in form.cleaned_data:
                        setattr(row, name, form.cleaned_data[key])
                for target in ["logo_light", "logo_dark"]:
                    if form.cleaned_data.get(f"{code}_{target}_clear"):
                        if getattr(row, target + "_id"):
                            retired.add(getattr(row, target + "_id"))
                        setattr(row, target, None)
                    asset = uploaded(form, f"{code}_{target}_file", "image", getattr(row, target))
                    if asset and not form.cleaned_data.get(f"{code}_{target}_clear"):
                        setattr(row, target, asset)
                locales[code] = row
            slide_editors = [("main", slides)] if slides is not None else []
            slide_editors.extend(promotions)
            for placement, child in [(placement, child) for placement, editors in slide_editors for child in editors.forms]:
                if not child.has_changed() and child.instance._state.adding:
                    continue
                slide = child.save(commit=False)
                slide.settings = settings
                slide.placement = placement
                if child.cleaned_data.get("DELETE"):
                    if not slide._state.adding:
                        slide.enabled = False
                        slide.save(update_fields=["enabled"])
                    continue
                for target in ["image", "video"]:
                    if child.cleaned_data.get("clear_" + target):
                        setattr(slide, target, None)
                for target, kind in [("image", "image"), ("poster", "image"), ("video", "video")]:
                    file = child.cleaned_data.get(target + "_file")
                    if file:
                        setattr(slide, target, store_upload(file, kind, created))
                slide.save()
                for code, _ in SiteLocale._meta.get_field("locale").choices:
                    HeroLocale.objects.update_or_create(slide=slide, locale=code, defaults={name: child.cleaned_data[f"{code}_{name}"] for name in HERO_TEXT})
            configuration(settings, locales, list(HeroSlide.objects.filter(settings=current)))
            settings.save()
            for code, row in locales.items():
                owned = [name for name in SITE_TEXT if f"{code}_{name}" in form.cleaned_data]
                owned += [name for name in ["logo_light", "logo_dark"] if f"{code}_{name}_file" in form.cleaned_data]
                if owned:
                    row.save(update_fields=owned)
            for child in seo.forms if seo is not None else []:
                if not child.has_changed():
                    continue
                if child.cleaned_data.get("DELETE"):
                    if not child.instance._state.adding:
                        child.instance.delete()
                    continue
                row = child.save(commit=False)
                row.settings = settings
                asset = uploaded(child, "image_file", "image", row.image)
                if asset:
                    row.image = asset
                row.save()
            changed = [name for name in form.changed_data if name != "version"]
            if slides is not None and slides.has_changed():
                changed.append("hero")
            if any(editors.has_changed() for _, editors in promotions):
                changed.append("promotional_cards")
            if seo is not None and seo.has_changed():
                changed.append("seo")
            if draft:
                retired.update(draft.uploads.values_list("asset_id", flat=True))
                draft.delete()
            schedule_media_cleanup(retired)
            audit("site_settings_saved", request=request, context="owner", fields=changed)
    except Exception:
        discard_created(created)
        raise
