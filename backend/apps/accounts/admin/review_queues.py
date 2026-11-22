"""Read-only owner work lists. Native case pages still own every decision."""

from dataclasses import dataclass
from typing import Callable
from urllib.parse import urlencode

from django.db.models import Count, Q, QuerySet
from django.shortcuts import render
from django.urls import reverse
from django.utils import timezone
from django.utils.translation import get_language, gettext_lazy as _
from django.views.decorators.http import require_safe

from apps.inventory.queries import unresolved_shortage_roots
from apps.notifications.models import DELIVERY_FAILURE_STATUSES
from apps.payments.queries import awaiting_refund_report, awaiting_refund_review
from apps.payments.refunds import refunds_requiring_another_confirmer
from apps.runtime.jobs import overdue_jobs, scheduler_needs_attention
from apps.verification.services import cases_requiring_another_reviewer

from ..services import get_grant
from .theme import THEME


# Admin supports English and Dari. Keep new labels available in both languages
# alongside the existing gettext catalogue used for native model labels.
LABELS = {
    "title": ("Review queues", "صف‌های بررسی"),
    "all": ("All", "همه"),
    "urgent": ("Urgent", "فوری"),
    "today": ("Today", "امروز"),
    "routine": ("Routine", "عادی"),
    "trading": ("Orders & money", "سفارش‌ها و پرداخت‌ها"),
    "platform": ("Platform", "سیستم"),
    "priority": ("Priority", "اولویت"),
    "items": ("Items", "موارد"),
    "item": ("Item", "مورد"),
    "open_queues": ("Queues with work", "صف‌های دارای کار"),
    "by_priority": ("Work by priority", "کارها براساس اولویت"),
    "review_urgent": ("Review urgent queues", "بررسی صف‌های فوری"),
    "view_queues": ("View all review queues", "دیدن همهٔ صف‌های بررسی"),
    "queue_area": ("Queue area", "بخش صف"),
    "empty": ("No open items in these queues.", "در این صف‌ها مورد بازی وجود ندارد."),
    "overlap": (
        "Priority is set by queue type. An order may appear in more than one queue.",
        "اولویت براساس نوع صف تعیین می‌شود. ممکن است یک سفارش در بیش از یک صف دیده شود.",
    ),
    "independent": (
        "This case needs a different independent reviewer.",
        "این پرونده به بررسی‌کنندهٔ مستقل دیگری نیاز دارد.",
    ),
    "assignment": (
        "Only the assigned eligible reviewer can record a decision.",
        "تنها بررسی‌کنندهٔ واجد شرایطِ تعیین‌شده می‌تواند تصمیم را ثبت کند.",
    ),
    "eligibility_note": (
        "Open a case to check assignment and reviewer eligibility.",
        "برای بررسی واگذاری و شرایط بررسی‌کننده، پرونده را باز کنید.",
    ),
    "uncertain_delivery": ("Uncertain notification delivery", "ارسال نامشخص اعلان‌ها"),
    "exhausted_delivery": ("Notification retries exhausted", "پایان تلاش‌های ارسال اعلان"),
    "failed_jobs": ("Failed jobs", "کارهای ناموفق سیستم"),
    "scheduler_attention": ("Scheduler needs attention", "زمان‌بند نیازمند بررسی است"),
    "overdue_jobs": ("Overdue jobs", "کارهای به‌تأخیرافتاده"),
    "aftercare_email_issues": ("Aftercare email issues", "مشکلات ایمیل پیگیری سفارش"),
    "refunds_awaiting_report": ("Refunds awaiting seller report", "بازپرداخت‌های منتظر گزارش فروشنده"),
    "verification_needs_reviewer": ("Verification needs an independent reviewer", "تأیید کسب‌وکار نیازمند بررسی‌کنندهٔ مستقل"),
    "dispute_refund_needs_reviewer": ("Dispute refunds need another confirmer", "بازپرداخت اختلاف‌ها نیازمند تأییدکنندهٔ دیگری است"),
    "another_reviewer": ("Needs another reviewer", "نیازمند بررسی‌کنندهٔ دیگر"),
    "unassigned": ("Unassigned", "واگذار نشده"),
    "assigned_elsewhere": ("Assigned to another reviewer", "واگذارشده به بررسی‌کنندهٔ دیگر"),
    "unresolved_shortages": ("Unresolved shortages", "کمبودهای حل‌نشده"),
}

PRIORITY_STYLES = {"urgent": "danger", "today": "warning", "routine": "default"}
AREAS = {"trading": "receipt_long", "marketplace": "storefront", "platform": "settings_suggest"}


