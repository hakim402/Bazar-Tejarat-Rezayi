"""Shared private-evidence object staging and unbound expiry."""

from django.core.files.base import ContentFile
from django.core.files.storage import storages
from django.db import transaction
from django.utils import timezone
from apps.catalogue.media import StorageUnavailable


def stage_image(data, prefix, image_id, *, alias="private_local"):
    """Store one normalized image under a fresh deterministic private key."""
    key = f"{prefix}/{image_id.hex}.jpg"
    backend = storages[alias]
    if backend.exists(key):
        raise StorageUnavailable()
    written = backend.save(key, ContentFile(data))
    if written != key:
        backend.delete(written)
        raise StorageUnavailable()
    return key


def sweep_unbound(model, prefix, *, limit=10, alias="private_local"):
    """Delete expired unbound evidence rows and their owned private objects."""
    ids = list(
        model.objects.filter(expires_at__lte=timezone.now(), binding__isnull=True)
        .order_by("expires_at", "pk")
        .values_list("pk", flat=True)[:limit]
    )
    for pk in ids:
        with transaction.atomic():
            item = (
                model.objects.select_for_update()
                .filter(pk=pk, binding__isnull=True, expires_at__lte=timezone.now())
                .first()
            )
            if not item or item.storage_alias != alias or item.key != f"{prefix}/{item.pk.hex}.jpg":
                continue
            try:
                storages[alias].delete(item.key)
            except Exception:
                continue
            item.delete()
