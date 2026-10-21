"""No direct media URLs: the application authorizes every new byte request."""

import io
import re
import uuid
import warnings
from django.conf import settings
from django.core.files.base import ContentFile
from django.core.files.storage import storages
from django.db import transaction
from django.http import JsonResponse
from PIL import Image, ImageOps, UnidentifiedImageError
from rest_framework.exceptions import APIException
from apps.foundation.errors import error_data
from apps.foundation.observability import log_failure
from apps.organizations.access import assert_version
from . import access
from .models import ProductImage
from .services import bump
from .validation import fail

MAX_BYTES = 8 * 1024 * 1024
REQUEST_LIMIT = MAX_BYTES + 128 * 1024


class StorageUnavailable(APIException):
    status_code = 503
    default_code = "storage_unavailable"
    default_detail = "Image storage is temporarily unavailable."


class CatalogueRequestLimitMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.method in {"POST", "PATCH"} and request.path.startswith("/api/v1/catalogue/"):
            limit = REQUEST_LIMIT if re.search(r"/products/[0-9a-f-]+/images/$", request.path) else 256 * 1024
            try:
                size = int(request.META.get("CONTENT_LENGTH") or 0)
                if size <= 0 or size > limit or len(request.body) > limit:
                    raise ValueError
            except (ValueError, OSError):
                response = JsonResponse(
                    error_data("validation_error", "Review request size.", request.request_id), status=400
                )
                response["Cache-Control"] = "private, no-store"
                return response
        return self.get_response(request)


def decode(upload):
    if not upload or upload.size > MAX_BYTES:
        fail("file", "image_size")
    data = upload.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        fail("file", "image_size")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as source:
                if (
                    source.format not in {"JPEG", "PNG", "WEBP"}
                    or source.width * source.height > 20000000
                    or max(source.size) > 6000
                    or min(source.size) < 32
                ):
                    fail("file", "image_dimensions")
                source.verify()
            with Image.open(io.BytesIO(data)) as source:
                source.load()
                image = ImageOps.exif_transpose(source).convert("RGB")
                # Rebuild pixels: strips EXIF, comments and all source metadata.
                clean = Image.new("RGB", image.size)
                clean.paste(image)
                result = io.BytesIO()
                clean.save(result, format="JPEG", quality=88)
                return result.getvalue(), clean.width, clean.height
    except (OSError, ValueError, UnidentifiedImageError, Image.DecompressionBombWarning, Image.DecompressionBombError):
        fail("file", "image_type")


def upload(actor, pk, version, file):
    # Storage writes cannot roll back with SQL. Retire only this operation's newly written key on failure.
    stored_key = None
    requested_key = None
    backend = None
    try:
        with transaction.atomic():
            item = access.resource(actor, pk, lock=True)
            if actor.context != "seller":
                from rest_framework.exceptions import PermissionDenied

                raise PermissionDenied()
            assert_version(item, version)
            if item.images.count() >= 100:
                fail("file", "image_count")
            data, width, height = decode(file)
            alias = settings.CATALOGUE_STORAGE_ALIAS
            if alias not in {"catalogue_local", "catalogue_s3"}:
                raise StorageUnavailable()
            backend = storages[alias]
            requested_key = f"{item.pk}/{uuid.uuid4().hex}.jpg"
            stored_key = backend.save(requested_key, ContentFile(data))
            image = ProductImage.objects.create(
                product=item,
                storage_alias=alias,
                key=stored_key,
                content_type="image/jpeg",
                width=width,
                height=height,
                size=len(data),
            )
            bump(item)
            access.audit(actor, item, "image_upload")
            return {
                "id": image.pk,
                "width": width,
                "height": height,
                "url": f"/api/v1/catalogue/{actor.context}/images/{image.pk}/",
                "version": item.version,
            }
    except Exception as exc:
        if (stored_key or requested_key) and backend:
            try:
                backend.delete(stored_key or requested_key)
            except Exception:
                # Keep failure explicit; never delete existing keys or try another backend.
                pass
        if isinstance(exc, APIException):
            raise
        log_failure(actor.request, exc, operation="catalogue_upload", dependency="storage")
        raise StorageUnavailable() from None
