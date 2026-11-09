"""Read-only, currency-separated operational reports over existing immutable facts.

Nothing here initializes or mutates business records. Amounts are exact Decimal
sums per currency; AFN and USD are never combined or converted.
"""

from collections import defaultdict
from datetime import datetime, time, timedelta

from django.db.models import Exists, OuterRef, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied

from apps.foundation.money import ZERO, sum_exact
from apps.fulfilment import models as fm
from apps.fulfilment import queries as delivery_queries
from apps.orders import aftercare
from apps.orders.models import Amendment, CancellationRequest, DisputeRequest, Review, SellerOrder
from apps.organizations.models import BusinessProfile, Membership
from apps.payments import queries as goods_queries
from apps.payments.models import Receipt, RefundDue, RefundReport, ReviewCase as PaymentCase

CURRENCIES = ("AFN", "USD")
MAX_DAYS = 366
DEFAULT_DAYS = 30
SECTIONS = ("orders", "finance", "logistics")
BUNDLE = {"orders": "orders_negotiation", "finance": "payments_refunds", "logistics": "fulfilment"}


def period(start=None, end=None):
    """Inclusive Kabul calendar dates mapped to an aware [from, to) window."""
    today = timezone.localdate()
    end = end or today
    start = start or end - timedelta(days=DEFAULT_DAYS - 1)
    zone = timezone.get_current_timezone()
    return {
        "start": start,
        "end": end,
        "since": datetime.combine(start, time.min, tzinfo=zone),
        "until": datetime.combine(end + timedelta(days=1), time.min, tzinfo=zone),
    }


def within(field, window):
    return {field + "__gte": window["since"], field + "__lt": window["until"]}


def money(value):
    return format(value, ".2f")


def by_currency(rows, *names):
    """rows: iterable of (currency, *amounts). Returns exact per-currency sums."""
    buckets = defaultdict(lambda: [[] for _ in names])
    counts = defaultdict(int)
    for currency, *amounts in rows:
        counts[currency] += 1
        for index, amount in enumerate(amounts):
            buckets[currency][index].append(amount or ZERO)
    return {
        currency: {"count": counts[currency], **{name: sum_exact(buckets[currency][i]) for i, name in enumerate(names)}}
        for currency in CURRENCIES
        if currency in counts
    }


def report_profiles(account):
    """Seller businesses where the account may read at least one report section."""
    if account.context != "seller":
        return BusinessProfile.objects.none()
    member = Membership.objects.filter(company_id=OuterRef("pk"), account=account, active=True).filter(
        Q(is_owner=True) | Q(bundles__contains=["orders_negotiation"]) | Q(bundles__contains=["payments_refunds"])
        | Q(bundles__contains=["fulfilment"])
    )
    return (
        BusinessProfile.objects.annotate(report_member=Exists(member))
        .filter(Q(kind="individual", account=account) | Q(kind="company", report_member=True))
        .order_by("created_at")
    )


def sections(account, profile):
    """Fresh per-request section rights: owners read all; members by bundle."""
    if profile.kind == "individual":
        return {name: profile.account_id == account.pk for name in SECTIONS}
    membership = Membership.objects.filter(company=profile, account=account, active=True).first()
    if membership is None:
        return {name: False for name in SECTIONS}
    return {name: membership.is_owner or BUNDLE[name] in (membership.bundles or []) for name in SECTIONS}


def seller_scope(account, seller):
    profile = get_object_or_404(report_profiles(account), pk=seller)
    rights = sections(account, profile)
    if not any(rights.values()):
        raise PermissionDenied()
    return profile, rights


def order_figures(orders, window):
    accepted = aftercare.annotate(orders.filter(**within("accepted_at", window)))
    totals = by_currency(
        accepted.values_list("currency", "goods_total", "accepted_total"), "goods_total", "accepted_total"
    )
    cancelled = by_currency(accepted.filter(aftercare_cancelled=True).values_list("currency"))
    return [
        {
            "currency": currency,
            "accepted": values["count"],
            "cancelled": cancelled.get(currency, {}).get("count", 0),
            "goods_total": money(values["goods_total"]),
            "accepted_total": money(values["accepted_total"]),
        }
        for currency, values in totals.items()
    ]


