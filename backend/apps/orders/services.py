"""Independent durable seller acceptance. No payment, reservation or dispatch."""

from apps.runtime.locks import row_options

from collections import defaultdict
from datetime import timedelta
from decimal import Decimal
from django.db import transaction, connection, OperationalError
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import ValidationError, PermissionDenied
from apps.catalogue.models import Product, Variant, Translation
from apps.catalogue.media import StorageUnavailable
from apps.organizations.models import BusinessProfile
from apps.accounts.models import Account
from apps.marketplace.access import eligible_profiles
from apps.messaging.services import digest, CommandConflict
from apps.messaging.access import lock_actor, not_self
from apps.cart.models import Cart, CartLine
from apps.inventory.validation import quantity
from apps.inventory.acceptance import available
from . import access, validation as v
from .models import (
    SellerCheckoutTerms,
    OrderPolicy,
    CheckoutSubmission,
    CheckoutOutcome,
    SellerOrder,
    OrderLine,
    Invoice,
    OrderEvent,
)


class StateChanged(Exception):
    pass


class SellerFailure(Exception):
    def __init__(self, code):
        self.code = code


def event(actor, action, *, seller=None, order=None, reason="", state=None):
    OrderEvent.objects.create(
        actor=actor.user,
        account=actor.account,
        context=actor.context,
        action=action,
        seller=seller,
        order=order,
        reason=reason,
        state=state or {},
    )


def terms(profile):
    row = SellerCheckoutTerms.objects.filter(seller=profile).first()
    return {
        "seller": str(profile.pk),
        "version": row.version if row else 0,
        "enabled": row.enabled if row else False,
        "destinations": row.destinations if row else [],
        "methods": row.methods if row else [],
    }


@transaction.atomic
def set_terms(actor, pk, data):
    profile = get_object_or_404(BusinessProfile.objects.select_for_update(), pk=pk)
    lock_actor(actor)
    if not access.owned(profile, actor.account) or not eligible_profiles([pk]).filter(pk=pk).exists():
        raise PermissionDenied()
    row = SellerCheckoutTerms.objects.filter(seller=profile).first()
    if (row.version if row else 0) != data["version"]:
        raise CommandConflict()
    methods = data["methods"]
    if (
        not isinstance(methods, list)
        or len(methods) > 2
        or set(methods) - {"advance", "cod"}
        or len(methods) != len(set(methods))
        or data["enabled"]
        and not methods
    ):
        raise ValidationError({"methods": ["required"]})
    destinations = v.destinations(data["destinations"]) if data["destinations"] else []
    if data["enabled"] and not destinations:
        raise ValidationError({"destinations": ["required"]})
    if row is None:
        row = SellerCheckoutTerms(seller=profile)
    else:
        row.version += 1
    row.enabled = data["enabled"]
    row.methods = methods
    row.destinations = destinations
    row.save()
    event(actor, "checkout_terms_updated", seller=profile, reason=data["reason"], state=terms(profile))
    return terms(profile)


@transaction.atomic
def set_policy(actor, version, hours, reason):
    lock_actor(actor)
    if actor.context != "owner" or not 1 <= hours <= 720 or len(reason.strip()) < 3:
        raise PermissionDenied()
    policy = OrderPolicy.objects.select_for_update().get(pk=1)
    if policy.version != version:
        raise CommandConflict()
    policy.advance_hours = hours
    policy.version += 1
    policy.save()
    event(actor, "order_policy_updated", reason=reason, state={"version": policy.version, "advance_hours": hours})
    return policy


def business_payload(data):
    return {
        "version": data["version"],
        "currency": data["currency"],
        "lines": sorted(str(x) for x in data["lines"]),
        "choices": sorted(
            [{**c, "seller": str(c["seller"]), "city": v.city(c["city"])} for c in data["choices"]],
            key=lambda c: c["seller"],
        ),
    }


def selections(actor, data):
    cart = get_object_or_404(Cart.objects.select_for_update(), account=actor.account)
    if cart.version != data["version"]:
        raise CommandConflict()
    ids = data["lines"]
    if not ids or len(ids) > 100 or len(set(ids)) != len(ids):
        raise ValidationError({"lines": ["bounds"]})
    lines = list(cart.lines.filter(pk__in=ids).select_related("variant__product").order_by("pk"))
    if len(lines) != len(ids):
        raise ValidationError({"lines": ["unavailable"]})
    if any(x.variant.product.currency != data["currency"] or x.variant.product.pricing_mode != "fixed" for x in lines):
        raise ValidationError({"group": ["fixed_currency_only"]})
    seller_ids = {str(x.variant.product.seller_id) for x in lines}
    if (
        len(seller_ids) > 20
        or len(data["choices"]) != len(seller_ids)
        or {str(x["seller"]) for x in data["choices"]} != seller_ids
    ):
        raise ValidationError({"choices": ["one_per_seller"]})
    shown = {str(x["line"]): x["price"] for x in data.get("shown_prices", [])}
    return cart, [
        {
            "line": str(x.pk),
            "version": x.version,
            "variant": str(x.variant_id),
            "tier": x.tier,
            "quantity": format(x.quantity, ".3f"),
            "seller": str(x.variant.product.seller_id),
            "shown_price": shown.get(str(x.pk)),
        }
        for x in lines
    ]


