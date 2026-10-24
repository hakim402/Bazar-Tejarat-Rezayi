"""Read-only, owner-authorized operational summaries. No synthetic business metrics."""

from datetime import timedelta

from django.conf import settings
from django.db.models import Count, Q
from django.db.models.functions import TruncDate
from django.urls import reverse
from django.utils import timezone
from django.utils.translation import gettext_lazy as _

from apps.catalogue.models import Product, SourceRevision
from apps.site.models import HeroSlide
from apps.verification.models import ReviewCase

from .admin_copy import COPY
from .models import Account, AuditEvent, User
from .services import get_grant


def activity_series():
    """Two bounded aggregate queries; never load individual identities for a chart."""
    today = timezone.localdate()
    first = today - timedelta(days=13)
    last = today + timedelta(days=1)
    dates = [first + timedelta(days=offset) for offset in range(14)]

    def daily(model, field):
        return dict(
            model.objects.filter(**{field + "__date__gte": first, field + "__date__lt": last})
            .annotate(day=TruncDate(field)).values("day").annotate(total=Count("pk"))
            .values_list("day", "total")
        )

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
    accounts = Account.objects.aggregate(
        sellers=Count("id", filter=Q(context="seller", status="active", user__is_active=True)),
        staff=Count("id", filter=Q(context="staff", status="active", user__is_active=True)),
    )
    metrics = [
        {"label": _("Registered users"), "value": User.objects.count(), "icon": "group",
         "note": _("All registered identities"), "url": link("accounts_user_changelist")},
        {"label": _("Active seller accounts"), "value": accounts["sellers"], "icon": "storefront",
         "note": _("Active accounts; verification is separate"), "url": link("accounts_account_changelist") + "?context__exact=seller&status__exact=active"},
        {"label": _("Catalogue products"), "value": Product.objects.count(), "icon": "inventory_2",
         "note": _("Across all publication states"), "url": link("catalogue_product_changelist")},
        {"label": _("Enabled hero slides"), "value": HeroSlide.objects.filter(enabled=True).count(), "icon": "view_carousel",
         "note": _("Site presentation; not product inventory"), "url": link("site_hero")},
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
    ]
    events = [
        {"label": event.action.replace("_", " ").capitalize(),
         "actor": event.actor.display_name if event.actor else COPY["system"],
         "created_at": event.created_at,
         "url": reverse("admin:accounts_auditevent_change", args=[event.pk])}
        for event in AuditEvent.objects.select_related("actor").order_by("-created_at", "-pk")[:6]
    ]
    context.update(
        admin_copy=COPY, metrics=metrics, queues=queues, recent_events=events,
        pending_total=sum(queue["count"] for queue in queues), series=activity_series(),
        frontend_url=settings.FRONTEND_ORIGIN + "/en",
        shortcuts=[
            {"label": _("Manage products"), "description": _("Catalogue and publication workflows"),
             "icon": "inventory_2", "url": link("catalogue_product_changelist")},
            {"label": _("Review organizations"), "description": _("Seller and business profiles"),
             "icon": "business", "url": link("organizations_businessprofile_changelist")},
            {"label": _("Site Settings"), "description": _("Identity, appearance and homepage hero"),
             "icon": "settings", "url": link("site_settings")},
        ],
    )
    return context
