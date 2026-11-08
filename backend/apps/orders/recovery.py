"""Historical aftercare snapshot validation; restored rows are loaded without guards."""

from decimal import Decimal
from django.db.models import Sum
from apps.runtime.transfer import TransferError
from . import models as m

ZERO = Decimal("0.00")


def validate_history():
    from apps.payments import models as p, queries as goods

    for head in m.Aftercare.objects.select_related("order").iterator(chunk_size=100):
        events = list(
            m.AftercareEvent.objects.filter(order_id=head.order_id).order_by("version").values_list("version", flat=True)
        )
        if events != list(range(1, head.version + 1)):
            raise TransferError("Restored aftercare publication/head is incomplete.")
    for request in m.CancellationRequest.objects.iterator(chunk_size=100):
        decision = m.CancellationDecision.objects.filter(request=request).first()
        decided = request.state in {"approved", "rejected"}
        if decided != (decision is not None) or (decided and decision.action != request.state):
            raise TransferError("Restored cancellation state differs from its retained decision.")
        if request.state != "approved":
            continue
        adjustment = m.InvoiceAdjustment.objects.filter(cancellation=request).first()
        if adjustment is None or adjustment.after_total != ZERO or adjustment.after_lines:
            raise TransferError("Restored approved cancellation lacks its zero-total invoice adjustment.")
        if decision.event_id != adjustment.event_id:
            raise TransferError("Restored cancellation decision differs from its invoice adjustment.")
    for amendment in m.Amendment.objects.select_related("order").iterator(chunk_size=100):
        decision = m.AmendmentDecision.objects.filter(amendment=amendment).first()
        decided = amendment.state in {"approved", "rejected"}
        if decided != (decision is not None) or (decided and decision.action != amendment.state):
            raise TransferError("Restored amendment state differs from its retained decision.")
        if amendment.state != "approved":
            continue
        adjustment = m.InvoiceAdjustment.objects.filter(amendment=amendment).first()
        if (
            adjustment is None or adjustment.after_total != amendment.after_total
            or adjustment.event_id != decision.event_id
        ):
            raise TransferError("Restored approved amendment differs from its adjusted accepted total.")
    for due in p.RefundDue.objects.select_related("order").iterator(chunk_size=100):
        if not p.RefundSeal.objects.filter(due=due).exists():
            raise TransferError("Restored refund due lacks its retained seal.")
        if due.currency != due.order.currency:
            raise TransferError("Restored refund due differs from the goods-order currency.")
    for order_id in p.RefundDue.objects.values_list("order_id", flat=True).distinct().order_by("order_id"):
        order = m.SellerOrder.objects.get(pk=order_id)
        dues = p.RefundDue.objects.filter(order_id=order_id).aggregate(value=Sum("amount"))["value"] or ZERO
        if dues > goods.confirmed(order):
            raise TransferError("Restored refund dues exceed confirmed received money.")
        reported = (
            p.RefundReport.objects.filter(due__order_id=order_id, decision__action="confirmed").aggregate(
                value=Sum("amount")
            )["value"]
            or ZERO
        )
        if reported > dues:
            raise TransferError("Restored confirmed refunds exceed their refund dues.")
