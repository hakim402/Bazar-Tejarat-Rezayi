"""Fixed settings: one working draft, optimistic locking and atomic publication."""
from django import forms
from django.core.exceptions import ValidationError
from django.db import transaction
from apps.accounts.services import get_grant, audit
from ..models import SiteSettings, SiteLocale, SiteDraft, SiteDraftUpload
from ..forms import SettingsForm, SITE_TEXT
from ..forms.settings import LOGO_FIELDS
from ..validation import settings_content
from ..media import store_upload, discard_created, schedule_media_cleanup

# All settings sections share a single draft row; legacy per-section rows fold into it.
DRAFT_SECTION = "site"


def lock_settings(request, version):
    """Owner gate plus a row lock; the submitted version must still be current."""
    get_grant(request, "owner")
    site = SiteSettings.objects.select_for_update().get(pk=1)
    if site.version != int(version):
        raise ValidationError("Site Setting changed in another session. Reload and compare before saving again.")
    return site


def _plain(key):
    """Legacy drafts stored 'site-' prefixed keys; the unified form has no prefix."""
    return key[5:] if key.startswith("site-") else key


@transaction.atomic
def working_draft(site):
    """Return the single settings draft, folding in any legacy per-section drafts once."""
    draft = SiteDraft.objects.filter(settings=site, section=DRAFT_SECTION).first()
    legacy = SiteDraft.objects.filter(settings=site).exclude(section=DRAFT_SECTION).prefetch_related("uploads__asset")
    folded = False
    for old in legacy:
        if draft is None:
            draft = SiteDraft.objects.create(settings=site, section=DRAFT_SECTION)
        # Earlier sections win on conflicts; SEO keys keep their formset prefix.
        for key, value in old.form_data.items():
            draft.form_data.setdefault(_plain(key), value)
        for upload in old.uploads.all():
            SiteDraftUpload.objects.update_or_create(draft=draft, field=_plain(upload.field), defaults={"asset": upload.asset})
        old.delete()
        folded = True
    if folded:
        draft.save()
    return draft


def draft_initial(site):
    """Saved draft strings as form initial values; checkboxes come back as booleans."""
    draft = working_draft(site)
    if draft is None:
        return {}
    probe = SettingsForm(instance=site)
    initial = {}
    for key, value in draft.form_data.items():
        field = probe.fields.get(key)
        if field is None:
            continue
        initial[key] = value in {"on", "true", "True", "1"} if isinstance(field, forms.BooleanField) else value
    return initial


def save_settings(request, form, seo=None):
    """Publish the whole settings form (and optional SEO overrides) in one transaction."""
    created = []
    try:
        with transaction.atomic():
            current = lock_settings(request, form.cleaned_data["version"])
            draft = working_draft(current)
            saved_uploads = {upload.field: upload.asset for upload in draft.uploads.select_related("asset")} if draft else {}
            retired = set()

            def uploaded(editor, field, kind, previous=None):
                """Prefer a fresh upload, otherwise reuse the draft's stored asset."""
                file = editor.cleaned_data.get(field)
                asset = store_upload(file, kind, created) if file else saved_uploads.get(editor.add_prefix(field))
                if asset and previous:
                    retired.add(previous.pk)
                return asset

            settings = form.save(commit=False)
            settings.pk = 1
            settings.version = current.version + 1
            # Site-wide assets first, then each language row with its logos.
            for field, target in [("favicon_file", "favicon"), ("og_file", "og_image")]:
                asset = uploaded(form, field, "image", getattr(current, target))
                if asset:
                    setattr(settings, target, asset)
            locales = {}
            for code, _caption in SiteLocale._meta.get_field("locale").choices:
                row = SiteLocale.objects.get(settings=current, locale=code)
                for name in SITE_TEXT:
                    key = f"{code}_{name}"
                    if key in form.cleaned_data:
                        setattr(row, name, form.cleaned_data[key])
                for target in LOGO_FIELDS:
                    if form.cleaned_data.get(f"{code}_{target}_clear"):
                        if getattr(row, target + "_id"):
                            retired.add(getattr(row, target + "_id"))
                        setattr(row, target, None)
                    asset = uploaded(form, f"{code}_{target}_file", "image", getattr(row, target))
                    if asset and not form.cleaned_data.get(f"{code}_{target}_clear"):
                        setattr(row, target, asset)
                locales[code] = row
            # Required Dari content is enforced again under the row lock.
            settings_content(settings, locales["fa-AF"])
            settings.save()
            for code, row in locales.items():
                owned = [name for name in SITE_TEXT if f"{code}_{name}" in form.cleaned_data]
                owned += [name for name in LOGO_FIELDS if f"{code}_{name}_file" in form.cleaned_data]
                if owned:
                    row.save(update_fields=owned)
            # Optional per-page SEO overrides share the same upload handling.
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
            if seo is not None and seo.has_changed():
                changed.append("seo")
            # The draft is consumed by publication; its assets retire with it.
            if draft:
                retired.update(draft.uploads.values_list("asset_id", flat=True))
                draft.delete()
            schedule_media_cleanup(retired)
            audit("site_settings_saved", request=request, context="owner", fields=changed)
    except Exception:
        discard_created(created)
        raise


@transaction.atomic
def save_settings_draft(request, form, seo=None):
    """Persist the raw form (including unchecked boxes and SEO rows) without publishing."""
    created = []
    try:
        site = lock_settings(request, form.cleaned_data["version"])
        draft, _ = SiteDraft.objects.get_or_create(settings=site, section=DRAFT_SECTION)
        # Raw POST strings reproduce exactly what was typed when the draft reopens.
        data = {form.add_prefix(name): form.data.get(form.add_prefix(name), "") for name in form.fields if name != "version" and name not in form.uploads}
        if seo is not None:
            for name in ["TOTAL_FORMS", "INITIAL_FORMS", "MIN_NUM_FORMS", "MAX_NUM_FORMS"]:
                key = seo.add_prefix(name)
                data[key] = seo.data.get(key, "")
            for child in seo:
                for name in child.fields:
                    if name not in child.uploads:
                        data[child.add_prefix(name)] = child.data.get(child.add_prefix(name), "")
        else:
            # Drafts saved from other sections keep the SEO rows drafted in Search & sharing.
            data.update({key: value for key, value in (draft.form_data or {}).items() if key.startswith("seo-")})
        draft.form_data = data
        draft.save()
        retired = []
        # Draft uploads live beside the text so publication can reuse them.
        for editor in [form, *([] if seo is None else seo.forms)]:
            for field, kind in editor.uploads.items():
                key = editor.add_prefix(field)
                old = SiteDraftUpload.objects.filter(draft=draft, field=key).first()
                if old:
                    retired.append(old.asset_id)
                asset = store_upload(editor.cleaned_data[field], kind, created)
                SiteDraftUpload.objects.update_or_create(draft=draft, field=key, defaults={"asset": asset})
        site.version += 1
        site.save(update_fields=["version"])
        audit("site_section_draft_saved", request=request, context="owner", fields=[DRAFT_SECTION])
        schedule_media_cleanup(retired)
    except Exception:
        discard_created(created)
        raise