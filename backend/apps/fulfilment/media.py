"""Optional normalized delivery evidence; never shares goods-evidence ownership."""

import hashlib
import uuid
from datetime import timedelta
from django.core.files.storage import storages
from django.db import transaction
from django.http import Http404
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import APIException, PermissionDenied, NotFound
from apps.catalogue.media import StorageUnavailable
from apps.foundation.images import stage_image
from apps.messaging.media import decode, response as image_response
from apps.runtime.locks import lock
from . import access, models as m, services, validation as v


def upload(actor, pk, key, purpose, file):
    order = get_object_or_404(access.scope(actor), pk=pk)
    if actor.context not in {"buyer", "seller"} or not evidence_allowed(actor, order, purpose):
        raise PermissionDenied()
    if purpose not in {"claim", "correction", "refund"}:
        v.fail("purpose")
    # Decode actual bounded bytes before the ordered mutation transaction.
    raw, clean, width, height = decode(file)
    digest = v.digest("upload", pk, {"sha256": hashlib.sha256(raw).hexdigest(), "purpose": purpose})
    owned = []
    backend = storages["private_local"]
    try:
        with transaction.atomic():
            lock("fulfilment-command:" + str(key))
            order = access.lock_order(actor, pk)
            if not evidence_allowed(actor, order, purpose):
                raise PermissionDenied()
            old = services.previous(actor, order, key, "upload", digest)
            if old:
                return old
            image = uuid.uuid4()
            owned.append(f"fulfilment/{image.hex}.jpg")
            written = stage_image(clean, "fulfilment", image)
            item = m.Evidence.objects.create(
                id=image,
                order=order,
                creator=actor.account,
                purpose=purpose,
                key=written,
                sha256=hashlib.sha256(clean).hexdigest(),
                size=len(clean),
                width=width,
                height=height,
                expires_at=timezone.now() + timedelta(hours=24),
            )
            return services.remember(
                actor,
                order,
                key,
                "upload",
                digest,
                {"id": str(item.pk), "purpose": purpose, "size": len(clean), "width": width, "height": height},
            )
    except BaseException as error:
        if owned:
            for name in owned:
                try:
                    backend.delete(name)
                except Exception:
                    pass
        if not isinstance(error, Exception) or isinstance(error, (APIException, Http404)):
            raise
        raise StorageUnavailable() from None


def evidence_allowed(actor, order, purpose):
    """Delivery-refund proof also accepts the seller's logistics reporters."""
    caps = access.capabilities(actor, order)
    if purpose != "refund":
        return caps["claim"]
    return caps["refund"] and actor.context == "seller"


def permitted(actor, pk, case=None):
    image = get_object_or_404(m.Evidence.objects.filter(order__in=access.scope(actor)), pk=pk)
    caps = access.capabilities(actor, image.order)
    own_refund = (
        image.purpose == "refund" and actor.context == "seller"
        and image.creator_id == actor.account.pk and caps["refund"]
    )
    if not caps["evidence"] and not own_refund:
        raise NotFound()
    if actor.context == "staff":
        review = get_object_or_404(
            access.case_scope(actor), pk=case, order_id=image.order_id, kind__in=["payment", "correction", "refund"]
        )
        access.require_case(actor, review, "read_delivery_evidence")
        binding = getattr(image, "binding", None)
        if (
            not binding
            or review.kind == "payment"
            and binding.claim_id != review.claim_id
            or review.kind == "correction"
            and binding.correction_id != review.correction_id
            and binding.claim_id != review.correction.receipt.claim_id
            or review.kind == "refund"
            and binding.refund_id != review.refund_id
        ):
            raise NotFound()
    if getattr(image, "binding", None) is None and (
        actor.context not in {"buyer", "seller"}
        or image.creator_id != actor.account.pk
        or image.expires_at <= timezone.now()
    ):
        raise NotFound()
    return image


@transaction.atomic
def response(actor, pk, *, head=False, case=None):
    image = permitted(actor, pk, case)
    access.lock_order(actor, image.order_id)
    image = permitted(actor, pk, case)
    access.audit(
        actor,
        image,
        "delivery_evidence_head" if head else "delivery_evidence_read",
        "Scoped private provider receipt evidence",
    )
    result = image_response(image, head=head)
    result["Content-Disposition"] = 'inline; filename="delivery-evidence.jpg"'
    result["Accept-Ranges"] = "none"
    return result


def sweep_unbound(*, limit=10):
    from apps.foundation.images import sweep_unbound as expire

    expire(m.Evidence, "fulfilment", limit=limit)
