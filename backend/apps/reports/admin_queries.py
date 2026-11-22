"""Read-only report data for the owner admin, grouped by the active view."""

from datetime import timedelta
from decimal import Decimal

from django.db.models import Count, F
from django.urls import reverse
from django.utils import timezone
from django.utils.translation import gettext as _

from apps.orders import aftercare

from . import queries


def previous_window(window):
    days = (window["end"] - window["start"]).days + 1
    return queries.period(window["start"] - timedelta(days=days), window["start"] - timedelta(days=1))


def number(value, places=2):
    text = format(Decimal(value), f",.{places}f")
    return text.rstrip("0").rstrip(".") if places else text


def delta(current, previous, *, points=False):
    """Compare like-for-like periods without inferring that every increase is good."""
    if current is None or previous is None:
        return "—"
    if points:
        change = round(Decimal(current) - Decimal(previous), 1)
        return _("%(change)s pp") % {"change": f"{'+' if change > 0 else ''}{number(change or 0, 1)}"}
    if current == previous:
        return "0%"
    if not previous:
        return _("New")
    change = round((Decimal(current) - Decimal(previous)) / abs(Decimal(previous)) * 100, 1)
    return f"{'+' if change > 0 else ''}{number(change or 0, 1)}%"


def accepted(orders, window):
    return orders.filter(**queries.within("accepted_at", window))


def daily_series(orders, window, currency, *, amount):
    """Bucket by local dates, including zero days. MariaDB time zone tables are optional."""
    orders = accepted(orders, window).filter(currency=currency)
    if amount:
        rows = aftercare.annotate(orders).values_list("accepted_at", "accepted_total").iterator()
    else:
        rows = ((when, 1) for when in orders.values_list("accepted_at", flat=True).iterator())
    values = [Decimal(0) if amount else 0] * ((window["end"] - window["start"]).days + 1)
    for when, value in rows:
        index = (timezone.localtime(when).date() - window["start"]).days
        values[index] += value or 0
    return values


def comparison(label, current, previous, *, points=False):
    def display(value):
        if value is None:
            return "—"
        return f"{number(value, 1)}%" if points else number(value)

    return {
        "label": label,
        "values": [display(current), display(previous), delta(current, previous, points=points)],
    }


def table(columns, rows):
    return {"columns": columns, "rows": rows}


def compare_table(rows):
    return {**table([_("Measure"), _("Selected period"), _("Previous period"), _("Change")], rows), "comparison": True}


def by_currency(rows):
    return {row["currency"]: row for row in rows}


def amount(row, field):
    return Decimal(row.get(field, 0))


def trend(orders, window, previous, currency):
    current = daily_series(orders, window, currency, amount=True)
    earlier = daily_series(orders, previous, currency, amount=True)
    dates = [window["start"] + timedelta(days=offset) for offset in range(len(current))]
    return {
        "chart": {"dates": [day.isoformat() for day in dates], "current": current, "previous": earlier},
        "daily": list(zip(dates, current, earlier)),
    }


def overview(orders, window, previous, currency):
    current_orders = queries.order_figures(orders, window)
    prior_orders = queries.order_figures(orders, previous)
    current_sales = by_currency(current_orders).get(currency, {})
    prior_sales = by_currency(prior_orders).get(currency, {})
    current_finance = by_currency(queries.finance_figures(orders, window)).get(currency, {})
    prior_finance = by_currency(queries.finance_figures(orders, previous)).get(currency, {})

    def buyers(period):
        return accepted(orders, period).aggregate(count=Count("buyer_id", distinct=True))["count"]

    def metric(label, note, icon, current, earlier, unit=""):
        return {"label": label, "note": note, "icon": icon, "value": number(current), "unit": unit, "change": delta(current, earlier)}

    current_logistics = queries.logistics_figures(orders, window)
    prior_logistics = queries.logistics_figures(orders, previous)
    logistics_labels = {"dispatched": _("Dispatched"), "delivered": _("Delivered"), "completed": _("Completed")}

    return {
        "metrics": [
            metric(_("Accepted order value"), _("After approved amendments and cancellations"), "receipt_long",
                   amount(current_sales, "accepted_total"), amount(prior_sales, "accepted_total"), currency),
            metric(_("Goods received"), _("Recorded goods receipts"), "payments",
                   amount(current_finance, "goods_received"), amount(prior_finance, "goods_received"), currency),
            metric(_("Accepted orders"), _("Across both currencies"), "shopping_cart",
                   sum(row["accepted"] for row in current_orders), sum(row["accepted"] for row in prior_orders)),
            metric(_("Active buyers"), _("Distinct buyers across both currencies"), "group", buyers(window), buyers(previous)),
        ],
        "trend": trend(orders, window, previous, currency),
        "logistics": [
            {"label": label, "value": current_logistics[key], "change": delta(current_logistics[key], prior_logistics[key])}
            for key, label in logistics_labels.items()
        ],
        "queues": queries.queues(orders, dict.fromkeys(queries.SECTIONS, True)),
    }


