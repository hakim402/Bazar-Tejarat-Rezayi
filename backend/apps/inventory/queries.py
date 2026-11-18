"""Private scoped projections. Quantities are never summed across units."""

from datetime import timedelta
from decimal import Decimal
from django.db.models import Prefetch, OuterRef, Subquery, Sum, Case, When, Value, F, Q, DecimalField, BooleanField
from django.db.models.functions import Coalesce
from django.shortcuts import get_object_or_404
from apps.catalogue.models import Variant, SourceRevision, Product
from apps.catalogue.queries import image_url
from apps.catalogue.validation import fail
from apps.verification.models import ReviewCase
from apps.organizations.access import visible_profiles
from . import access
from .models import Bucket, Movement, Shortage
from .services import expired, expiring, active, clock, today, EXPIRING_DAYS


def profiles(actor):
    visible = list(visible_profiles(actor))
    statuses = {
        (case["profile_id"], case["revision"]): case["status"]
        for case in ReviewCase.objects.filter(profile__in=visible).values("profile_id", "revision", "status")
    }
    return [
        {
            "id": str(p.pk),
            "name": p.display_name,
            "kind": p.kind,
            "verification": statuses.get((p.pk, p.revision), "draft"),
            "capabilities": access.capabilities(actor, p),
        }
        for p in visible
    ]


def variants(profile):
    return (
        Variant.objects.filter(product__seller=profile)
        .select_related("unit", "product__published", "stock_position")
        .annotate(
            stock_title=Subquery(
                SourceRevision.objects.filter(product_id=OuterRef("product_id"))
                .order_by("-number")
                .values("body__title")[:1]
            ),
            stock_cover=Subquery(
                SourceRevision.objects.filter(product_id=OuterRef("product_id"))
                .order_by("-number")
                .values("body")[:1]
            ),
        )
        .prefetch_related(
            Prefetch("stock_position__buckets", queryset=Bucket.objects.select_related("batch").order_by("pk"))
        )
    )


def _active_variant_ids(profile):
    """Published-body eligibility, read once instead of rescanning every variant."""
    ids = set()
    for product in Product.objects.filter(seller=profile, published__isnull=False).select_related("published"):
        for row in product.published.body["variants"]:
            if row["active"]:
                ids.add(str(row["id"]))
    return ids


def position_data(variant, caps, *, detail=False, now=None):
    now = clock(now)
    position = getattr(variant, "stock_position", None)
    buckets = list(position.buckets.all()) if position else []
    physical = sum((b.physical for b in buckets), Decimal(0))
    held = sum((b.held for b in buckets), Decimal(0))
    expired_quantity = sum((b.physical for b in buckets if expired(b, now)), Decimal(0))
    expiring_quantity = sum((b.physical for b in buckets if expiring(b, now)), Decimal(0))
    eligible = active(variant)
    available = (
        sum((b.physical - b.held for b in buckets if not expired(b, now)), Decimal(0)) if eligible else Decimal(0)
    )
    status = (
        "unconfigured"
        if not position
        else "inactive"
        if not eligible
        else "zero"
        if available == 0
        else "low"
        if position.threshold is not None and available <= position.threshold
        else "available"
    )
    images = (variant.stock_cover.get("images", []) if isinstance(variant.stock_cover, dict) else []) if caps["write"] else []
    if not images and variant.product.published_id:
        images = variant.product.published.body.get("images", [])
    result = {
        "id": str(variant.pk),
        "product": str(variant.product_id),
        "title": (
            variant.product.published.body["title"]
            if not caps["write"] and variant.product.published_id
            else variant.stock_title
        )
        or variant.sku,
        "sku": variant.sku,
        "image": image_url(images[0]["id"], "seller" if caps["write"] else None) if images else None,
        "unit": variant.unit.code,
        "unit_labels": variant.unit.labels,
        "increment": format(variant.quantity_increment, ".3f"),
        "eligible": eligible,
        "configured": position is not None,
        "tracking": position.tracking if position else None,
        "expiry_required": position.expiry_required if position else False,
        "version": position.version if position else 0,
        "threshold": format(position.threshold, ".3f") if position and position.threshold is not None else None,
        "physical": format(physical, ".3f"),
        "held": format(held, ".3f"),
        "expired": format(expired_quantity, ".3f"),
        "expiring": format(expiring_quantity, ".3f"),
        "available": format(available, ".3f") if position else None,
        "state": status,
        "capabilities": caps,
    }
    if detail:
        result["batches"] = [
            {
                "id": str(b.batch_id),
                "code": b.batch.code,
                "expires_on": b.batch.expires_on,
                "physical": format(b.physical, ".3f"),
                "held": format(b.held, ".3f"),
                "expired": expired(b, now),
                "expiring": expiring(b, now),
                "available": format(b.physical - b.held if eligible and not expired(b, now) else Decimal(0), ".3f"),
            }
            for b in buckets
            if b.batch_id
        ]
    return result