@transaction.atomic
def create_submission(actor, data):
    if actor.context != "buyer":
        raise PermissionDenied()
    # Consistent profile -> identity -> cart ordering also covers outcome FK
    # key-share locks taken when the durable parent commits.
    seller_ids = CartLine.objects.filter(cart__account=actor.account, pk__in=data["lines"]).values_list(
        "variant__product__seller_id", flat=True
    )
    list(BusinessProfile.objects.select_for_update().filter(pk__in=seller_ids).order_by("pk"))
    lock_actor(actor)
    account = actor.account
    payload = business_payload(data)
    hashed = digest(payload)
    old = CheckoutSubmission.objects.filter(buyer=account, key=data["command_id"]).first()
    if old:
        if old.digest != hashed:
            raise CommandConflict()
        return old
    cart, rows = selections(actor, data)
    # JSON stores canonical strings; locale/estimated prices are presentation, not authority.
    import json

    item = CheckoutSubmission.objects.create(
        buyer=account,
        cart=cart,
        key=data["command_id"],
        digest=hashed,
        payload=json.loads(json.dumps(payload, default=str)),
        selections=rows,
    )
    CheckoutOutcome.objects.bulk_create(
        [CheckoutOutcome(submission=item, seller_id=pk) for pk in sorted({x["seller"] for x in rows})]
    )
    return item


def buyer_business(actor, *, lock=False):
    qs = BusinessProfile.objects.filter(account=actor.account, kind="business")
    return qs.select_for_update().first() if lock else qs.first()


def validate_seller(buyer_account, profile, rows, choice, currency, *, mode="fixed"):
    """Shared commercial validation; buyer identity is not an authentication grant."""
    if not eligible_profiles([profile.pk]).filter(pk=profile.pk).exists():
        raise SellerFailure("seller_unavailable")
    try:
        not_self(profile, buyer_account)
    except ValidationError:
        raise SellerFailure("self_purchase") from None
    current = terms(profile)
    if not current["enabled"]:
        raise SellerFailure("terms_unconfigured")
    if choice["method"] not in current["methods"]:
        raise SellerFailure("method_unavailable")
    destination = {"country": choice["country"], "city": v.city(choice["city"])}
    if not any(
        x["country"] == destination["country"] and (x["all_cities"] or destination["city"] in x["cities"])
        for x in current["destinations"]
    ):
        raise SellerFailure("destination_unavailable")
    products = {
        p.pk: p
        for p in Product.objects.select_for_update(**row_options())
        .filter(pk__in=Variant.objects.filter(pk__in=[x["variant"] for x in rows]).values("product_id"))
        .select_related("published")
        .order_by("pk")
    }
    variants = {
        str(x.pk): x
        for x in Variant.objects.select_for_update(**row_options())
        .select_related("unit")
        .filter(pk__in=[x["variant"] for x in rows])
        .order_by("pk")
    }
    if len(variants) != len({x["variant"] for x in rows}):
        raise SellerFailure("variant_unavailable")
    editions_by_revision = {
        p.published_id: {p.published.body["locale"]: p.published.body["title"]}
        for p in products.values()
        if p.published_id
    }
    for translation in Translation.objects.filter(revision_id__in=editions_by_revision, approved_body__isnull=False):
        editions_by_revision[translation.revision_id][translation.locale] = translation.approved_body["title"]
    wholesale = None
    if any(x["tier"] == "wholesale" for x in rows):
        bp = BusinessProfile.objects.filter(account=buyer_account, kind="business").first()
        wholesale = access.verified_case(bp) if bp else None
        if not wholesale:
            raise SellerFailure("wholesale_verification")
    required = defaultdict(Decimal)
    prepared = []
    total = Decimal(0)
    for row in rows:
        variant = variants[row["variant"]]
        product = products.get(variant.product_id)
        if (
            not product
            or product.seller_id != profile.pk
            or not product.published_id
            or product.currency != currency
            or product.pricing_mode != mode
            or not any(str(x["id"]) == str(variant.pk) and x["active"] for x in product.published.body["variants"])
        ):
            raise SellerFailure("variant_unavailable")
        qty = quantity(row["quantity"], variant)
        if row["tier"] == "wholesale" and qty < variant.minimum_wholesale:
            raise SellerFailure("wholesale_minimum")
        price = getattr(variant, row["tier"]) if mode == "fixed" else Decimal(row["unit_price"])
        if price is None:
            raise SellerFailure("tier_unavailable")
        amount = v.money(price, qty)
        required[variant.pk] += qty
        total += amount
        if total >= Decimal("1e22"):
            raise SellerFailure("total_overflow")
        editions = editions_by_revision[product.published_id]
        prepared.append(
            {
                "row": row,
                "variant": variant,
                "quantity": qty,
                "price": price,
                "amount": amount,
                "snapshot": {
                    "product": str(product.pk),
                    "revision": str(product.published_id),
                    "titles": editions,
                    "source_locale": product.published.body["locale"],
                    "sku": variant.sku,
                    "definition": variant.definition,
                    "attribute_labels": next(
                        x for x in product.published.body["variants"] if str(x["id"]) == str(variant.pk)
                    ).get("attribute_labels", {}),
                    "unit": variant.unit.code,
                    "unit_labels": variant.unit.labels,
                    "increment": format(variant.quantity_increment, ".3f"),
                    "minimum": format(variant.minimum_wholesale, ".3f"),
                    "shown_price": row.get("shown_price"),
                    "price_changed": row.get("shown_price") is not None and Decimal(row["shown_price"]) != price,
                },
            }
        )
    failure = available(required)
    if failure:
        raise SellerFailure(failure)
    approved = access.verified_case(profile)
    if not approved:
        raise SellerFailure("seller_unavailable")
    return (
        prepared,
        total,
        {
            "seller": approved.snapshot.get("display_name", ""),
            "buyer": (wholesale.snapshot.get("display_name") if wholesale else None)
            or Account.objects.select_related("user").get(pk=buyer_account.pk).user.display_name,
            "terms": {**current, "destination": destination, "method": choice["method"]},
            "wholesale_case": str(wholesale.pk) if wholesale else None,
        },
    )


