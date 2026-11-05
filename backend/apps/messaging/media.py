"""Authenticated image staging and downloads. Never use public storage URLs."""

import hashlib
import io
import uuid
import warnings
from datetime import timedelta
from django.core.files.base import ContentFile
from django.core.files.storage import storages
from django.db import transaction
from django.http import FileResponse, JsonResponse, Http404
from django.shortcuts import get_object_or_404
from django.utils import timezone
from PIL import Image, ImageOps, UnidentifiedImageError
from rest_framework.exceptions import APIException, ValidationError
from apps.catalogue.media import StorageUnavailable
from apps.catalogue.models import Product
from apps.foundation.errors import error_data
from apps.foundation.storage import FileLocation
from apps.marketplace.queries import PublicGate
from . import access, services
from .models import Attachment

MAX_BYTES = 5 * 1024 * 1024
REQUEST_LIMIT = MAX_BYTES + 128 * 1024


class MessageRequestLimitMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.method in {"POST", "PATCH"} and request.path.startswith(
            ("/api/v1/messaging/", "/api/v1/notifications/", "/api/v1/payments/", "/api/v1/fulfilment/")
        ):
            limit = REQUEST_LIMIT if request.path.endswith("/uploads/") else 64 * 1024
            try:
                size = int(request.META.get("CONTENT_LENGTH") or 0)
                if not 0 < size <= limit or len(request.body) > limit:
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
        raise ValidationError({"file": ["image_size"]})
    raw = upload.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise ValidationError({"file": ["image_size"]})
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw)) as source:
                if (
                    source.format not in {"JPEG", "PNG", "WEBP"}
                    or getattr(source, "is_animated", False)
                    or source.width * source.height > 20000000
                    or max(source.size) > 6000
                ):
                    raise ValidationError({"file": ["image_type"]})
                source.verify()
            with Image.open(io.BytesIO(raw)) as source:
                source.load()
                image = ImageOps.exif_transpose(source).convert("RGB")
                clean = Image.new("RGB", image.size)
                clean.paste(image)
                output = io.BytesIO()
                clean.save(output, format="JPEG", quality=88)
                result = output.getvalue()
                if len(result) > MAX_BYTES:
                    raise ValidationError({"file": ["image_size"]})
                return raw, result, clean.width, clean.height
    except (OSError, ValueError, UnidentifiedImageError, Image.DecompressionBombWarning, Image.DecompressionBombError):
        raise ValidationError({"file": ["image_type"]}) from None


def upload(actor, target, key, file, *, enquiry=False):
    # Authorization precedes decoding/storage. The transaction owns this new key
    # only; failures never remove existing/bound files or fall back to another alias.
    written = None
    try:
        with transaction.atomic():
            if enquiry:
                if actor.context != "buyer":
                    from rest_framework.exceptions import PermissionDenied

                    raise PermissionDenied()
                product = get_object_or_404(Product.objects.all(), pk=target)
                access.lock_actor(actor, product.seller_id)
                product = get_object_or_404(Product.objects.select_for_update(), pk=target)
                conversation = None
            else:
                conversation = access.conversation(actor, target, lock=True)
                product = conversation.product
            raw, data, width, height = decode(file)
            account = actor.account
            action = ("enquiry_upload:" if enquiry else "upload:") + str(target)
            payload = {"sha256": hashlib.sha256(raw).hexdigest()}
            old = services.replay(account, action, key, payload)
            if old:
                access.participant_attachment(actor, old["id"])
                return old
            if enquiry:
                access.not_self(product.seller, actor.account)
                PublicGate("fa-AF").product(product.pk)
            else:
                access.require_write(conversation)
            image_id = uuid.uuid4()
            location = FileLocation("private_local", f"messages/{image_id.hex}.jpg")
            backend = storages[location.storage_alias]
            written = backend.save(location.key, ContentFile(data))
            if written != location.key:
                raise StorageUnavailable()
            row = Attachment.objects.create(
                id=image_id,
                product=product,
                conversation=conversation,
                creator=account,
                key=written,
                size=len(data),
                sha256=hashlib.sha256(data).hexdigest(),
                width=width,
                height=height,
                expires_at=timezone.now() + timedelta(hours=24),
            )
            return services.outcome(
                account, action, key, payload, {"id": str(row.pk), "width": width, "height": height, "size": row.size}
            )
    except BaseException as error:
        if written:
            try:
                storages["private_local"].delete(written)
            except Exception:
                pass
        if not isinstance(error, Exception) or isinstance(error, (APIException, Http404)):
            raise
        raise StorageUnavailable() from None


def response(item, *, head=False):
    try:
        handle = FileLocation(item.storage_alias, item.key).open()
        # Missing known objects and other authorized storage failures are dependencies.
        result = FileResponse(handle, content_type="image/jpeg", filename="message-image.jpg")
        if head:
            handle.close()
            result = JsonResponse({}, status=200)
            result.content = b""
            result["Content-Type"] = "image/jpeg"
        result["Content-Length"] = str(item.size)
        result["Cache-Control"] = "private, no-store"
        result["Referrer-Policy"] = "no-referrer"
        result["X-Content-Type-Options"] = "nosniff"
        result["Content-Disposition"] = 'inline; filename="message-image.jpg"'
        return result
    except Exception:
        raise StorageUnavailable() from None


def sweep_unbound():
    # Binding and expiry cleanup serialize on the same attachment row. Only a
    # recorded expired, unbound private messages key can be removed.
    for pk in Attachment.objects.filter(message__isnull=True, expires_at__lte=timezone.now()).values_list(
        "pk", flat=True
    )[:50]:
        with transaction.atomic():
            row = (
                Attachment.objects.select_for_update()
                .filter(pk=pk, message__isnull=True, expires_at__lte=timezone.now())
                .first()
            )
            if row and row.storage_alias == "private_local" and row.key.startswith("messages/"):
                try:
                    storages[row.storage_alias].delete(row.key)
                except Exception:
                    continue
                row.delete()


@transaction.atomic
def participant_response(actor, pk, *, head=False):
    preliminary = access.participant_attachment(actor, pk)
    if preliminary.conversation_id:
        access.conversation(actor, preliminary.conversation_id, lock=True)
    else:
        access.lock_actor(actor, preliminary.product.seller_id)
    item = access.participant_attachment(actor, pk)
    # The protected handle is opened before authority locks are released. Later
    # revocation cannot recall bytes already authorized/opened at this boundary.
    return response(item, head=head)