def filters(params, allowed=None):
    allowed = allowed or {"seller", "q", "state", "sort", "page", "locale"}
    if set(params) - allowed or any(len(params.getlist(k)) != 1 for k in params):
        fail("filters")
    q = params.get("q", "").strip()
    if len(q) > 100 or any(ord(c) < 32 for c in q):
        fail("q")
    state, sort = params.get("state", ""), params.get("sort", "sku")
    if state not in {"", "unconfigured", "inactive", "zero", "low", "available", "expired", "expiring", "held"} or sort not in {
        "sku",
        "-sku",
        "available",
        "-available",
    }:
        fail("filters")
    try:
        page = int(params.get("page", "1"))
        if not 1 <= page <= 10000:
            raise ValueError
    except (ValueError, TypeError):
        fail("page")
    return q, state, sort, page


def overview(actor, profile_id, params):
    profile = access.authorize(actor, profile_id)
    caps = access.capabilities(actor, profile)
    q, state, sort, page = filters(params)
    base = variants(profile)
    if q:
        title_match = Q(stock_title__icontains=q) if caps["write"] else Q(product__published__body__title__icontains=q)
        base = base.filter(Q(sku__icontains=q) | title_match)
    now = clock()
    day = today(now)
    horizon = day + timedelta(days=EXPIRING_DAYS)
    active_ids = _active_variant_ids(profile)
    money = DecimalField(max_digits=24, decimal_places=3)
    zero = Value(Decimal(0))
    bucket = "stock_position__buckets"
    expired_on = Q(**{f"{bucket}__batch__expires_on__lt": day})
    expiring_on = Q(
        **{
            f"{bucket}__batch__expires_on__gte": day,
            f"{bucket}__batch__expires_on__lte": horizon,
            f"{bucket}__physical__gt": 0,
        }
    )
    # Bucket totals aggregate in the DB; state/count/filter/sort stay exact in Python
    # over lightweight rows, and full position_data is built only for the page.
    light = list(
        base.annotate(
            held_sum=Coalesce(Sum(f"{bucket}__held"), zero, output_field=money),
            expired_sum=Coalesce(
                Sum(Case(When(expired_on, then=F(f"{bucket}__physical")), default=zero, output_field=money)),
                zero,
                output_field=money,
            ),
            expiring_sum=Coalesce(
                Sum(Case(When(expiring_on, then=F(f"{bucket}__physical")), default=zero, output_field=money)),
                zero,
                output_field=money,
            ),
            available_raw=Coalesce(
                Sum(
                    Case(
                        When(expired_on, then=zero),
                        default=F(f"{bucket}__physical") - F(f"{bucket}__held"),
                        output_field=money,
                    )
                ),
                zero,
                output_field=money,
            ),
            configured=Case(
                When(stock_position__isnull=True, then=Value(False)), default=Value(True), output_field=BooleanField()
            ),
        ).values(
            "pk", "sku", "product_id", "held_sum", "expired_sum", "expiring_sum", "available_raw",
            "configured", "stock_position__threshold",
        )
    )
    rows = []
    for r in light:
        eligible = str(r["pk"]) in active_ids
        available = r["available_raw"] if eligible else Decimal(0)
        threshold = r["stock_position__threshold"]
        status = (
            "unconfigured"
            if not r["configured"]
            else "inactive"
            if not eligible
            else "zero"
            if available == 0
            else "low"
            if threshold is not None and available <= threshold
            else "available"
        )
        rows.append(
            {
                "id": r["pk"], "sku": r["sku"], "product": r["product_id"], "state": status,
                "eligible": eligible, "available": available,
                "expired": r["expired_sum"], "expiring": r["expiring_sum"], "held": r["held_sum"],
            }
        )
    # Fulfilment-only grants do not reveal private draft variants/descriptions.
    if not caps["write"]:
        rows = [r for r in rows if r["eligible"]]
    counts = {
        "variants": len(rows), "unconfigured": 0, "zero": 0, "low": 0, "expired": 0, "expiring": 0, "held": 0,
        "inactive": 0,
    }
    for row in rows:
        if row["state"] in {"unconfigured", "zero", "inactive"}:
            counts[row["state"]] += 1
        counts["low"] += int(row["state"] == "low")
        counts["expired"] += int(row["expired"] > 0)
        counts["expiring"] += int(row["expiring"] > 0)
        counts["held"] += int(row["held"] > 0)
    if state in {"expired", "expiring", "held"}:
        rows = [r for r in rows if r[state] > 0]
    elif state:
        rows = [r for r in rows if r["state"] == state]
    rows.sort(
        key=lambda r: ((r["available"] if "available" in sort else r["sku"].casefold()), str(r["id"])),
        reverse=sort.startswith("-"),
    )
    page_ids = [r["id"] for r in rows[(page - 1) * 20 : page * 20]]
    fetched = {v.pk: v for v in variants(profile).filter(pk__in=page_ids)}
    return {
        "results": [position_data(fetched[pk], caps, now=now) for pk in page_ids],
        "count": len(rows),
        "page": page,
        "page_size": 20,
        "counts": counts,
        "catalogue_count": Product.objects.filter(seller=profile).count()
        if caps["write"]
        else len({r["product"] for r in rows}),
        "capabilities": caps,
        "recent": movement_rows(_movement_base(profile, caps).order_by("-created_at", "-id")[:5]),
    }


