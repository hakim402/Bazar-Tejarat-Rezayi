"""Versioned session cart and single-consumption buyer merge."""

import uuid
import hashlib
from datetime import timedelta
from decimal import Decimal
from django.db import transaction
from django.utils import timezone
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import ValidationError, PermissionDenied
from apps.catalogue.models import Variant
from apps.inventory.validation import quantity
from apps.messaging.services import digest, CommandConflict
from apps.messaging.access import lock_actor
from apps.marketplace.queries import PublicGate
from .models import Cart, CartLine, CartCommand, MergeReceipt

SESSION_KEY = "rezayi_guest_cart"


def guest_key(request):
    value = getattr(request, "_commerce_guest_key", None) or request.COOKIES.get(SESSION_KEY)
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        return None


def guest_scope(request):
    """Public precondition fingerprint, never a replacement for the HttpOnly key."""
    key = guest_key(request)
    return hashlib.sha256(("guest-cart:" + str(key)).encode()).hexdigest() if key else None


def check_command_scope(request, actor, data):
    if actor:
        if "guest_scope" in data:
            raise ValidationError({"guest_scope": ["wrong_context"]})
    elif not guest_scope(request) or data.get("guest_scope") != guest_scope(request):
        raise CommandConflict()


MAX_LINES = 100


def guest(request, *, create=False):
    key = guest_key(request)
    row = (
        Cart.objects.filter(guest_key=key, consumed_by__isnull=True, expires_at__gt=timezone.now()).first()
        if key
        else None
    )
    if row is None and create:
        if not key:
            raise ValidationError({"cart": ["initialize_session"]})
        if Cart.objects.filter(guest_key=key).exists():
            # Rotation belongs only to explicit, browser-coordinated initialization.
            # A stale mutation must never emit a replacement cookie.
            raise CommandConflict()
        row, _ = Cart.objects.get_or_create(guest_key=key, defaults={"expires_at": timezone.now() + timedelta(days=30)})
    return row


def buyer(actor, *, create=False):
    if actor.context != "buyer":
        raise PermissionDenied()
    if create:
        return Cart.objects.get_or_create(account=actor.account)[0]
    return Cart.objects.filter(account=actor.account).first()


def public_variant(pk, locale="fa-AF"):
    variant = get_object_or_404(
        Variant.objects.select_related("unit", "product__published").filter(product__published__isnull=False), pk=pk
    )
    # Reject a private/inactive selection before touching any evidence storage.
    if not any(str(v["id"]) == str(pk) and v["active"] for v in variant.product.published.body["variants"]):
        from django.http import Http404

        raise Http404
    gate = PublicGate(locale, profile_ids=[variant.product.seller_id])
    get_object_or_404(gate.products, pk=variant.product_id)
    return variant


def projection(row, locale="fa-AF"):
    if row is None:
        return {"id": None, "version": 0, "lines": [], "guest_version": 0}
    lines = list(row.lines.select_related("variant__unit", "variant__product__published").order_by("pk"))
    gate = PublicGate(locale, profile_ids={x.variant.product.seller_id for x in lines})
    products = {p.pk: p for p in gate.products.filter(pk__in={x.variant.product_id for x in lines})}
    seller_names = {p.pk: p.public_name for p in gate.profiles}
    result = []
    for x in lines:
        v = x.variant
        p = products.get(v.product_id)
        available = bool(p and any(str(y["id"]) == str(v.pk) and y["active"] for y in p.published.body["variants"]))
        result.append(
            {
                "id": str(x.pk),
                "version": x.version,
                "variant": str(v.pk),
                "product": str(v.product_id),
                "seller": str(v.product.seller_id),
                "seller_name": seller_names.get(v.product.seller_id, "") if available else "",
                "sku": v.sku,
                "tier": x.tier,
                "quantity": format(x.quantity, ".3f"),
                "increment": format(v.quantity_increment, ".3f"),
                "minimum": format(v.minimum_wholesale, ".3f"),
                "unit": v.unit.code,
                "unit_label": v.unit.labels.get(locale, v.unit.labels.get("fa-AF", v.unit.code)),
                "title": p.public_title if available else "",
                "currency": v.product.currency,
                "mode": v.product.pricing_mode,
                "price": format(getattr(v, x.tier), ".2f") if available and getattr(v, x.tier) is not None else None,
                "available": available,
            }
        )
    return {
        "id": str(row.pk),
        "version": row.version,
        "lines": result,
        "guest_version": row.version if row.guest_key else 0,
    }


