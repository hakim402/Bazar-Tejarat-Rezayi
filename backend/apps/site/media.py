"""Site-public uploads are inspected locally and never share private domain storage."""
import io
import json
import re
import subprocess
import tempfile
import uuid
import warnings
from pathlib import Path
from django.core.exceptions import ValidationError
from django.core.files.base import ContentFile
from django.core.files.storage import storages
from django.http import HttpResponse, StreamingHttpResponse
from django.shortcuts import get_object_or_404
from PIL import Image, ImageOps, UnidentifiedImageError
from .models import SiteMedia


def inspect_upload(upload, kind):
    maximum = (50 if kind == "video" else 8) * 1024 * 1024
    if upload.size > maximum:
        raise ValidationError(f"Upload exceeds the {maximum // 1024 // 1024} MiB limit.")
    data = upload.read(maximum + 1)
    if len(data) > maximum or not data:
        raise ValidationError("The upload is empty or too large.")
    if kind == "image":
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                with Image.open(io.BytesIO(data)) as image:
                    if image.format not in {"JPEG", "PNG", "WEBP"} or image.width * image.height > 20000000 or min(image.size) < 16:
                        raise ValidationError("Use a JPEG, PNG or WebP image up to 20 megapixels. SVG uploads are not accepted; original SVG defaults remain available.")
                    image.verify()
                with Image.open(io.BytesIO(data)) as source:
                    source.load()
                    source = ImageOps.exif_transpose(source).convert("RGBA")
                    clean = Image.new("RGBA", source.size)
                    clean.paste(source)
                    result = io.BytesIO()
                    clean.save(result, format="WEBP", quality=88)
                    return result.getvalue(), {"content_type": "image/webp", "width": clean.width, "height": clean.height, "duration": 0, "has_audio": False}, "webp"
        except (OSError, UnidentifiedImageError, Image.DecompressionBombWarning, Image.DecompressionBombError, ValueError):
            raise ValidationError("Use an actual JPEG, PNG or WebP image, not an SVG or renamed file.") from None
    if len(data) < 16 or data[4:8] != b"ftyp" or data[8:12] not in {b"isom", b"iso2", b"mp41", b"mp42", b"avc1", b"iso6", b"dash", b"M4V ", b"MSNV"}:
        raise ValidationError("Use an MP4 container, not a renamed MOV or other format.")
    try:
        with tempfile.TemporaryDirectory(prefix="rezayi-site-inspect-") as directory:
            path = Path(directory) / "upload.mp4"
            path.write_bytes(data)
            result = subprocess.run(["ffprobe", "-v", "error", "-protocol_whitelist", "file", "-enable_drefs", "0", "-max_alloc", "67108864", "-show_format", "-show_streams", "-of", "json", str(path)], capture_output=True, timeout=15, check=True)
            info = json.loads(result.stdout)
        streams = info["streams"]
        video = [s for s in streams if s["codec_type"] == "video"]
        audio = [s for s in streams if s["codec_type"] == "audio"]
        duration = float(info["format"]["duration"])
        if len(video) != 1 or len(audio) > 1 or len(streams) != len(video) + len(audio) or "mp4" not in info["format"]["format_name"] or video[0]["codec_name"] != "h264" or video[0].get("pix_fmt") not in {"yuv420p", "yuvj420p"} or audio and audio[0]["codec_name"] != "aac" or not 0 < duration <= 60 or not 0 < video[0]["width"] * video[0]["height"] <= 20000000:
            raise ValueError
        return data, {"content_type": "video/mp4", "width": video[0]["width"], "height": video[0]["height"], "duration": duration, "has_audio": bool(audio)}, "mp4"
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError):
        raise ValidationError("Use a valid H.264 MP4 (AAC audio optional), up to 60 seconds and 20 megapixels. Local ffprobe must be available.") from None


def store_upload(upload, kind, created):
    data, properties, extension = inspect_upload(upload, kind)
    storage = storages["site_local"]
    key = "assets/" + uuid.uuid4().hex + "." + extension
    # Keep exact operation-owned key even if a backend raises after writing it.
    created.append(key)
    stored = storage.save(key, ContentFile(data))
    if stored != key:
        created.append(stored)
    return SiteMedia.objects.create(kind=kind, key=stored, size=len(data), **properties)


def discard_created(keys):
    for key in keys:
        try:
            storages["site_local"].delete(key)
        except OSError:
            # Never broaden cleanup or touch previous references.
            pass