def orders_detail(orders, window, previous, currency):
    current = by_currency(queries.order_figures(orders, window)).get(currency, {})
    earlier = by_currency(queries.order_figures(orders, previous)).get(currency, {})

    def rate(row):
        return Decimal(row["cancelled"]) / row["accepted"] * 100 if row.get("accepted") else None

    comparison_rows = [
        comparison(_("Accepted orders"), current.get("accepted", 0), earlier.get("accepted", 0)),
        comparison(_("Cancelled orders"), current.get("cancelled", 0), earlier.get("cancelled", 0)),
        comparison(_("Cancellation rate"), rate(current), rate(earlier), points=True),
        comparison(_("Original goods value"), amount(current, "goods_total"), amount(earlier, "goods_total")),
        comparison(_("Effective order value"), amount(current, "accepted_total"), amount(earlier, "accepted_total")),
    ]
    daily = daily_series(orders, window, currency, amount=False)
    step = (len(daily) + 9) // 10
    volume = []
    for offset in range(0, len(daily), step):
        first = window["start"] + timedelta(days=offset)
        last = window["start"] + timedelta(days=min(offset + step, len(daily)) - 1)
        volume.append({"start": first, "end": last, "value": sum(daily[offset:offset + step])})
    scale = max((row["value"] for row in volume), default=0)
    return {
        "order_comparison": compare_table(comparison_rows),
        "volume": [{**row, "bar": round(row["value"] / scale * 100)} for row in volume] if scale else [],
    }


def finance_detail(orders, window, previous, currency):
    rows = queries.finance_figures(orders, window)
    current = by_currency(rows).get(currency, {})
    earlier = by_currency(queries.finance_figures(orders, previous)).get(currency, {})
    goods = {
        "goods_received": _("Goods received"), "goods_receipts": _("Receipts"), "goods_refunded": _("Goods refunds"),
        "goods_net": _("Net received"), "refund_due_created": _("New refund amounts due"),
    }
    delivery = {"delivery_received": _("Delivery received"), "delivery_refunded": _("Delivery refunds")}

    def money_table(measures):
        return table([_("Currency"), *measures.values()], [
            {"label": row["currency"], "values": [number(row[field]) for field in measures]}
            for row in rows
        ])

    return {
        "goods": money_table(goods),
        "delivery": money_table(delivery),
        "finance_comparison": compare_table([
            comparison(label, amount(current, field), amount(earlier, field))
            for field, label in (goods | delivery).items() if field != "goods_receipts"
        ]),
    }


def sellers_detail(orders, window, currency):
    current = by_currency(queries.order_figures(orders, window)).get(currency, {})
    total = amount(current, "accepted_total")
    sellers = [row for row in queries.platform_sellers(window) if row["currency"] == currency]
    locations = list(
        accepted(orders, window)
        .values(city=F("snapshot__terms__destination__city"), country=F("snapshot__terms__destination__country"))
        .annotate(count=Count("pk"))
        .order_by("-count", "city", "country")[:6]
    )
    scale = locations[0]["count"] if locations else 1
    return {
        "sellers": table([_("Seller"), _("Accepted orders"), _("Accepted value"), _("Value share")], [
            {
                "label": row["name"],
                "url": reverse("admin:organizations_businessprofile_change", args=[row["seller"]]),
                "values": [row["accepted"], number(row["accepted_total"]),
                           f'{number(row["accepted_total"] / total * 100, 1)}%' if total else "—"],
            }
            for row in sellers
        ]),
        "locations": [
            {"label": row["city"] or row["country"] or _("Unknown destination"),
             "country": row["country"] if row["city"] else "", "value": row["count"],
             "bar": round(row["count"] / scale * 100)}
            for row in locations
        ],
    }


def dashboard(orders, window, *, tab, currency):
    """Only run the queries needed for the selected report view."""
    previous = previous_window(window)
    if tab == "orders":
        report = orders_detail(orders, window, previous, currency)
    elif tab == "finance":
        report = finance_detail(orders, window, previous, currency)
    elif tab == "sellers":
        report = sellers_detail(orders, window, currency)
    else:
        report = overview(orders, window, previous, currency)
    return {"previous": previous, **report}