def finance_figures(orders, window):
    scope = {"order__in": orders.values("pk")}
    goods = by_currency(
        goods_queries.effective_receipts(Receipt.objects.filter(**scope, **within("created_at", window))).values_list(
            "currency", "effective_amount"
        ),
        "amount",
    )
    refunded = by_currency(
        RefundReport.objects.filter(
            due__order__in=orders.values("pk"), decision__action="confirmed", **within("decision__created_at", window)
        ).values_list("due__currency", "amount"),
        "amount",
    )
    due = by_currency(
        RefundDue.objects.filter(**scope, **within("created_at", window)).values_list("currency", "amount"), "amount"
    )
    delivery = by_currency(
        delivery_queries.effective_receipts(fm.Receipt.objects.filter(**scope, **within("created_at", window)))
        .values_list("claim__currency", "effective_amount"),
        "amount",
    )
    delivery_refunded = by_currency(
        fm.DeliveryRefund.objects.filter(
            **scope, decision__action="confirmed", **within("decision__created_at", window)
        ).values_list("currency", "amount"),
        "amount",
    )
    rows = []
    for currency in CURRENCIES:
        parts = [goods, refunded, due, delivery, delivery_refunded]
        if not any(currency in part for part in parts):
            continue

        def get(part, key="amount"):
            return part.get(currency, {}).get(key, ZERO)

        rows.append(
            {
                "currency": currency,
                "goods_received": money(get(goods)),
                "goods_receipts": get(goods, "count") or 0,
                "goods_refunded": money(get(refunded)),
                "goods_net": money(get(goods) - get(refunded)),
                "refund_due_created": money(get(due)),
                "delivery_received": money(get(delivery)),
                "delivery_refunded": money(get(delivery_refunded)),
            }
        )
    return rows


def logistics_figures(orders, window):
    scope = {"order__in": orders.values("pk")}
    return {
        "dispatched": fm.Shipment.objects.filter(**scope, **within("created_at", window)).count(),
        "delivered": fm.Delivery.objects.filter(**scope, **within("created_at", window)).count(),
        "completed": fm.Completion.objects.filter(**scope, **within("created_at", window)).count(),
    }


def queues(orders, rights):
    """Current open work (not period-bound), each limited to its section right."""
    scope = {"order__in": orders.values("pk")}
    result = {}
    if rights.get("orders"):
        open_orders = orders.exclude(
            Exists(CancellationRequest.objects.filter(order_id=OuterRef("pk"), state="approved"))
        )
        result.update(
            awaiting_dispatch=open_orders.exclude(Exists(fm.Shipment.objects.filter(order_id=OuterRef("pk")))).count(),
            cancellations=CancellationRequest.objects.filter(**scope, state="pending").count(),
            amendments=Amendment.objects.filter(**scope, state="pending").count(),
            disputes=DisputeRequest.objects.filter(**scope, state="pending").count(),
            reviews_pending=Review.objects.filter(**scope, state="pending").count(),
        )
    if rights.get("finance"):
        result["payment_reviews"] = PaymentCase.objects.filter(**scope, state="open").count()
    if rights.get("logistics"):
        result["delivery_reviews"] = fm.ReviewCase.objects.filter(**scope, state="open").count()
        result["holds"] = fm.Blocker.objects.filter(**scope).exclude(
            Exists(fm.BlockerClosure.objects.filter(blocker_id=OuterRef("pk")))
        ).count()
    return result


def summary(orders, window, rights):
    return {
        "period": {"start": window["start"], "end": window["end"]},
        "sections": rights,
        "orders": order_figures(orders, window) if rights.get("orders") else None,
        "finance": finance_figures(orders, window) if rights.get("finance") else None,
        "logistics": logistics_figures(orders, window) if rights.get("logistics") else None,
        "queues": queues(orders, rights),
        "generated_at": timezone.now(),
    }


def seller_summary(account, seller, window):
    profile, rights = seller_scope(account, seller)
    result = summary(SellerOrder.objects.filter(seller=profile), window, rights)
    result["seller"] = {"id": profile.pk, "name": profile.display_name}
    return result


def buyer_summary(account, window):
    orders = SellerOrder.objects.filter(buyer=account)
    rights = {name: True for name in SECTIONS}
    result = summary(orders, window, rights)
    result["queues"] = {
        "cancellations": CancellationRequest.objects.filter(order__in=orders.values("pk"), state="pending").count(),
        "disputes": DisputeRequest.objects.filter(order__in=orders.values("pk"), state="pending").count(),
        "in_transit": fm.Shipment.objects.filter(order__in=orders.values("pk"))
        .exclude(Exists(fm.Delivery.objects.filter(shipment_id=OuterRef("pk"))))
        .count(),
    }
    return result


def platform_sellers(window, limit=20):
    """Root-only per-seller accepted totals for the native admin report."""
    accepted = aftercare.annotate(SellerOrder.objects.filter(**within("accepted_at", window)))
    grouped = defaultdict(lambda: {"count": 0, "amounts": []})
    names = {}
    for seller, name, currency, total in accepted.values_list(
        "seller_id", "seller__display_name", "currency", "accepted_total"
    ):
        names[seller] = name
        grouped[(seller, currency)]["count"] += 1
        grouped[(seller, currency)]["amounts"].append(total or ZERO)
    rows = [
        {"seller": seller, "name": names[seller], "currency": currency, "accepted": value["count"],
         "accepted_total": sum_exact(value["amounts"])}
        for (seller, currency), value in grouped.items()
    ]
    rows.sort(key=lambda row: (row["currency"], -row["accepted_total"], row["name"]))
    return rows if limit is None else [row for currency in CURRENCIES for row in
                                        [r for r in rows if r["currency"] == currency][:limit]]