def after_seller_commit(_outcome):
    """Synchronization/crash seam used by disposable integration tests only."""
    return None


@transaction.atomic
def accept_seller(actor, submission_id, outcome_id):
    submission = get_object_or_404(CheckoutSubmission, buyer=actor.account, pk=submission_id)
    preliminary = get_object_or_404(CheckoutOutcome, submission=submission, pk=outcome_id)
    needs_wholesale = any(
        r["tier"] == "wholesale" for r in submission.selections if r["seller"] == str(preliminary.seller_id)
    )
    bp = buyer_business(actor) if needs_wholesale else None
    lock_ids = [preliminary.seller_id] + ([bp.pk] if bp else [])
    profiles = {p.pk: p for p in BusinessProfile.objects.select_for_update().filter(pk__in=lock_ids).order_by("pk")}
    lock_actor(actor)
    outcome = CheckoutOutcome.objects.select_for_update().get(pk=outcome_id)
    if outcome.state != "pending":
        return outcome
    if needs_wholesale:
        fresh_business = buyer_business(actor)
        if (fresh_business.pk if fresh_business else None) != (bp.pk if bp else None):
            # Do not acquire a newly appeared profile lock after the identity lock.
            # A same-command retry can take the complete ordered lock set.
            raise StateChanged()
    rows = [r for r in submission.selections if r["seller"] == str(outcome.seller_id)]
    choice = next(x for x in submission.payload["choices"] if x["seller"] == str(outcome.seller_id))
    # Profile/User locks coordinate all existing stock/catalogue/membership writes.
    prepared, total, snapshot = validate_seller(
        actor.account, profiles[outcome.seller_id], rows, choice, submission.payload["currency"]
    )
    cart = Cart.objects.select_for_update().get(pk=submission.cart_id, account=actor.account)
    actual = {
        str(x.pk): x for x in cart.lines.select_for_update().filter(pk__in=[x["line"] for x in rows]).order_by("pk")
    }
    if any(
        r["line"] not in actual
        or actual[r["line"]].version != r["version"]
        or format(actual[r["line"]].quantity, ".3f") != r["quantity"]
        for r in rows
    ):
        raise SellerFailure("cart_changed")
    write_agreement(
        actor,
        actor.account,
        profiles[outcome.seller_id],
        submission.payload["currency"],
        choice,
        prepared,
        total,
        snapshot,
        outcome=outcome,
    )
    # Delete only the exact unchanged accepted rows; preserve unrelated/new cart edits.
    CartLine.objects.filter(pk__in=actual).delete()
    cart.version += 1
    cart.save()
    outcome.state = "accepted"
    outcome.code = ""
    outcome.version += 1
    outcome.save()
    return outcome


