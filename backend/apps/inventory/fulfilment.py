"""Narrow accepted-order physical dispatch. No fabricated grant or stock HTTP shortcut."""

from django.db import connection
from apps.organizations.access import Conflict
from . import services as stock
from .payment_allocation import RecordedIdentity


def dispatch(actor, order, preparation, token, *, now=None):
    from apps.fulfilment import access, models as m, selection
    from apps.payments.queries import confirmed

    if not connection.in_atomic_block or not access.capabilities(actor, order)["dispatch"]:
        raise Conflict()
    if (
        not m.Preparation.objects.filter(pk=preparation.pk, order=order).exists()
        or m.Shipment.construction.filter(order=order).exists()
    ):
        raise Conflict()
    lines = [
        {
            "variant": str(row.variant_id),
            "batch": str(row.bucket.batch_id) if row.bucket.batch_id else None,
            "quantity": format(row.quantity, ".3f"),
        }
        for row in preparation.lines.select_related("bucket").order_by("variant_id", "bucket_id")
    ]
    selection.plan(order, lines, now=now)
    identity = RecordedIdentity(actor.user, access.account_for(actor), actor.context)
    action = "consume" if order.payment_method == "advance" else "cod"
    data = {
        "token": token,
        "reference": "fulfilment:" + str(order.pk) + ":" + str(token),
        "reason": "Whole accepted order physical dispatch",
    }
    if action == "consume":
        allocation = selection.held(order, locked=True)
        if confirmed(order) <= 0 or preparation.allocation_id != allocation.pk:
            raise Conflict("Positive goods funds and the original hold are required.")
        actual = {row.bucket_id: quantity for row, quantity in stock.remaining_lines(allocation)}
        selected = {row.bucket_id: row.quantity for row in preparation.lines.all()}
        if selected != actual:
            raise Conflict("Whole held stock must match the prepared selection.")
        data["allocation"] = str(allocation.pk)
        key, digest, old = stock.previous(identity, order.seller, action, data)
        return (
            old
            if old is not None
            else stock._apply_settlement(identity, order.seller, allocation.pk, data, key, digest, now=now)
        )
    data["lines"] = lines
    key, digest, old = stock.previous(identity, order.seller, action, data)
    return (
        old if old is not None else stock._apply_allocation(identity, order.seller, action, data, key, digest, now=now)
    )