def review_labels():
    index = int(get_language() == "fa-af")
    return {key: values[index] for key, values in LABELS.items()}


def refund_review_scope(queryset):
    return queryset.filter(awaiting_refund_review())


def refund_report_scope(queryset):
    return queryset.filter(awaiting_refund_report())


def overdue_job_scope(queryset):
    return queryset.filter(overdue_jobs(timezone.now()))


def aftercare_delivery_scope(queryset):
    return queryset.filter(status__in=DELIVERY_FAILURE_STATUSES)


def scheduler_issue_count(queryset):
    return int(scheduler_needs_attention(queryset.filter(pk="cron").first(), timezone.now()))


@dataclass(frozen=True)
class Queue:
    label: str
    icon: str
    model: str
    area: str
    priority: str
    field: str = ""
    value: str | tuple[str, ...] = ""
    scope: Callable[[QuerySet], QuerySet] | None = None
    user_scope: Callable[..., Q] | None = None
    counter: Callable[[QuerySet], int] | None = None
    assignments: bool = False

    def open_items(self, queryset, user):
        if self.user_scope:
            return queryset.filter(self.user_scope(user))
        return self.scope(queryset) if self.scope else queryset.filter(**{self.field: self.value})

    def url(self, native):
        if not self.field:
            return native
        value = ",".join(self.value) if isinstance(self.value, tuple) else self.value
        return f"{native}?{urlencode({self.field: value})}"


# Use the same lookup for the count and destination. Payment, delivery and
# aftercare ModelAdmins allow raw state, while ordinary list filters use __exact.
QUEUES = (
    Queue(_("Goods payment review"), "payments", "payments.ReviewCase", "trading", "urgent", "state", "open",
          assignments=True),
    Queue(_("Goods refund review"), "currency_exchange", "payments.RefundDue", "trading", "urgent",
          "refund_review", "pending", refund_review_scope, assignments=True),
    Queue(_("Delivery review"), "local_shipping", "fulfilment.ReviewCase", "trading", "urgent", "state", "open",
          assignments=True),
    Queue(_("Order disputes"), "gavel", "orders.DisputeRequest", "trading", "urgent", "state", "pending",
          assignments=True),
    Queue("dispute_refund_needs_reviewer", "group", "payments.RefundDue", "trading", "urgent",
          "refund_review", "another_confirmer", user_scope=refunds_requiring_another_confirmer),
    Queue(_("Cancellation requests"), "cancel", "orders.CancellationRequest", "trading", "today", "state", "pending",
          assignments=True),
    Queue(_("Amendments"), "edit_note", "orders.Amendment", "trading", "today", "state", "pending",
          assignments=True),
    Queue("refunds_awaiting_report", "currency_exchange", "payments.RefundDue", "trading", "today",
          "refund_review", "awaiting_report", refund_report_scope),
    Queue("unresolved_shortages", "warning", "inventory.Shortage", "trading", "today",
          "shortage_state", "unresolved_roots", unresolved_shortage_roots),
    Queue(_("Business verification"), "verified_user", "verification.ReviewCase", "marketplace", "today",
          "status__in", ("submitted", "under_review")),
    Queue("verification_needs_reviewer", "group", "verification.ReviewCase", "marketplace", "today",
          "reviewer", "independent", user_scope=cases_requiring_another_reviewer),
    Queue(_("Content & order reports"), "flag", "messaging.Report", "marketplace", "today", "status__exact", "open"),
    Queue(_("Product source review"), "inventory_2", "catalogue.SourceRevision", "marketplace", "routine",
          "state__exact", "submitted"),
    Queue(_("Store reviews"), "storefront", "marketplace.StoreRevision", "marketplace", "routine",
          "state__exact", "submitted"),
    Queue(_("Buyer reviews"), "rate_review", "orders.Review", "marketplace", "routine", "state", "pending"),
    Queue("scheduler_attention", "schedule", "runtime.Scheduler", "platform", "routine", counter=scheduler_issue_count),
    Queue("overdue_jobs", "hourglass_empty", "runtime.Job", "platform", "routine",
          "attention", "overdue", overdue_job_scope),
    Queue("failed_jobs", "error", "runtime.Job", "platform", "routine", "state__exact", "failed"),
    Queue("uncertain_delivery", "mail", "notifications.Outbox", "platform", "routine",
          "status__exact", "delivery_unknown"),
    Queue("exhausted_delivery", "mail", "notifications.Outbox", "platform", "routine", "status__exact", "exhausted"),
    Queue("aftercare_email_issues", "mail", "notifications.AftercareEmail", "platform", "routine",
          "delivery", "issues", aftercare_delivery_scope),
)


