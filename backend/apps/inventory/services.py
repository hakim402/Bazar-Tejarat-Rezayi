"""Atomic stock operations. Trusted allocation callers remain Python-only, without HTTP shortcuts."""

from apps.runtime.locks import lock as durable_lock
from apps.runtime.locks import row_options

import hashlib
import json
from datetime import datetime
from decimal import Decimal
from zoneinfo import ZoneInfo
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from apps.catalogue.models import Variant, Product
from apps.catalogue.validation import fail, text
from apps.organizations.access import Conflict
from . import access, validation as v
from .models import Position, Batch, Bucket, Movement, Operation, Allocation, AllocationLine, Shortage, Recovery

ZERO = Decimal("0.000")


def today(now=None):
    now = now or timezone.now()
    if not isinstance(now, datetime) or timezone.is_naive(now):
        raise ValueError("An aware clock is required.")
    return now.astimezone(ZoneInfo("Asia/Kabul")).date()


def clock(now=None):
    value = now or timezone.now()
    today(value)
    return value


def expired(bucket, now=None):
    return bucket.batch_id is not None and bucket.batch.expires_on is not None and bucket.batch.expires_on < today(now)


def active(variant):
    item = variant.product
    return bool(
        item.published_id
        and any(str(row["id"]) == str(variant.pk) and row["active"] for row in item.published.body["variants"])
    )


def fingerprint(action, profile, payload):
    return hashlib.sha256(
        json.dumps([action, str(profile), payload], sort_keys=True, default=str, separators=(",", ":")).encode()
    ).hexdigest()


def previous(actor, profile, action, data):
    if "reference" in data:
        text(data["reference"], "reference", 120, optional=True)
    token = v.identifier(data.get("token"), "token")
    digest = fingerprint(action, profile.pk, data)
    # Advisory token lock also serializes a globally reused token across different seller profiles.
    durable_lock(int(token.hex[:15], 16))
    old = Operation.objects.filter(pk=token).first()
    if old:
        if old.seller_id != profile.pk or old.action != action or old.fingerprint != digest:
            raise Conflict("Idempotency identity was already used for a different operation.")
        return token, digest, old.result
    reference = data.get("reference", "")
    if reference and Operation.objects.filter(seller=profile, action=action, reference=reference).exists():
        raise Conflict("This logical stock event has already been recorded.")
    return token, digest, None


def record(actor, profile, action, data, token, digest, result, changes=()):
    operation = Operation.objects.create(
        id=token,
        seller=profile,
        action=action,
        reference=data.get("reference", ""),
        fingerprint=digest,
        actor=actor.user,
        account=actor.account,
        context=actor.context,
        reason=v.reason(data.get("reason")),
        result=result,
        parameters=json.loads(json.dumps(data, default=str)),
    )
    for bucket, physical, held in changes:
        before_physical, before_held = bucket.physical, bucket.held
        bucket.physical += physical
        bucket.held += held
        if not ZERO <= bucket.held <= bucket.physical <= v.MAX:
            fail("quantity", "insufficient_quantity")
        bucket.save(update_fields=["physical", "held"])
        Movement.objects.create(
            operation=operation,
            bucket=bucket,
            physical_delta=physical,
            held_delta=held,
            physical_after=before_physical + physical,
            held_after=before_held + held,
        )
    return operation


def locked_variant(profile, pk):
    item = get_object_or_404(Variant.objects.select_related("unit"), pk=pk, product__seller=profile)
    Product.objects.select_for_update().get(pk=item.product_id)
    return Variant.objects.select_related("unit", "product__published").select_for_update(**row_options()).get(pk=item.pk)


def version(position, submitted):
    expected = position.version if position else 0
    if type(submitted) is not int or submitted != expected:
        raise Conflict()


def bump(position):
    position.version += 1
    position.save(update_fields=["version"])