@transaction.atomic
def save_failure(actor, item, code, *, terminal):
    lock_actor(actor)
    row = get_object_or_404(CheckoutOutcome.objects.select_for_update(), pk=item.pk, submission__buyer=actor.account)
    if row.state == "pending":
        row.state = "failed" if terminal else "pending"
        row.code = code
        row.version += 1
        row.save()


def submit(actor, data):
    submission = create_submission(actor, data)
    for item in submission.outcomes.order_by("seller_id"):
        if item.state != "pending":
            continue
        try:
            outcome = accept_seller(actor, submission.pk, item.pk)
        except SellerFailure as exc:
            save_failure(actor, item, exc.code, terminal=True)
        except StateChanged:
            save_failure(actor, item, "state_changed", terminal=False)
        except ValidationError:
            save_failure(actor, item, "selection_invalid", terminal=True)
        except (StorageUnavailable, OperationalError, OSError):
            save_failure(actor, item, "dependency_unavailable", terminal=False)
        else:
            after_seller_commit(outcome)
    from .queries import submission_data

    return submission_data(actor, submission.pk)


@transaction.atomic
def review(actor, data):
    # Match the parent/acceptance profile -> identity -> cart ordering.
    seller_ids = CartLine.objects.filter(cart__account=actor.account, pk__in=data["lines"]).values_list(
        "variant__product__seller_id", flat=True
    )
    list(BusinessProfile.objects.select_for_update().filter(pk__in=seller_ids).order_by("pk"))
    lock_actor(actor)
    cart, rows = selections(actor, data)
    out = []
    for seller_id in sorted({x["seller"] for x in rows}):
        profile = get_object_or_404(BusinessProfile, pk=seller_id)
        choice = next(x for x in data["choices"] if str(x["seller"]) == seller_id)
        try:
            lines, total, snapshot = validate_seller(
                actor.account, profile, [x for x in rows if x["seller"] == seller_id], choice, data["currency"]
            )
            out.append(
                {
                    "seller": seller_id,
                    "code": "ready",
                    "total": format(total, ".2f"),
                    "currency": data["currency"],
                    "lines": [
                        {
                            "line": x["row"]["line"],
                            "price": format(x["price"], ".2f"),
                            "amount": format(x["amount"], ".2f"),
                        }
                        for x in lines
                    ],
                }
            )
        except SellerFailure as exc:
            out.append({"seller": seller_id, "code": exc.code})
    return {"results": out, "binding": False}


def write_agreement(
    actor, buyer_account, profile, currency, choice, prepared, total, snapshot, *, outcome=None, negotiation=None
):
    """Internal writer; caller holds authority/source/stock locks and one transaction."""
    accepted = timezone.now()
    policy = OrderPolicy.objects.get(pk=1)
    order = SellerOrder.objects.create(
        outcome=outcome,
        negotiation=negotiation,
        buyer=buyer_account,
        seller=profile,
        currency=currency,
        goods_total=total,
        payment_method=choice["method"],
        accepted_at=accepted,
        due_at=accepted + timedelta(hours=policy.advance_hours) if choice["method"] == "advance" else None,
        snapshot={**snapshot, "advance_hours": policy.advance_hours if choice["method"] == "advance" else None},
    )
    for line in prepared:
        OrderLine.objects.create(
            order=order,
            variant=line["variant"],
            tier=line["row"]["tier"],
            quantity=line["quantity"],
            unit_price=line["price"],
            goods_amount=line["amount"],
            snapshot=line["snapshot"],
        )
    with connection.cursor() as cursor:
        cursor.execute("SELECT NEXT VALUE FOR orders_invoice_number" if connection.vendor == "mysql" else "SELECT nextval('orders_invoice_number')")
        number = cursor.fetchone()[0]
    Invoice.objects.create(order=order, number=f"BR-{number:010d}")
    event(
        actor,
        "negotiated_order_accepted" if negotiation else "fixed_order_accepted",
        seller=order.seller,
        order=order,
        state={"invoice": str(order.invoice.pk), "currency": order.currency},
    )
    if negotiation is None:
        from apps.notifications.order_events import order_committed

        order_committed(order, actor.account)
    return order
