"""Only accepted goods; financial visibility never grants a general stock explorer."""

from decimal import Decimal
from django.shortcuts import get_object_or_404
from apps.inventory.models import Bucket
from apps.inventory.services import expired, active
from . import access


def selection(actor, pk, *, page=1):
    order = get_object_or_404(access.scope(actor, write=True), pk=pk)
    if not access.capabilities(actor, order)["selection"]:
        from rest_framework.exceptions import PermissionDenied

        raise PermissionDenied()
    from apps.orders.aftercare import effective_lines

    goods = list(order.lines.select_related("variant__unit").order_by("variant_id", "pk"))
    demand = {}
    for item in effective_lines(order):
        key = str(item["line"].variant_id)
        demand[key] = demand.get(key, Decimal(0)) + item["quantity"]
    qs = (
        Bucket.objects.filter(position_id__in=demand)
        .select_related("batch", "position__variant__unit", "position__variant__product__published")
        .order_by("position_id", "pk")
    )
    rows = list(qs[(page - 1) * 50 : page * 50])
    return {
        "maximum_buckets": 100,
        "count": qs.count(),
        "page": page,
        "goods": [
            {
                "variant": key,
                "quantity": format(value, ".3f"),
                "sku": next(x.snapshot.get("sku", "") for x in goods if str(x.variant_id) == key),
                "unit": next(x.snapshot.get("unit", "") for x in goods if str(x.variant_id) == key),
                "increment": format(
                    next(x.variant.quantity_increment for x in goods if str(x.variant_id) == key), ".3f"
                ),
            }
            for key, value in demand.items()
        ],
        "results": [
            {
                "bucket": str(x.pk),
                "variant": str(x.position_id),
                "batch": str(x.batch_id) if x.batch_id else None,
                "code": x.batch.code if x.batch_id else "",
                "expires_on": x.batch.expires_on if x.batch_id else None,
                "available": format(
                    max(x.physical - x.held, Decimal(0))
                    if not expired(x) and active(x.position.variant)
                    else Decimal(0),
                    ".3f",
                ),
                "eligible": not expired(x) and active(x.position.variant),
            }
            for x in rows
        ],
    }