@transaction.atomic
def configure(actor, profile_id, variant_id, data):
    # Token precedes business/position locks consistently, including cross-profile misuse.
    token_id = v.identifier(data.get("token"), "token")
    durable_lock(int(token_id.hex[:15], 16))
    profile = access.lock_profile(actor, profile_id, True)
    data = {**data, "variant": str(variant_id)}
    token, digest, old = previous(actor, profile, "configure", data)
    if old is not None:
        return old
    variant = locked_variant(profile, variant_id)
    position = Position.objects.select_for_update().filter(pk=variant.pk).first()
    version(position, data.get("version"))
    tracking = data.get("tracking")
    required = data.get("expiry_required")
    if tracking not in {"plain", "batch"} or type(required) is not bool or required and tracking != "batch":
        fail("tracking")
    threshold = (
        None if data.get("threshold") in (None, "") else v.quantity(data["threshold"], variant, "threshold", zero=True)
    )
    if (
        position
        and Movement.objects.filter(bucket__position=position).exists()
        and (position.tracking != tracking or position.expiry_required != required)
    ):
        raise Conflict("Tracking and expiry policy are frozen after the first movement.")
    if position is None:
        position = Position.objects.create(
            variant=variant, tracking=tracking, expiry_required=required, threshold=threshold
        )
        if tracking == "plain":
            Bucket.objects.create(position=position)
    else:
        if position.tracking != tracking:
            # Only an empty internal non-batch bucket may be retired; no historical batches are removed.
            if position.batches.exists():
                raise Conflict("Recorded batch identities preserve their tracking policy.")
            position.buckets.filter(batch__isnull=True, physical=0, held=0).delete()
            if tracking == "plain":
                Bucket.objects.create(position=position)
        position.tracking, position.expiry_required, position.threshold = tracking, required, threshold
        position.version += 1
        position.save()
    result = {"operation": str(token), "status": "completed", "version": position.version}
    record(actor, profile, "configure", data, token, digest, result)
    return result


@transaction.atomic
def manual(actor, profile_id, variant_id, data, *, adjustment=False, now=None):
    token_id = v.identifier(data.get("token"), "token")
    durable_lock(int(token_id.hex[:15], 16))
    profile = access.lock_profile(actor, profile_id, True)
    action = "adjust" if adjustment else "receive"
    # Include the variant in idempotency scope even when two variants share the same payload.
    payload = {**data, "variant": str(variant_id)}
    token, digest, old = previous(actor, profile, action, payload)
    if old is not None:
        return old
    variant = locked_variant(profile, variant_id)
    position = get_object_or_404(Position.objects.select_for_update(), pk=variant.pk)
    version(position, data.get("version"))
    quantity = v.quantity(data.get("quantity"), variant, signed=adjustment)
    batch = None
    if position.tracking == "batch":
        if data.get("batch"):
            if any(data.get(key) not in (None, "") for key in ("batch_code", "expires_on")):
                fail("batch", "immutable_batch")
            batch = get_object_or_404(Batch, pk=v.identifier(data["batch"], "batch"), position=position)
        elif adjustment:
            fail("batch", "required")
        else:
            code = text(data.get("batch_code"), "batch_code", 80)
            expires_on = v.expiry(data.get("expires_on"))
            if position.expiry_required and expires_on is None:
                fail("expires_on", "required")
            if Batch.objects.filter(position=position, code=code).exists():
                fail("batch_code", "duplicate")
            batch = Batch.objects.create(position=position, code=code, expires_on=expires_on)
            Bucket.objects.create(position=position, batch=batch)
    elif any(data.get(k) not in (None, "") for k in ("batch", "batch_code", "expires_on")):
        fail("batch", "tracking")
    bucket = Bucket.objects.select_related("batch").select_for_update(**row_options()).get(position=position, batch=batch)
    now = clock(now)
    if not adjustment and expired(bucket, now):
        fail("expires_on", "expired")
    if not ZERO <= bucket.held <= bucket.physical + quantity <= v.MAX:
        fail("quantity", "insufficient_quantity")
    bump(position)
    result = {"operation": str(token), "status": "completed", "version": position.version}
    record(actor, profile, action, payload, token, digest, result, [(bucket, quantity, ZERO)])
    return result


