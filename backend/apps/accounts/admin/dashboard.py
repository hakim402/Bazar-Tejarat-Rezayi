"""Read-only, owner-authorized operational summaries. No synthetic business metrics."""

from datetime import datetime, time, timedelta

from django.conf import settings
from django.db.models import Count, Q
from django.urls import reverse
from django.utils import timezone
from django.utils.translation import gettext_lazy as _

from apps.catalogue.models import Product, SourceRevision
from apps.fulfilment.models import ReviewCase as DeliveryReviewCase
from apps.orders.models import CancellationRequest
from apps.payments.models import ReviewCase as PaymentReviewCase
from apps.verification.models import ReviewCase

from .copy import COPY
from .locale import frontend_locale
from .theme import THEME
from ..models import AuditEvent, User
from ..services import get_grant


def week_bounds():
    """Current and previous 7-day windows in Kabul time; today is included."""
    today = timezone.localdate()
    zone = timezone.get_current_timezone()
    start = datetime.combine(today - timedelta(days=6), time.min, tzinfo=zone)
    previous = datetime.combine(today - timedelta(days=13), time.min, tzinfo=zone)
    end = datetime.combine(today + timedelta(days=1), time.min, tzinfo=zone)
    return previous, start, end


def week_delta(model, field):
    """Truthful last-7-days vs previous-7-days comparison; no invented percentages."""
    previous, start, end = week_bounds()
    values = model.objects.filter(**{field + "__gte": previous, field + "__lt": end}).aggregate(
        current=Count("pk", filter=Q(**{field + "__gte": start})),
        earlier=Count("pk", filter=Q(**{field + "__lt": start})),
    )
    current, earlier = values["current"], values["earlier"]
    percent = round((current - earlier) / earlier * 100) if earlier else None
    direction = "up" if current > earlier else "down" if current < earlier else "flat"
    return {"current": current, "previous": earlier, "percent": percent, "direction": direction}


def activity_series():
    """Two bounded aggregate queries; never load individual identities for a chart."""
    today = timezone.localdate()
    first = today - timedelta(days=13)
    last = today + timedelta(days=1)
    dates = [first + timedelta(days=offset) for offset in range(14)]

    def daily(model, field):
        zone = timezone.get_current_timezone()
        bounds = [datetime.combine(day, time.min, tzinfo=zone) for day in [*dates, last]]
        values = model.objects.filter(**{field + "__gte": bounds[0], field + "__lt": bounds[-1]}).aggregate(**{
            f"day_{i}": Count("pk", filter=Q(**{field + "__gte": bounds[i], field + "__lt": bounds[i + 1]}))
            for i in range(len(dates))})
        return {day: values[f"day_{i}"] for i, day in enumerate(dates)}

    users, products = daily(User, "date_joined"), daily(Product, "created_at")
    maximum = max([1, *users.values(), *products.values()])
    return [
        {"date": day, "accounts": users.get(day, 0), "products": products.get(day, 0),
         "x": 30 + index * 44,
         "accounts_height": round(users.get(day, 0) / maximum * 130, 2),
         "products_height": round(products.get(day, 0) / maximum * 130, 2),
         "products_x": 44 + index * 44,
         "accounts_y": 155 - round(users.get(day, 0) / maximum * 130, 2),
         "products_y": 155 - round(products.get(day, 0) / maximum * 130, 2)}
        for index, day in enumerate(dates)
    ]


def dashboard_context(request, context):
    # Defense in depth: summaries must not become a public or staff reporting endpoint.
    get_grant(request, "owner")
    def link(name):
        return reverse("admin:" + name)
    # Operational signals the Commerce report does not surface: identity/catalogue
    # growth and the total of every open moderation queue. Commerce KPIs (orders,
    # receipts, deliveries) and the per-queue breakdown live on the report page.
    user_delta = week_delta(User, "date_joined")
    product_delta = week_delta(Product, "created_at")
    pending_total = (
        ReviewCase.objects.filter(status__in=["submitted", "under_review"]).count()
        + SourceRevision.objects.filter(state="submitted").count()
        + PaymentReviewCase.objects.filter(state="open").count()
        + DeliveryReviewCase.objects.filter(state="open").count()
        + CancellationRequest.objects.filter(state="pending").count()
    )
    metrics = [
        {"label": COPY["accounts"], "value": user_delta["current"], "icon": "person_add",
         "note": COPY["new_this_week"], "url": link("accounts_user_changelist"), "delta": user_delta},
        {"label": COPY["products"], "value": product_delta["current"], "icon": "inventory_2",
         "note": COPY["new_this_week"], "url": link("catalogue_product_changelist"), "delta": product_delta},
        {"label": COPY["pending"], "value": pending_total, "icon": "fact_check",
         "note": COPY["review_queue"], "url": link("reports_commerce"), "chip": COPY["open_queue"]},
    ]
    events = [
        {"label": event.action.replace("_", " ").capitalize(),
         "actor": event.actor.display_name if event.actor else COPY["system"],
         "created_at": event.created_at,
         "url": reverse("admin:accounts_auditevent_change", args=[event.pk])}
        for event in AuditEvent.objects.select_related("actor").order_by("-created_at", "-pk")[:6]
    ]
    series = activity_series()
    # The class map must NOT use the ``theme`` context key: Unfold's skeleton
    # builds <html x-data="theme('…')"> from it, and a dict there breaks Alpine
    # (undefined sidebarOpen hides the whole sidebar on this page only).
    context.update(
        admin_copy=COPY, rz_theme=THEME, metrics=metrics, recent_events=events,
        pending_total=pending_total, series=series,
        frontend_url=settings.FRONTEND_ORIGIN + "/" + frontend_locale(getattr(request, "LANGUAGE_CODE", "en")),
        shortcuts=[
            {"label": _("Manage products"), "description": _("Catalogue and publication workflows"),
             "icon": "inventory_2", "url": link("catalogue_product_changelist")},
            {"label": _("Review organizations"), "description": _("Seller and business profiles"),
             "icon": "business", "url": link("organizations_businessprofile_changelist")},
            {"label": _("Goods payment review"), "description": _("Independent receipt and refund decisions"),
             "icon": "fact_check", "url": link("payments_reviewcase_changelist")},
            {"label": _("Site Settings"), "description": _("Identity, appearance and homepage hero"),
             "icon": "settings", "url": link("site_settings")},
        ],
    )
    return context