def public_media(request, pk):
    asset = get_object_or_404(SiteMedia, pk=pk)
    public = media_is_public(pk)
    if not public:
        from apps.accounts.services import get_grant
        from rest_framework.exceptions import APIException
        from django.http import Http404
        try:
            get_grant(request, "owner")
        except APIException:
            raise Http404 from None
    if request.method not in {"GET", "HEAD"}:
        return HttpResponse(status=405, headers={"Allow": "GET, HEAD"})
    try:
        stream = storages["site_local"].open(asset.key, "rb")
        size = stream.size
    except (OSError, ValueError):
        return HttpResponse(status=503, headers={"Cache-Control": "no-store", "Retry-After": "60"})
    start, end, status = 0, size - 1, 200
    value = request.headers.get("Range")
    if value:
        match = re.fullmatch(r"bytes=(\d*)-(\d*)", value)
        try:
            if not match or not any(match.groups()):
                raise ValueError
            first, last = match.groups()
            if first:
                start = int(first)
                end = min(int(last), end) if last else end
            else:
                start = max(0, size - int(last))
            if not 0 <= start <= end < size:
                raise ValueError
            status = 206
        except ValueError:
            stream.close()
            return HttpResponse(status=416, headers={"Content-Range": f"bytes */{size}", "Cache-Control": "no-store"})
    length = end - start + 1
    if request.method == "HEAD":
        stream.close()
        response = HttpResponse(content_type=asset.content_type, status=status)
    else:
        def chunks():
            try:
                stream.seek(start)
                remaining = length
                while remaining:
                    chunk = stream.read(min(65536, remaining))
                    if not chunk:
                        break
                    remaining -= len(chunk)
                    yield chunk
            finally:
                stream.close()
        response = StreamingHttpResponse(chunks(), content_type=asset.content_type, status=status)
    response["Content-Length"] = length
    response["Accept-Ranges"] = "bytes"
    response["X-Content-Type-Options"] = "nosniff"
    response["Cache-Control"] = "no-store"
    if status == 206:
        response["Content-Range"] = f"bytes {start}-{end}/{size}"
    return response


def schedule_media_cleanup(asset_ids):
    """Delete only requested, now-unreferenced uploads after the owning transaction."""
    from django.db import transaction
    ids = tuple(str(pk) for pk in asset_ids if pk)
    transaction.on_commit(lambda: cleanup_media(ids), robust=True)


def cleanup_media(asset_ids):
    import logging
    from django.db import transaction
    from .models import SiteSettings
    for pk in asset_ids:
        try:
            with transaction.atomic():
                SiteSettings.objects.select_for_update().get(pk=1)
                asset = SiteMedia.objects.select_for_update().filter(pk=pk).first()
                if not asset:
                    continue
                if any(relation.related_model._base_manager.filter(**{relation.field.name: asset}).exists() for relation in SiteMedia._meta.get_fields(include_hidden=True) if relation.auto_created and relation.is_relation and not relation.concrete):
                    continue
                asset.pending_delete = True
                asset.save(update_fields=['pending_delete'])
                try:
                    storages['site_local'].delete(asset.key)
                except OSError:
                    logging.getLogger(__name__).warning('Site media cleanup pending for asset %s', asset.pk)
                    continue
                asset.delete()
        except Exception:
            logging.getLogger(__name__).exception('Site media cleanup deferred for asset %s', pk)


def media_is_public(pk):
    from django.db.models import Q
    from .models import SiteSettings, SiteLocale, PageSEO, HeroSlide
    if SiteSettings.objects.filter(Q(favicon_id=pk) | Q(og_image_id=pk)).exists() or SiteLocale.objects.filter(Q(logo_light_id=pk) | Q(logo_dark_id=pk)).exists() or PageSEO.objects.filter(image_id=pk).exists():
        return True
    site = SiteSettings.objects.only('hero_mode', 'promotion_one', 'promotion_two').filter(pk=1).first()
    if not site:
        return False
    posts = HeroSlide.objects.filter(is_draft=False, enabled=True, draft_of__isnull=True).filter(Q(placement='main', kind='video' if site.hero_mode == 'video_carousel' else 'image') | Q(pk__in=[value for value in [site.promotion_one_id, site.promotion_two_id] if value]))
    return posts.filter(Q(image_id=pk, kind='image') | Q(video_id=pk, kind='video') | Q(poster_id=pk, kind='video')).exists()