def normalize_lines(lines):
    if not isinstance(lines, list) or not 1 <= len(lines) <= 100:
        fail("lines", "length")
    result = []
    seen = set()
    for index, row in enumerate(lines):
        if not isinstance(row, dict) or set(row) - {"variant", "batch", "quantity"}:
            fail(f"lines.{index}")
        variant = v.identifier(row.get("variant"), f"lines.{index}.variant")
        batch = None if row.get("batch") is None else v.identifier(row["batch"], f"lines.{index}.batch")
        if (variant, batch) in seen:
            fail(f"lines.{index}", "duplicate")
        seen.add((variant, batch))
        result.append((index, variant, batch, row.get("quantity")))
    return sorted(result, key=lambda x: (str(x[1]), str(x[2])))


def selected(profile, lines, now=None):
    variants = {}
    for _, pk, _, _ in lines:
        if pk not in variants:
            variants[pk] = locked_variant(profile, pk)
    positions = {p.pk: p for p in Position.objects.select_for_update().filter(pk__in=variants).order_by("pk")}
    buckets = list(
        Bucket.objects.filter(position__in=positions)
        .select_related("batch")
        .select_for_update(**row_options())
        .order_by("position_id", "pk")
    )
    now = clock(now)
    changes, shortages = [], []
    for index, variant_id, batch_id, raw in lines:
        variant = variants[variant_id]
        quantity = v.quantity(raw, variant, f"lines.{index}.quantity")
        position = positions.get(variant_id)
        bucket = next((b for b in buckets if b.position_id == variant_id and b.batch_id == batch_id), None)
        if position and ((position.tracking == "batch") != (batch_id is not None)):
            fail(f"lines.{index}.batch", "tracking")
        if batch_id is not None and not Batch.objects.filter(pk=batch_id, position_id=variant_id).exists():
            fail(f"lines.{index}.batch", "scope")
        available = ZERO if not bucket or expired(bucket, now) or not active(variant) else bucket.physical - bucket.held
        if available < quantity:
            shortages.append(
                {
                    "variant": str(variant_id),
                    "batch": str(batch_id) if batch_id else None,
                    "sku": variant.sku,
                    "unit": variant.unit.code,
                    "unit_labels": variant.unit.labels,
                    "requested": format(quantity, ".3f"),
                    "available": format(available, ".3f"),
                }
            )
        elif bucket:
            changes.append((bucket, quantity))
    return positions, changes, shortages


@transaction.atomic
def allocate(actor, profile_id, data, *, cod=False, now=None):
    """Trusted Python caller only. reference identifies a whole advance/COD stock event."""
    token_id = v.identifier(data.get("token"), "token")
    durable_lock(int(token_id.hex[:15], 16))
    profile = access.lock_profile(actor, profile_id)
    action = "cod" if cod else "reserve"
    data = {**data, "reference": text(data.get("reference"), "reference", 120)}
    token, digest, old = previous(actor, profile, action, data)
    if old is not None:
        return old
    recovery = None
    if data.get("recovery_of"):
        recovery = get_object_or_404(
            Shortage.objects.select_for_update(),
            pk=v.identifier(data["recovery_of"], "recovery_of"),
            operation__seller=profile,
        )
        if recovery.operation.reference == data["reference"]:
            raise Conflict("Recovery requires a new logical reference.")
    recovery_root = recovery
    while recovery_root and recovery_root.recovery_of_id:
        recovery_root = recovery_root.recovery_of
    if recovery:
        if (
            Recovery.objects.filter(shortage=recovery_root).exists()
            or recovery.operation.action != action
            or recovery.operation.parameters.get("lines") != data.get("lines")
        ):
            raise Conflict("Recovery must retain the original selection and cannot repeat a completed recovery.")
    return _apply_allocation(actor, profile, action, data, token, digest, recovery=recovery, now=now)


