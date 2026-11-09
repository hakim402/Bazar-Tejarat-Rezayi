"""Private order/author-bound image staging. No stored keys escape the service."""

import hashlib
import uuid
from datetime import timedelta
from django.http import Http404
from django.core.files.storage import storages
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import APIException, PermissionDenied, NotFound
from apps.catalogue.media import StorageUnavailable
from apps.foundation.images import stage_image
from apps.messaging.media import decode, response as image_response
from apps.runtime.locks import lock
from . import access, services, validation as v
from .models import Evidence


def upload(actor, pk, key, file):
    owned = []
    backend = storages["private_local"]
    try:
        with transaction.atomic():
            lock("payments-command:" + str(key))
            order = access.lock_order(actor, pk, write=actor.context == "seller")
            if actor.context not in {"buyer", "seller"} or not access.capabilities(actor, order)["evidence"]:
                raise PermissionDenied()
            raw, data, width, height = decode(file)
            digest = v.digest("upload", pk, {"sha256": hashlib.sha256(raw).hexdigest()})
            old = services.previous(actor, order, key, "upload", digest)
            if old:
                return old
            image_id = uuid.uuid4()
            owned.append(f"payments/{image_id.hex}.jpg")
            written = stage_image(data, "payments", image_id)
            item = Evidence.objects.create(
                id=image_id,
                order=order,
                creator=actor.account,
                key=written,
                sha256=hashlib.sha256(data).hexdigest(),
                size=len(data),
                width=width,
                height=height,
                expires_at=timezone.now() + timedelta(hours=24),
            )
            return services.command_result(
                actor,
                order,
                key,
                "upload",
                digest,
                {"id": str(item.pk), "width": width, "height": height, "size": len(data)},
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


def permitted(actor, pk, *, case=None):
    if actor.context in {"buyer", "seller"}:
        from apps.orders.disputes import requesters

        dispute_image = Evidence.objects.filter(
            pk=pk, binding__dispute__isnull=False, order__in=requesters(actor)
        ).first()
        if dispute_image is not None:
            return dispute_image
    item = get_object_or_404(Evidence.objects.filter(order__in=access.scope(actor)), pk=pk)
    order = item.order
    if actor.context in {"owner", "staff"}:
        if "read_payment_evidence" not in access.rights(actor):
            raise NotFound()
        if actor.context != "owner":
            current = get_object_or_404(access.case_scope(actor), pk=case, order=order)
            access.require_case(actor, current, "read_payment_evidence")
    elif not access.capabilities(actor, order)["evidence"]:
        raise NotFound()
    binding = getattr(item, "binding", None)
    if binding is None and (
        actor.context not in {"buyer", "seller"}
        or item.creator_id != actor.account.pk
        or item.expires_at <= timezone.now()
    ):
        raise NotFound()
    return item


@transaction.atomic
def response(actor, pk, *, head=False, case=None):
    preliminary = permitted(actor, pk, case=case)
    binding = getattr(preliminary, "binding", None)
    if actor.context in {"buyer", "seller"} and binding is not None and binding.dispute_id:
        from apps.orders.aftercare_commands import lock_order
        from apps.orders.disputes import requesters

        lock_order(actor, preliminary.order_id, requesters(actor))
    else:
        access.lock_order(actor, preliminary.order_id)
    item = permitted(actor, pk, case=case)
    if actor.context == "staff":
        current = get_object_or_404(access.case_scope(actor).select_for_update(), pk=case, order_id=item.order_id)
        access.require_case(actor, current, "read_payment_evidence")
    access.audit(actor, item, "payment_evidence_head" if head else "payment_evidence_read")
    result = image_response(item, head=head)
    # Deliberately ignore Range: always return the authorized whole object (200).
    result["Content-Disposition"] = 'inline; filename="payment-evidence.jpg"'
    result["Accept-Ranges"] = "none"
    return result


def sweep_unbound(*, limit=10):
    from apps.foundation.images import sweep_unbound as expire

    expire(Evidence, "payments", limit=limit)