def detail(actor, profile_id, pk):
    profile = access.authorize(actor, profile_id)
    caps = access.capabilities(actor, profile)
    variant = get_object_or_404(variants(profile), pk=pk)
    if not caps["write"] and not active(variant):
        from django.http import Http404

        raise Http404
    result = position_data(variant, caps, detail=True)
    result["movements"] = movement_rows(
        Movement.objects.filter(bucket__position_id=pk)
        .select_related("operation__actor", "bucket__position__variant__unit", "bucket__batch")
        .order_by("-created_at", "-id")[:20]
    )
    return result


def movement_rows(base):
    return [
        {
            "id": str(m.pk),
            "variant": str(m.bucket.position_id),
            "batch": str(m.bucket.batch_id) if m.bucket.batch_id else None,
            "sku": m.bucket.position.variant.sku,
            "unit": m.bucket.position.variant.unit.code,
            "unit_labels": m.bucket.position.variant.unit.labels,
            "action": m.operation.action,
            "physical_delta": format(m.physical_delta, ".3f"),
            "held_delta": format(m.held_delta, ".3f"),
            "physical_after": format(m.physical_after, ".3f"),
            "held_after": format(m.held_after, ".3f"),
            "reason": m.operation.reason,
            "actor": m.operation.actor.display_name,
            "reference": m.operation.reference,
            "operation": str(m.operation_id),
            "at": m.created_at.isoformat(),
        }
        for m in base
    ]


def _movement_base(profile, caps):
    base = Movement.objects.filter(operation__seller=profile).select_related(
        "operation__actor", "bucket__position__variant__unit", "bucket__batch"
    )
    if not caps["write"]:
        base = base.filter(bucket__position_id__in=_active_variant_ids(profile))
    return base


def history(actor, profile_id, params):
    profile = access.authorize(actor, profile_id)
    caps = access.capabilities(actor, profile)
    from django.http import QueryDict

    params = QueryDict("") if not params else params
    q, _, _, page = filters(params, {"seller", "q", "page", "action", "variant", "batch", "locale"})
    base = _movement_base(profile, caps)
    if q:
        base = base.filter(Q(bucket__position__variant__sku__icontains=q) | Q(operation__reason__icontains=q))
    if params.get("variant"):
        from .validation import identifier

        base = base.filter(bucket__position_id=identifier(params["variant"], "variant"))
    if params.get("batch"):
        from .validation import identifier

        base = base.filter(bucket__batch_id=identifier(params["batch"], "batch"))
    if params.get("action"):
        if params["action"] not in {"receive", "adjust", "reserve", "consume", "release", "cod"}:
            fail("action")
        base = base.filter(operation__action=params["action"])
    return {
        "results": movement_rows(base.order_by("-created_at", "-id")[(page - 1) * 20 : page * 20]),
        "count": base.count(),
        "page": page,
        "page_size": 20,
    }


def shortages(actor, pk=None, params=None):
    access.staff(actor, "read_shortages")
    base = Shortage.objects.select_related("operation__seller").order_by("-operation__created_at", "-id")
    page = 1
    if params:
        _, _, _, page = filters(params, {"page"})
    if pk:
        base = [get_object_or_404(base, pk=pk)]
        count = 1
    else:
        count = base.count()
        base = base[(page - 1) * 20 : page * 20]
    return {
        "results": [
            {
                "id": str(s.pk),
                "seller": s.operation.seller.display_name,
                "reference": s.operation.reference,
                "at": s.operation.created_at.isoformat(),
                "lines": s.lines,
                "recovery_of": str(s.recovery_of_id) if s.recovery_of_id else None,
            }
            for s in base
        ],
        "count": count,
        "page": page,
        "page_size": 20,
    }
