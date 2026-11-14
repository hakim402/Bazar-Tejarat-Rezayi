"""Homepage media posts: isolated working drafts, atomic publication and scoped cleanup."""
import subprocess
import tempfile
from pathlib import Path
from django.core.exceptions import ValidationError
from django.core.files.storage import storages
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import transaction
from apps.accounts.services import audit
from ..models import HeroSlide, HeroLocale, SiteDraft, LOCALES
from ..forms import HERO_TEXT, PostForm
from ..media import store_upload, discard_created, schedule_media_cleanup
from .settings import DRAFT_SECTION, lock_settings

# Copied verbatim from the draft onto the public row at publication time.
POST_FIELDS = [name for name in PostForm.Meta.fields if name != "placement"]
MEDIA_FIELDS = ["image", "video", "poster"]


def media_ids(post):
    """Every asset this post version references, for retirement on replace/delete."""
    return {getattr(post, field + "_id") for field in MEDIA_FIELDS if getattr(post, field + "_id")}


def draft_for(post):
    """The working version of a post: its pending draft, or the public row itself."""
    if post.is_draft:
        return post
    return HeroSlide.objects.filter(draft_of=post).prefetch_related("locales").first() or post


def automatic_poster(video, created):
    """Generate a public poster from the already inspected local video upload."""
    try:
        with tempfile.TemporaryDirectory(prefix="rezayi-site-poster-") as folder:
            source = Path(folder) / "video.mp4"
            with storages["site_local"].open(video.key, "rb") as file:
                source.write_bytes(file.read())
            target = Path(folder) / "poster.jpg"
            subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-protocol_whitelist", "file", "-i", str(source), "-frames:v", "1", "-vf", "scale=1280:720:force_original_aspect_ratio=decrease", "-y", str(target)], capture_output=True, check=True, timeout=20)
            return store_upload(SimpleUploadedFile("poster.jpg", target.read_bytes(), content_type="image/jpeg"), "image", created)
    except (OSError, subprocess.SubprocessError):
        raise ValidationError("A video poster could not be generated. Upload a poster image and retry.") from None


def save_post(request, form, root, placement, publish=False):
    """Save the working draft, or publish it into the stable public identity."""
    created, retired = [], set()
    try:
        with transaction.atomic():
            site = lock_settings(request, form.cleaned_data["version"])
            if root.pk and not root._state.adding:
                root = HeroSlide.objects.select_for_update().get(pk=root.pk, settings=site, draft_of__isnull=True, placement=placement)
            existing = draft_for(root) if not root._state.adding else root
            retired.update(media_ids(existing))
            editing = form.save(commit=False)
            # Never mutate the live row to save its working draft.
            if not publish and not root._state.adding and not root.is_draft and existing.pk == root.pk:
                editing.pk = None
                editing._state.adding = True
                editing.draft_of = root
                editing.is_draft = True
            editing.settings = site
            editing.placement = placement
            editing.is_draft = not publish
            if placement == "promotion":
                editing.enabled = True
            # Clearing and uploading are resolved before the kind-specific reset.
            for field in ["image", "video"]:
                if form.cleaned_data.get("clear_" + field):
                    setattr(editing, field, None)
            upload_fields = [("image", "image")] if editing.kind == "image" else [("video", "video"), ("poster", "image")]
            for field, kind in upload_fields:
                file = form.cleaned_data.get(field + "_file")
                if file:
                    setattr(editing, field, store_upload(file, kind, created))
            if editing.kind == "video" and form.cleaned_data.get("video_file") and not form.cleaned_data.get("poster_file"):
                editing.poster = automatic_poster(editing.video, created)
            if editing.kind == "image":
                editing.video = None
                editing.poster = None
                editing.video_url = ""
            else:
                editing.image = None
                editing.image_url = ""
                editing.bundled_image = False
            # The carousel cap applies only to included, published main slides.
            if publish and placement == "main" and editing.enabled:
                others = HeroSlide.objects.filter(settings=site, placement="main", kind=editing.kind, enabled=True, is_draft=False, draft_of__isnull=True).exclude(pk=root.pk)
                if others.count() >= 8:
                    raise ValidationError("Up to eight included slides per carousel. Disable one before publishing another.")
            text_values = {code: {name: form.cleaned_data.get(f"{code}_{name}", "") for name in HERO_TEXT} for code, _caption in LOCALES}
            if publish and editing.draft_of_id:
                # Copy working content into the stable public identity.
                target = root
                retired.update(media_ids(target))
                for field in [*POST_FIELDS, *MEDIA_FIELDS]:
                    setattr(target, field, getattr(editing, field))
                target.is_draft = False
                target.save()
                editing.delete()
                editing = target
            else:
                editing.save()
            for code, values in text_values.items():
                HeroLocale.objects.update_or_create(slide=editing, locale=code, defaults=values)
            site.version += 1
            site.save(update_fields=["version"])
            audit("site_media_post_published" if publish else "site_media_post_draft_saved", request=request, context="owner", fields=["post", placement])
            schedule_media_cleanup(retired)
            return editing.draft_of or editing
    except Exception:
        discard_created(created)
        raise


@transaction.atomic
def delete_post(request, root, version):
    """Remove a post and its drafts; retire exclusive assets and invalidate selections."""
    site = lock_settings(request, version)
    root = HeroSlide.objects.select_for_update().get(pk=root.pk, settings=site, draft_of__isnull=True)
    drafts = list(HeroSlide.objects.filter(draft_of=root))
    retired = media_ids(root) | {pk for draft in drafts for pk in media_ids(draft)}
    post_id = str(root.pk)
    root.delete()
    site.version += 1
    site.save(update_fields=["version"])
    # Any saved selection draft that named this post is invalidated, not silently republished.
    selection = SiteDraft.objects.filter(settings=site, section=DRAFT_SECTION).first()
    if selection and post_id in selection.form_data.values():
        for key in list(selection.form_data):
            if key.rsplit("-", 1)[-1] in {"promotion_one", "promotion_two"} and selection.form_data[key] == post_id:
                selection.form_data[key] = ""
        selection.save(update_fields=["form_data", "updated_at"])
    audit("site_media_post_deleted", request=request, context="owner", fields=["post"])
    schedule_media_cleanup(retired)
    return retired