"""Read-only, owner-authorized operational summaries. No synthetic business metrics."""

from datetime import datetime, time, timedelta

from django.conf import settings
from django.db.models import Count, Q
from django.urls import reverse
from django.utils import timezone
from django.utils.translation import gettext_lazy as _

from apps.catalogue.models import Product, SourceRevision
from apps.fulfilment.models import Completion, ReviewCase as DeliveryReviewCase
from apps.orders.models import CancellationRequest, SellerOrder
from apps.payments.models import Receipt, ReviewCase as PaymentReviewCase
from apps.verification.models import ReviewCase

from .admin_copy import COPY
from .admin_locale import frontend_locale
from .models import AuditEvent, User
from .services import get_grant


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
    metrics = [
        {"label": _("Accepted orders"), "value": SellerOrder.objects.count(), "icon": "receipt_long",
         "note": _("Confirmed buyer–seller agreements"), "url": link("orders_sellerorder_changelist"),
         "delta": week_delta(SellerOrder, "accepted_at")},
        {"label": _("Confirmed receipts"), "value": Receipt.objects.count(), "icon": "payments",
         "note": _("Reviewed and confirmed funds"), "url": link("payments_receipt_changelist"),
         "delta": week_delta(Receipt, "created_at")},
        {"label": _("Completed deliveries"), "value": Completion.objects.count(), "icon": "task_alt",
         "note": _("Whole orders confirmed delivered"), "url": link("fulfilment_completion_changelist"),
         "delta": week_delta(Completion, "created_at")},
    ]
    queues = [
        {"label": _("Business verification"), "icon": "verified_user",
         "detail": _("Submitted and under review"),
         "count": ReviewCase.objects.filter(status__in=["submitted", "under_review"]).count(),
         "url": link("verification_reviewcase_changelist")},
        {"label": _("Product source review"), "icon": "inventory_2",
         "detail": _("Submitted source revisions"),
         "count": SourceRevision.objects.filter(state="submitted").count(),
         "url": link("catalogue_sourcerevision_changelist")},
        {"label": _("Goods payment review"), "icon": "fact_check",
         "detail": _("Open independent payment cases"),
         "count": PaymentReviewCase.objects.filter(state="open").count(),
         "url": link("payments_reviewcase_changelist")},
        {"label": _("Delivery review"), "icon": "local_shipping",
         "detail": _("Open delivery and charge cases"),
         "count": DeliveryReviewCase.objects.filter(state="open").count(),
         "url": link("fulfilment_reviewcase_changelist")},
        {"label": _("Cancellation requests"), "icon": "cancel",
         "detail": _("Pending buyer or seller requests"),
         "count": CancellationRequest.objects.filter(state="pending").count(),
         "url": link("orders_cancellationrequest_changelist")},
    ]
    events = [
        {"label": event.action.replace("_", " ").capitalize(),
         "actor": event.actor.display_name if event.actor else COPY["system"],
         "created_at": event.created_at,
         "url": reverse("admin:accounts_auditevent_change", args=[event.pk])}
        for event in AuditEvent.objects.select_related("actor").order_by("-created_at", "-pk")[:6]
    ]
    series = activity_series()
    context.update(
        admin_copy=COPY, metrics=metrics, queues=queues, recent_events=events,
        pending_total=sum(queue["count"] for queue in queues), series=series,
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
