from django.shortcuts import get_object_or_404
from apps.accounts.models import AuditEvent
from . import access
from .models import CheckoutSubmission, Invoice


def submission_data(actor, pk):
    row = get_object_or_404(
        CheckoutSubmission.objects.prefetch_related("outcomes__order__invoice", "outcomes__order__lines"),
        buyer=actor.account,
        pk=pk,
    )
    return submission_row(row)


def submission_row(row):
    rows = []
    for outcome in row.outcomes.all():
        accepted = outcome.state == "accepted"
        order = outcome.order if accepted else None
        rows.append(
            {
                "seller": str(outcome.seller_id),
                "state": outcome.state,
                "code": outcome.code,
                "order": str(order.pk) if order else None,
                "invoice": str(order.invoice.pk) if order else None,
                "number": order.invoice.number if order else None,
                "goods_total": format(order.goods_total, ".2f") if order else None,
                "accepted_at": order.accepted_at if order else None,
                "price_changed": any(line.snapshot.get("price_changed", False) for line in order.lines.all())
                if order
                else False,
            }
        )
    return {
        "id": str(row.pk),
        "currency": row.payload["currency"],
        "created_at": row.created_at,
        "pending": any(x["state"] == "pending" for x in rows),
        "outcomes": rows,
    }


def order_data(row, *, seller_list=False):
    from apps.payments.queries import projection

    financial = projection(row)
    from apps.fulfilment.queries import dimensions

    delivery = dimensions(row)
    return {
        "id": str(row.pk),
        "seller": str(row.seller_id),
        **({"customer": {"name": row.snapshot["buyer"], "email": row.buyer.user.email}} if seller_list else {}),
        "currency": row.currency,
        "goods_total": format(row.goods_total, ".2f"),
        "payment_method": row.payment_method,
        "accepted_at": row.accepted_at,
        "issued_at": row.invoice.issued_at,
        "due_at": row.due_at,
        "invoice": str(row.invoice.pk),
        "number": row.invoice.number,
        "snapshot": {
            k: row.snapshot[k]
            for k in ["seller", "buyer", "terms", "advance_hours", "origin", "finalizer", "proposal"]
            if k in row.snapshot
        },
        "dimensions": {
            "agreement": "accepted",
            "financial": financial["financial"],
            "allocation": financial["allocation"],
            "fulfilment": delivery["stage"],
            "delivery_charge": "pending_separate"
            if delivery["charge"] is None
            else "settled"
            if delivery["delivery_settled"]
            else "unsettled",
            "cancellation": "pending" if delivery["cancellation_hold"] else "none",
            "dispute": "unresolved" if delivery["dispute_open"] else "none",
            "completion": delivery["completion"],
        },
        "payment": financial,
        "capabilities": {x: False for x in ["pay", "dispatch", "cancel", "refund", "amend", "complete"]},
        "lines": [
            {
                "id": str(x.pk),
                "variant": str(x.variant_id),
                "tier": x.tier,
                "quantity": format(x.quantity, ".3f"),
                "unit_price": format(x.unit_price, ".2f"),
                "goods_amount": format(x.goods_amount, ".2f"),
                "snapshot": x.snapshot,
                **({"image": f"/api/v1/orders/seller/orders/{row.pk}/lines/{x.pk}/image/"} if seller_list else {}),
            }
            for x in row.lines.all()
        ],
    }


def order_queryset(actor, *, seller=None, invoices=False):
    from apps.fulfilment.queries import annotate

    return (
        annotate(access.scope(actor, invoices=invoices, seller=seller))
        .select_related("invoice", "buyer__user")
        .prefetch_related("lines")
        .order_by("-accepted_at", "pk")
    )


def order_page(actor, *, seller=None, page=1, invoices=False):
    qs = order_queryset(actor, seller=seller, invoices=invoices)
    return {"count": qs.count(), "page": page, "results": [order_data(x, seller_list=actor.context == "seller" and not invoices) for x in qs[(page - 1) * 20 : page * 20]]}


def document(actor, pk, *, action="invoice_read", native=False):
    if native:
        from .admin import allowed
        from rest_framework.exceptions import PermissionDenied

        if not allowed(actor.request, "read_invoices"):
            raise PermissionDenied()
        qs = Invoice.objects.all()
    else:
        qs = Invoice.objects.filter(order__in=access.scope(actor, invoices=True))
    row = get_object_or_404(qs.select_related("order"), pk=pk)
    # Revalidate under the same profile/User/grant locks that serialize revocation.
    from django.db import transaction

    with transaction.atomic():
        access.lock_actor(actor, row.order.seller_id)
        if native:
            if not allowed(actor.request, "read_invoices"):
                raise PermissionDenied()
        else:
            get_object_or_404(access.scope(actor, invoices=True), pk=row.order_id)
        AuditEvent.objects.create(
            actor=actor.user,
            account=actor.account,
            context=actor.context,
            action=action,
            resource_type="orders.invoice",
            resource_id=row.pk,
            reason="Protected document access",
            state={},
        )
    return row


def line_image(order, line_id):
    # Order access outlives catalogue publication and never grants catalogue editing rights.
    from apps.catalogue.models import SourceRevision, ProductImage
    from rest_framework.exceptions import NotFound

    line = get_object_or_404(order.lines.select_related("variant"), pk=line_id)
    revision = SourceRevision.objects.filter(pk=line.snapshot.get("revision"), product_id=line.variant.product_id).first()
    if revision is None:
        raise NotFound()
    images = revision.body.get("images", [])
    images = [image for image in images if image.get("variant") in (None, "", str(line.variant_id))]
    if not images:
        raise NotFound()
    return get_object_or_404(ProductImage, pk=images[0]["id"], product_id=line.variant.product_id)


def order_line_image(actor, pk, line_id):
    return line_image(get_object_or_404(access.scope(actor), pk=pk), line_id)