def owner_queue_rows(site, request, labels):
    get_grant(request, "owner")
    available = {
        record["model"]._meta.label: record
        for app in site.get_app_list(request)
        for record in app["models"]
        if record.get("admin_url")
    }
    rows = []
    for queue in QUEUES:
        record = available.get(queue.model)
        if record is None:
            continue
        # Operational changelists can audit inspection. These count queries use
        # the owner's model scope without opening any guarded case workspace.
        queryset = record["model"]._default_manager.all()
        unassigned = assigned_elsewhere = 0
        if queue.counter:
            count = queue.counter(queryset)
        else:
            open_items = queue.open_items(queryset, request.user)
            if queue.assignments:
                counts = open_items.aggregate(
                    total=Count("pk"),
                    unassigned=Count("pk", filter=Q(assigned_to__isnull=True)),
                    assigned_elsewhere=Count(
                        "pk", filter=Q(assigned_to__isnull=False) & ~Q(assigned_to=request.user),
                    ),
                )
                count, unassigned, assigned_elsewhere = (
                    counts["total"], counts["unassigned"], counts["assigned_elsewhere"],
                )
            else:
                count = open_items.count()
        rows.append({
            "label": labels.get(queue.label, queue.label),
            "icon": queue.icon,
            "area": queue.area,
            "priority": queue.priority,
            "priority_label": labels[queue.priority],
            "badge_class": THEME["queue_badge"][PRIORITY_STYLES[queue.priority]],
            "count": count,
            "unassigned": unassigned,
            "assigned_elsewhere": assigned_elsewhere,
            "url": queue.url(record["admin_url"]),
        })
    return rows


def filter_url(base, *, area="all", priority="all", anchor=""):
    query = urlencode({key: value for key, value in (("area", area), ("priority", priority)) if value != "all"})
    return base + (f"?{query}" if query else "") + anchor


def queue_context(site, request, *, overview=False):
    labels = review_labels()
    labels["marketplace"] = _("Marketplace")
    rows = owner_queue_rows(site, request, labels)
    active = [row for row in rows if row["count"]]
    area = request.GET.get("area")
    area = area if not overview and area in AREAS else "all"
    priority = request.GET.get("priority")
    priority = priority if priority in PRIORITY_STYLES else "all"
    hub_url = reverse("admin:review_queues", current_app=site.name)
    filter_base = reverse("admin:index", current_app=site.name) if overview else hub_url
    anchor = "#queue-work" if overview else ""
    visible = [
        row for row in active
        if (area == "all" or area == row["area"]) and (priority == "all" or priority == row["priority"])
    ]
    return {
        "queue_labels": labels,
        "queue_rows": visible[:5] if overview else visible,
        "queue_filters_active": area != "all" or priority != "all",
        "active_queue_count": len(active),
        "visible_queue_count": len(visible),
        "queue_hub_url": hub_url,
        "urgent_queue_url": filter_url(hub_url, priority="urgent"),
        "queue_areas": [
            {"label": labels[key], "icon": icon, "url": filter_url(hub_url, area=key),
             "icon_class": THEME["overview_area_icons"][key],
             "count": sum(row["area"] == key for row in active)}
            for key, icon in AREAS.items()
        ],
        "priority_counts": [
            {"label": labels[key], "color": THEME["overview_priority_colors"][key],
             "count": sum(row["priority"] == key for row in active)}
            for key in PRIORITY_STYLES
        ],
        "queue_priority_filters": [
            {"label": labels[key], "url": filter_url(filter_base, area=area, priority=key, anchor=anchor),
             "selected": priority == key}
            for key in ("all", *PRIORITY_STYLES)
        ],
        "queue_area_filters": [
            {"label": labels[key], "url": filter_url(hub_url, area=key, priority=priority), "selected": area == key}
            for key in ("all", *AREAS)
        ],
    }


@require_safe
def review_queues(request, site):
    context = queue_context(site, request)
    groups = {priority: [] for priority in PRIORITY_STYLES}
    for row in context["queue_rows"]:
        groups[row["priority"]].append(row)
    context["queue_groups"] = [
        {
            "key": priority,
            "label": context["queue_labels"][priority],
            "badge_class": THEME["queue_badge"][PRIORITY_STYLES[priority]],
            "rows": rows,
        }
        for priority, rows in groups.items() if rows
    ]
    request.current_app = site.name
    return render(request, "accounts/admin/review_queues.html", {
        **site.each_context(request), **context,
        "title": context["queue_labels"]["title"],
        "rz_theme": THEME,
    })