@transaction.atomic
def mutate(request, actor, data):
    check_command_scope(request, actor, data)
    if actor:
        lock_actor(actor)
        row = buyer(actor, create=True)
    else:
        row = guest(request, create=True)
    row = get_object_or_404(Cart.objects.select_for_update(), pk=row.pk)
    if row.consumed_by_id or row.guest_key and row.expires_at <= timezone.now():
        raise CommandConflict()
    hashed = digest(data)
    old = CartCommand.objects.filter(cart=row, key=data["command_id"]).first()
    if old:
        if old.digest != hashed:
            raise CommandConflict()
        if old.outcome.get("rejected"):
            raise CommandConflict()
        return old.outcome
    if row.version != data["version"]:
        raise CommandConflict()
    if data["action"] == "remove":
        line = get_object_or_404(row.lines, pk=data["line"])
        line.delete()
    else:
        variant = public_variant(data["variant"])
        amount = quantity(data["quantity"], variant)
        line = row.lines.filter(variant=variant, tier=data["tier"]).first()
        if line:
            line.quantity = amount
            line.version += 1
            line.save(update_fields=["quantity", "version"])
        else:
            if row.lines.count() >= MAX_LINES:
                raise ValidationError({"lines": ["limit"]})
            CartLine.objects.create(cart=row, variant=variant, tier=data["tier"], quantity=amount)
    row.version += 1
    if row.guest_key:
        row.expires_at = timezone.now() + timedelta(days=30)
    row.save()
    result = {"version": row.version}
    CartCommand.objects.create(cart=row, key=data["command_id"], digest=hashed, outcome=result)
    return result


@transaction.atomic
def merge(request, actor, data):
    lock_actor(actor)
    account = actor.account
    key = guest_key(request)
    target = buyer(actor, create=True)
    original = Cart.objects.filter(guest_key=key).first() if key else None
    if original is None:
        return {"merged": False, "version": target.version, "lines": 0}
    locked = {x.pk: x for x in Cart.objects.select_for_update().filter(pk__in=[original.pk, target.pk]).order_by("pk")}
    if original.pk not in locked:
        raise CommandConflict()
    original = locked[original.pk]
    target = locked[target.pk]
    receipt = MergeReceipt.objects.filter(guest=original).first()
    if receipt:
        if receipt.buyer_id != target.pk:
            raise CommandConflict()
        return receipt.outcome
    if original.expires_at <= timezone.now() or original.consumed_by_id:
        raise CommandConflict()
    if target.version != data["version"] or original.version != data["guest_version"]:
        raise CommandConflict()
    guest_lines = list(original.lines.select_related("variant__unit"))
    existing = {(x.variant_id, x.tier): x for x in target.lines.select_related("variant__unit")}
    if len(set(existing) | {(x.variant_id, x.tier) for x in guest_lines}) > MAX_LINES:
        raise ValidationError({"lines": ["limit"]})
    # Validate every aggregate BEFORE writing, retaining both original carts on failure.
    prepared = []
    for line in guest_lines:
        found = existing.get((line.variant_id, line.tier))
        amount = quantity(format(line.quantity + (found.quantity if found else Decimal(0)), ".3f"), line.variant)
        prepared.append((line, found, amount))
    for line, found, amount in prepared:
        if found:
            found.quantity = amount
            found.version += 1
            found.save(update_fields=["quantity", "version"])
        else:
            CartLine.objects.create(cart=target, variant=line.variant, tier=line.tier, quantity=amount)
    target.version += 1
    target.save()
    original.consumed_by = account
    original.version += 1
    original.save()
    result = {"merged": True, "version": target.version, "lines": len(guest_lines)}
    MergeReceipt.objects.create(guest=original, buyer=target, key=data["command_id"], outcome=result)
    # Retain consumed opaque cookie for buyer retry reconciliation. A subsequent
    # explicit guest initialization rotates it; it cannot contribute to another buyer.
    return result


@transaction.atomic
def expire_guests():
    ids = list(
        Cart.objects.select_for_update(skip_locked=True)
        .filter(account__isnull=True, consumed_by__isnull=True, expires_at__lte=timezone.now())
        .order_by("expires_at")
        .values_list("pk", flat=True)[:50]
    )
    return Cart.objects.filter(
        pk__in=ids, account__isnull=True, consumed_by__isnull=True, expires_at__lte=timezone.now()
    ).delete()[0]


def guest_initialized(request):
    key = guest_key(request)
    if key is None:
        return False
    row = Cart.objects.filter(guest_key=key).first()
    return row is None or (row.consumed_by_id is None and row.expires_at > timezone.now())


@transaction.atomic
def reconcile(request, actor, data):
    """Settle the original command under the mutation lock, fencing a late write.

    Absence alone is not proof of rejection: append an immutable rejection before
    allowing a replacement command. A request racing this operation either commits
    first or sees this fence; it can never add a second contribution afterward.
    """
    check_command_scope(request, actor, data)
    if actor:
        lock_actor(actor)
        row = buyer(actor, create=True)
    else:
        key = guest_key(request)
        if key is None:
            raise CommandConflict()
        row = Cart.objects.filter(guest_key=key).first()
        if row is None:
            row = guest(request, create=True)
    row = get_object_or_404(Cart.objects.select_for_update(), pk=row.pk)
    hashed = digest(data) if "action" in data else None
    old = CartCommand.objects.filter(cart=row, key=data["command_id"]).first()
    if old:
        if hashed is not None and old.digest != hashed:
            raise CommandConflict()
        return {"state": "rejected" if old.outcome.get("rejected") else "applied", "version": old.outcome["version"]}
    if row.consumed_by_id or row.guest_key and row.expires_at <= timezone.now():
        raise CommandConflict()
    CartCommand.objects.create(
        cart=row, key=data["command_id"], digest=hashed or "0" * 64, outcome={"version": row.version, "rejected": True}
    )
    return {"state": "rejected", "version": row.version}
