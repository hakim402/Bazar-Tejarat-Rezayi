from django.shortcuts import get_object_or_404
from django.db.models import Q, F, OuterRef, Subquery, Value
from django.utils import timezone
from apps.accounts.models import AuditEvent
from . import access
from .models import CheckoutSubmission, Invoice, DisputeRequest, OrderEvent, AftercareEvent


def submission_data(actor, pk, locale="fa-AF"):
    row = get_object_or_404(
        CheckoutSubmission.objects.prefetch_related(
            "outcomes__seller", "outcomes__order__invoice", "outcomes__order__lines"
        ),
        buyer=actor.account,
        pk=pk,
    )
    return submission_row(row, locale)


def submission_row(row, locale="fa-AF"):
    choices = {c["seller"]: c for c in row.payload.get("choices", [])}
    counts = {}
    for sel in row.selections or []:
        counts[sel["seller"]] = counts.get(sel["seller"], 0) + 1
    cart_lines = {}
    if any(o.state != "accepted" for o in row.outcomes.all()):
        from apps.cart.services import projection as cart_projection

        cart_lines = {x["id"]: x for x in cart_projection(row.cart, locale)["lines"]}
    rows = []
    for outcome in row.outcomes.all():
        accepted = outcome.state == "accepted"
        order = outcome.order if accepted else None
        seller = str(outcome.seller_id)
        choice = choices.get(seller, {})
        items = []
        if order:
            for line in order.lines.all():
                snapshot = line.snapshot
                titles = snapshot.get("titles", {})
                source = snapshot.get("source_locale", "fa-AF")
                items.append(
                    {
                        "line": str(line.pk),
                        "title": titles.get(locale) or titles.get(source) or next(iter(titles.values()), ""),
                        "image": f"/api/v1/orders/buyer/orders/{order.pk}/lines/{line.pk}/image/",
                        "quantity": format(line.quantity, ".3f"),
                        "sku": snapshot.get("sku", ""),
                    }
                )
        else:
            for sel in row.selections or []:
                if sel.get("seller") != seller:
                    continue
                cl = cart_lines.get(sel.get("line"))
                if not cl:
                    continue
                items.append(
                    {
                        "line": sel["line"],
                        "title": cl["title"] or cl["sku"],
                        "image": (cl["image"] or {}).get("url"),
                        "quantity": cl["quantity"],
                        "sku": cl["sku"],
                    }
                )
        rows.append(
            {
                "seller": seller,
                "seller_name": outcome.seller.display_name,
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
                "item_count": counts.get(seller, len(items)),
                "destination": {"country": choice.get("country", ""), "city": choice.get("city", "")},
                "method": choice.get("method", ""),
                "items": items,
            }
        )
    return {
        "id": str(row.pk),
        "currency": row.payload["currency"],
        "created_at": row.created_at,
        "pending": any(x["state"] == "pending" for x in rows),
        "outcomes": rows,
    }


def order_data(row, *, seller_list=False, buyer_list=False):
    from apps.payments.queries import projection

    financial = projection(row)
    from apps.fulfilment.queries import dimensions

    delivery = dimensions(row)
    image_scope = "seller" if seller_list else "buyer" if buyer_list else None
    return {
        "id": str(row.pk),
        "seller": str(row.seller_id),
        **({
            "customer": {"name": row.snapshot["buyer"], "email": row.buyer.user.email},
            "dispute_id": row.active_dispute_id,
        } if seller_list else {}),
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
            "delivery_charge_amount": delivery["charge"] or "",
            "delivery_remaining": delivery["delivery_remaining"] or "",
            "delivery_provider": delivery["provider"] or delivery["charge_provider"] or "",
            "dispatch_problem": delivery["dispatch_problem"] or "",
            "cancellation": "pending" if delivery["cancellation_hold"] else "none",
            "dispute": "unresolved" if delivery["dispute_open"] else "none",
            "completion": delivery["completion"],
            "completed_at": delivery["completed_at"].isoformat() if delivery["completed_at"] else "",
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
                **({"image": f"/api/v1/orders/{image_scope}/orders/{row.pk}/lines/{x.pk}/image/"} if image_scope else {}),
            }
            for x in row.lines.all()
        ],
    }


def order_queryset(actor, *, seller=None, invoices=False):
    from apps.fulfilment.queries import annotate

    return (
        annotate(access.scope(actor, invoices=invoices, seller=seller))
        .annotate(active_dispute_id=Subquery(
            DisputeRequest.objects.filter(order_id=OuterRef("pk"), state="pending")
            .order_by("-created_at", "pk").values("pk")[:1]
        ))
        .select_related("invoice", "buyer__user")
        .prefetch_related("lines")
        .order_by("-accepted_at", "pk")
    )


def order_page(actor, *, seller=None, page=1, invoices=False, q="", state=""):
    qs = order_queryset(actor, seller=seller, invoices=invoices)
    if q:
        qs = qs.filter(
            Q(invoice__number__icontains=q)
            | Q(snapshot__buyer__icontains=q)
            | Q(buyer__user__display_name__icontains=q)
        )
    if state == "overdue":
        qs = qs.filter(payment_due__lte=timezone.now(), payment_total__lt=F("accepted_total"))
    elif state == "unpaid":
        qs = qs.filter(payment_total=0)
    elif state == "partial":
        qs = qs.filter(payment_total__gt=0, payment_total__lt=F("accepted_total"))
    elif state == "paid":
        qs = qs.filter(payment_total=F("accepted_total"), accepted_total__gt=0)
    elif state == "overpaid":
        qs = qs.filter(payment_total__gt=F("accepted_total"))
    return {"count": qs.count(), "page": page, "results": [order_data(x, seller_list=actor.context == "seller" and not invoices, buyer_list=actor.context == "buyer" and not invoices) for x in qs[(page - 1) * 20 : page * 20]]}


def order_activity(actor, pk, *, page=1):
    from rest_framework.exceptions import PermissionDenied
    from apps.payments import access as payment_access
    from apps.payments.models import Event as PaymentEvent
    from apps.fulfilment import access as fulfilment_access
    from apps.fulfilment.models import Event as FulfilmentEvent

    if actor.context != "seller":
        raise PermissionDenied()

    def permitted_sources():
        get_object_or_404(access.scope(actor), pk=pk)
        sources = {"orders": OrderEvent, "aftercare": AftercareEvent}
        if payment_access.scope(actor, write=True).filter(pk=pk).exists():
            sources["payments"] = PaymentEvent
        if fulfilment_access.scope(actor).filter(pk=pk).exists():
            sources["fulfilment"] = FulfilmentEvent
        return sources

    sources = permitted_sources()
    streams = [
        model.objects.filter(order_id=pk).order_by().annotate(source=Value(source))
        .values("id", "source", "action", "created_at")
        for source, model in sources.items()
    ]
    events = streams[0].union(*streams[1:], all=True).order_by("-created_at", "source", "id")
    count = events.count()
    results = list(events[(page - 1) * 20 : page * 20])
    # Recheck every domain grant after hydration, before disclosing events or counts.
    if sources.keys() != permitted_sources().keys():
        raise PermissionDenied()
    return {"results": results, "count": count, "page": page}


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
