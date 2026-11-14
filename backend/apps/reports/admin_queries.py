"""Read-only aggregates for the native admin commerce dashboard.

Presentation-only helpers: they reuse the locked report queries and never mutate
business records. Amounts stay exact Decimals per currency; AFN and USD are never
combined or converted. Shared seller/buyer report contracts are untouched.
"""

from datetime import timedelta
from decimal import Decimal

from django.db.models import Count, F
from django.utils import timezone

from apps.orders import aftercare

from . import queries


def previous_window(window):
    """The equal-length window immediately before the selected one, for deltas."""
    days = (window["end"] - window["start"]).days + 1
    end = window["start"] - timedelta(days=1)
    return queries.period(end - timedelta(days=days - 1), end)


def delta(current, previous):
    """Direction plus rounded percent change; 'new' when there was no base."""
    current, previous = Decimal(current), Decimal(previous)
    if current == previous:
        return {"direction": "flat", "percent": None}
    if previous == 0:
        return {"direction": "up" if current > 0 else "flat", "percent": None, "current": str(current)}
    percent = (current - previous) / previous * 100
    rounded = round(percent, 1)
    return {
        "direction": "up" if percent > 0 else "down",
        "percent": str(int(rounded)) if rounded == int(rounded) else str(rounded),
    }


def accepted(orders, window):
    return aftercare.annotate(orders.filter(**queries.within("accepted_at", window)))


def daily_totals(orders, window):
    """Zero-filled per-currency accepted totals for each day of the window.

    Bucketed in Python from the recorded local dates: MariaDB CONVERT_TZ can
    return NULL when its timezone tables are absent, so no DB date truncation.
    """
    days = (window["end"] - window["start"]).days + 1
    buckets = {currency: [Decimal(0)] * days for currency in queries.CURRENCIES}
    for when, currency, total in accepted(orders, window).values_list("accepted_at", "currency", "accepted_total"):
        offset = (timezone.localtime(when).date() - window["start"]).days
        if currency in buckets and 0 <= offset < days:
            buckets[currency][offset] += total or Decimal(0)
    return buckets


def location_rows(orders, window, limit=6):
    """Accepted order counts by the recorded delivery destination city."""
    rows = (
        accepted(orders, window)
        .values(city=F("snapshot__terms__destination__city"), country=F("snapshot__terms__destination__country"))
        .annotate(count=Count("pk"))
        .order_by("-count", "city")[:limit]
    )
    return [{"city": row["city"] or "", "country": row["country"] or "", "count": row["count"]} for row in rows]


def money_kpi(current_rows, previous_rows, key):
    """Primary-currency headline plus the other currencies, with a delta."""
    amounts = {row["currency"]: row[key] for row in current_rows}
    previous = {row["currency"]: Decimal(row[key]) for row in previous_rows}
    primary = "AFN" if "AFN" in amounts else next(iter(amounts), None)
    return {
        "primary": primary,
        "value": amounts.get(primary, "0.00"),
        "alt": [{"currency": currency, "amount": amount} for currency, amount in amounts.items() if currency != primary],
        "delta": delta(Decimal(amounts[primary]), previous.get(primary, Decimal(0))) if primary else None,
    }


def count_kpi(current, previous):
    return {"value": current, "delta": delta(current, previous)}


def dashboard(orders, window, rights):
    """Everything the admin dashboard renders, from recorded facts only."""
    previous = previous_window(window)
    current_summary = queries.summary(orders, window, rights)
    previous_summary = queries.summary(orders, previous, rights)
    series = daily_totals(orders, window)
    previous_series = daily_totals(orders, previous)
    days = (window["end"] - window["start"]).days + 1
    accepted_now = accepted(orders, window)
    accepted_before = accepted(orders, previous)
    orders_now = queries.order_figures(orders, window)
    orders_before = queries.order_figures(orders, previous)
    finance_now = current_summary["finance"] or []
    finance_before = previous_summary["finance"] or []
    logistics_now = current_summary["logistics"] or {}
    logistics_before = previous_summary["logistics"] or {}
    accepted_count = sum(row["accepted"] for row in orders_now)
    completed_before = logistics_before.get("completed", 0)
    accepted_before_count = sum(row["accepted"] for row in orders_before)
    completion = round(logistics_now.get("completed", 0) * 100 / accepted_count) if accepted_count else 0
    completion_before = round(completed_before * 100 / accepted_before_count) if accepted_before_count else 0
    locations = location_rows(orders, window)
    location_max = max((row["count"] for row in locations), default=0)
    for row in locations:
        row["share"] = round(row["count"] * 100 / location_max) if location_max else 0
    primary = "AFN" if any(row["currency"] == "AFN" for row in orders_now) else next(iter(orders_now), {}).get("currency")
    totals = {
        currency: {"current": str(sum(series[currency], Decimal(0))),
                   "previous": str(sum(previous_series[currency], Decimal(0)))}
        for currency in queries.CURRENCIES
    }
    donut = {}
    seller_rows = queries.platform_sellers(window)
    for currency in queries.CURRENCIES:
        rows = [row for row in seller_rows if row["currency"] == currency]
        entries = [{"name": row["name"], "amount": str(row["accepted_total"]), "other": False} for row in rows[:4]]
        rest = rows[4:]
        if rest:
            entries.append({"name": "", "amount": str(sum((row["accepted_total"] for row in rest), Decimal(0))), "other": True})
        donut[currency] = entries
    return {
        "days": days,
        "primary": primary,
        "totals": totals,
        "totals_primary": totals.get(primary, {"current": "0", "previous": "0"}),
        "previous": {"start": previous["start"], "end": previous["end"]},
        "dates": [(window["start"] + timedelta(days=offset)).isoformat() for offset in range(days)],
        "daily_primary": [
            {"date": (window["start"] + timedelta(days=offset)).isoformat(),
             "current": str(series[primary][offset]) if primary else "0.00",
             "previous": str(previous_series[primary][offset]) if primary else "0.00"}
            for offset in range(days)
        ],
        "series": {
            currency: {"current": [str(value) for value in series[currency]],
                       "previous": [str(value) for value in previous_series[currency]]}
            for currency in queries.CURRENCIES
        },
        "locations": locations,
        "donut": donut,
        "donut_primary": donut.get(primary, []),
        "kpis": {
            "sales": money_kpi(orders_now, orders_before, "accepted_total"),
            "orders": count_kpi(accepted_count, accepted_before_count),
            "revenue": money_kpi(finance_now, finance_before, "goods_received"),
            "customers": count_kpi(
                accepted_now.aggregate(n=Count("buyer_id", distinct=True))["n"],
                accepted_before.aggregate(n=Count("buyer_id", distinct=True))["n"],
            ),
        },
        "logistics_delta": {key: delta(logistics_now.get(key, 0), logistics_before.get(key, 0)) for key in ("dispatched", "delivered", "completed")},
        "completion": {"current": completion, "previous": completion_before,
                       "points": completion - completion_before},
    }