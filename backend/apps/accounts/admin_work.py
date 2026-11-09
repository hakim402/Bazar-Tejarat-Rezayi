"""Staff "My work": open-queue counts read through each ModelAdmin's own permission and scope."""

from django.apps import apps
from django.db.models import Exists, OuterRef, Q
from django.urls import NoReverseMatch, reverse


def _refund_open():
    RefundReport = apps.get_model("payments", "RefundReport")
    return Q(Exists(RefundReport.objects.filter(due_id=OuterRef("pk"), decision__isnull=True)))


# (label, app, model, open filter, assignee target: "user" | "account" | None, changelist query)
QUEUES = (
    ("Business verification", "verification", "ReviewCase",
     lambda: Q(status__in=["submitted", "under_review"]), "account", ""),
    ("Catalogue publication", "catalogue", "SourceRevision", lambda: Q(state="submitted"), None, "state__exact=submitted"),
    ("Store pages", "marketplace", "StoreRevision", lambda: Q(state="submitted"), "account", ""),
    ("Goods payment cases", "payments", "ReviewCase", lambda: Q(state="open"), "user", ""),
    ("Refund reports", "payments", "RefundDue", _refund_open, "user", ""),
    ("Delivery cases", "fulfilment", "ReviewCase", lambda: Q(state="open"), "user", ""),
    ("Cancellation requests", "orders", "CancellationRequest", lambda: Q(state="pending"), "user", ""),
    ("Amendments", "orders", "Amendment", lambda: Q(state="pending"), "user", ""),
    ("Disputes", "orders", "DisputeRequest", lambda: Q(state="pending"), "user", ""),
    ("Reviews awaiting moderation", "orders", "Review", lambda: Q(state="pending"), None, ""),
    ("Message reports", "messaging", "Report", lambda: Q(status="open"), "account", ""),
)


def my_work(site, request, actor):
    rows = []
    for label, app_label, name, open_filter, target, query in QUEUES:
        model = apps.get_model(app_label, name)
        model_admin = site._registry.get(model)
        if model_admin is None or not model_admin.has_view_permission(request):
            continue
        open_items = model_admin.get_queryset(request).filter(open_filter()).order_by().distinct()
        row = {"label": label, "open": open_items.count(), "mine": None, "unassigned": None}
        if target:
            me = request.user if target == "user" else actor.account
            row["mine"] = open_items.filter(assigned_to=me).count()
            row["unassigned"] = open_items.filter(assigned_to__isnull=True).count()
        try:
            url = reverse(f"admin:{app_label}_{name.lower()}_changelist", current_app=site.name)
            row["url"] = f"{url}?{query}" if query else url
        except NoReverseMatch:
            row["url"] = ""
        rows.append(row)
    return rows