def _apply_allocation(identity, profile, action, data, token, digest, *, recovery=None, now=None):
    """Shared accounting only; manual or sealed payment intent authorizes its caller."""
    cod = action == "cod"
    recovery_root = recovery
    while recovery_root and recovery_root.recovery_of_id:
        recovery_root = recovery_root.recovery_of
    lines = normalize_lines(data.get("lines"))
    positions, changes, shortages = selected(profile, lines, now)
    result = {"operation": str(token), "status": "shortage" if shortages else "completed"}
    if recovery:
        result["recovery_of"] = str(recovery.pk)
    allocation = None
    shortage_id = None
    if shortages:
        import uuid

        shortage_id = uuid.uuid4()
        result["shortage"] = str(shortage_id)
        result["lines"] = shortages
    elif not cod:
        import uuid

        allocation = uuid.uuid4()
        result["allocation"] = str(allocation)
    operation = record(
        identity,
        profile,
        action,
        data,
        token,
        digest,
        result,
        [] if shortages else [(b, -q if cod else ZERO, ZERO if cod else q) for b, q in changes],
    )
    if shortages:
        Shortage.objects.create(id=shortage_id, operation=operation, lines=shortages, recovery_of=recovery)
    else:
        if recovery:
            Recovery.objects.create(shortage=recovery_root, operation=operation)
        for position in positions.values():
            bump(position)
        if allocation:
            group = Allocation.objects.create(id=allocation, operation=operation)
            for bucket, quantity in changes:
                AllocationLine.objects.create(allocation=group, bucket=bucket, quantity=quantity)
    return result


@transaction.atomic
def settle(actor, profile_id, allocation_id, data, *, release=False, now=None):
    token_id = v.identifier(data.get("token"), "token")
    durable_lock(int(token_id.hex[:15], 16))
    profile = access.lock_profile(actor, profile_id)
    action = "release" if release else "consume"
    payload = {**data, "allocation": str(allocation_id)}
    token, digest, old = previous(actor, profile, action, payload)
    if old is not None:
        return old
    group = get_object_or_404(Allocation.objects.select_for_update(), pk=allocation_id, operation__seller=profile)
    if group.state != "held":
        raise Conflict("This allocation is no longer held.")
    rows = list(
        group.lines.select_related(
            "bucket__batch", "bucket__position__variant__unit", "bucket__position__variant__product__published"
        ).order_by("bucket__position_id", "bucket_id")
    )
    ids = sorted({row.bucket.position_id for row in rows}, key=str)
    current_variants = {pk: locked_variant(profile, pk) for pk in ids}
    positions = list(Position.objects.select_for_update().filter(pk__in=ids).order_by("pk"))
    buckets = {
        b.pk: b
        for b in Bucket.objects.select_related("batch")
        .select_for_update(**row_options())
        .filter(pk__in=[r.bucket_id for r in rows])
        .order_by("pk")
    }
    now = clock(now)
    if not release and any(
        expired(buckets[row.bucket_id], now) or not active(current_variants[row.bucket.position_id]) for row in rows
    ):
        fail("allocation", "expired_or_inactive")
    result = {"operation": str(token), "status": "released" if release else "consumed", "allocation": str(group.pk)}
    record(
        actor,
        profile,
        action,
        payload,
        token,
        digest,
        result,
        [(buckets[row.bucket_id], ZERO if release else -row.quantity, -row.quantity) for row in rows],
    )
    group.state = result["status"]
    group.save(update_fields=["state"])
    for position in positions:
        bump(position)
    return result


@transaction.atomic
def availability(actor, profile_id, lines, *, now=None):
    profile = access.lock_profile(actor, profile_id)
    _, _, shortages = selected(profile, normalize_lines(lines), now)
    return {"available": not shortages, "lines": shortages}
