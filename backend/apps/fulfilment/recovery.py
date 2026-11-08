"""Historical snapshot validation; never evaluates today's grants as past authority."""

import hashlib
from decimal import Decimal
from django.core.files.storage import storages
from django.db.models import Sum
from apps.runtime.transfer import TransferError
from . import models as m, queries, selection


def validate_history():
    for state in m.State.objects.select_related("order").iterator(chunk_size=100):
        events = list(
            m.Event.objects.filter(order_id=state.order_id).order_by("version").values_list("version", flat=True)
        )
        if events != list(range(1, state.version + 1)):
            raise TransferError("Restored fulfilment publication/head is incomplete.")
        total = queries.delivery_total(state.order)
        if not Decimal(0) <= total <= Decimal("9999999999999999999999.99"):
            raise TransferError("Restored delivery money exceeds its exact bound.")
    if m.Event.construction.filter(publication__isnull=True).exists():
        raise TransferError("Restored fulfilment contains an unsealed event.")
    for shipment in m.Shipment.objects.select_related("order", "preparation", "charge").iterator(chunk_size=100):
        preparation = shipment.preparation
        if preparation.order_id != shipment.order_id or shipment.charge.order_id != shipment.order_id:
            raise TransferError("Restored shipment preparation/charge crosses order boundaries.")
        required = selection.demand(shipment.order)
        actual = dict(
            preparation.lines.values("variant_id")
            .annotate(quantity=Sum("quantity"))
            .values_list("variant_id", "quantity")
        )
        if actual != required:
            raise TransferError("Restored whole shipment demand differs from accepted quantities.")
        effect = "consume" if shipment.order.payment_method == "advance" else "cod"
        if shipment.operation.action != effect or not shipment.operation.movements.exists():
            raise TransferError("Restored shipment lacks its authoritative stock operation.")
        if (
            shipment.operation.movements.filter(stock_transition__isnull=True).exists()
            or shipment.operation.movements.filter(stock_transition__pending=True).exists()
        ):
            raise TransferError("Restored shipment lacks sealed native stock-transition proof.")
    for receipt in m.Receipt.objects.select_related("claim").iterator(chunk_size=100):
        if not m.ClaimDecision.objects.filter(claim=receipt.claim, event=receipt.event, action="confirmed").exists():
            raise TransferError("Restored provider receipt differs from its exact claim decision.")
    for completion in m.Completion.objects.select_related("delivery").iterator(chunk_size=100):
        if completion.delivery.order_id != completion.order_id or completion.event.action != "completed":
            raise TransferError("Restored initial completion provenance differs.")
    for decision in m.DeliveryRefundDecision.objects.select_related("refund", "event").iterator(chunk_size=100):
        expected = "case_approve" if decision.action == "confirmed" else "case_reject"
        if decision.refund.order_id != decision.order_id or decision.event.action != expected:
            raise TransferError("Restored delivery refund decision differs from its retained review event.")
    for refund in m.DeliveryRefund.objects.select_related("order", "provider").iterator(chunk_size=100):
        if queries.confirmed_refunds(refund.order, refund.provider) > queries.provider_receipts(
            refund.order, refund.provider
        ):
            raise TransferError("Restored confirmed delivery refunds exceed confirmed provider receipts.")


def validate_evidence(manifest):
    rows = {str(row.pk): row for row in m.Evidence.objects.all()}
    records = manifest.get("delivery_evidence_files")
    if not isinstance(records, list) or {record["id"] for record in records} != set(rows):
        raise TransferError("Native snapshot delivery evidence inventory is incomplete.")
    for record in records:
        row = rows[record["id"]]
        if any(record[key] != getattr(row, key) for key in ["storage_alias", "key", "sha256", "size"]):
            raise TransferError("Delivery evidence metadata differs from its snapshot.")
        digest, size = hashlib.sha256(), 0
        try:
            with storages[row.storage_alias].open(row.key, "rb") as stream:
                while block := stream.read(65536):
                    digest.update(block)
                    size += len(block)
        except OSError:
            raise TransferError("A private delivery evidence object is missing from recovery.") from None
        if digest.hexdigest() != row.sha256 or size != row.size:
            raise TransferError("Recovered private delivery evidence bytes differ.")
