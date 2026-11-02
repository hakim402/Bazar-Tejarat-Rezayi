"""Internal coherent read-only stock check AFTER order authority and profile locks.
No fabricated seller actor, stock creation, reservation or batch disclosure.
"""

from apps.runtime.locks import row_options

from decimal import Decimal
from django.utils import timezone
from .models import Position, Bucket
from .services import expired


def available(quantities, *, now=None):
    now = now or timezone.now()
    positions = {p.pk: p for p in Position.objects.select_for_update().filter(pk__in=quantities).order_by("pk")}
    totals = {pk: Decimal(0) for pk in quantities}
    for bucket in (
        Bucket.objects.select_for_update(**row_options())
        .select_related("batch")
        .filter(position_id__in=quantities)
        .order_by("position_id", "pk")
        .iterator(chunk_size=500)
    ):
        if not expired(bucket, now):
            totals[bucket.position_id] += bucket.physical - bucket.held
    for pk, wanted in quantities.items():
        if pk not in positions:
            return "stock_unconfigured"
        if totals[pk] < wanted:
            return "stock_shortage"
    return ""
