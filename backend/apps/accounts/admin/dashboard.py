"""The owner's daily work overview."""

from django.urls import reverse
from django.utils.translation import get_language, gettext_lazy as _

from .review_queues import queue_context
from .theme import THEME


OVERVIEW_COPY = {
    "urgent_one": ("urgent queue needs your attention.", "صف فوری نیازمند توجه شماست."),
    "urgent_many": ("urgent queues need your attention.", "صف فوری نیازمند توجه شماست."),
    "clear": ("Your urgent queues are clear.", "هیچ مورد بازی در صف‌های فوری نیست."),
    "open_queues": ("Open review queues", "باز کردن صف‌های بررسی"),
    "open_one": ("open queue", "صف باز"),
    "open_many": ("open queues", "صف باز"),
    "work_one": ("queue with work", "صف دارای کار"),
    "work_many": ("queues with work", "صف دارای کار"),
    "quick_access": ("Quick access", "دسترسی سریع"),
    "browse": ("Browse all pages", "دیدن همهٔ صفحه‌ها"),
    "independent": ("Independent review", "بررسی مستقل"),
    "independent_note": (
        "A case may need a different reviewer if the owner is ineligible.",
        "اگر مدیر واجد شرایط نباشد، ممکن است پرونده به بررسی‌کنندهٔ دیگری نیاز داشته باشد.",
    ),
}


def dashboard_context(request, context):
    from .site import owner_site

    work = queue_context(owner_site, request, overview=True)
    language = int(get_language() == "fa-af")
    overview_link_labels = {
        "Products": "برسی محصولات کاربران",
        "Users": "کاربران ثبت شده",
    } if language else {}
    priorities = work["priority_counts"]
    urgent = priorities[0]["count"]
    context.update(
        **work,
        rz_theme=THEME,
        overview_copy={key: labels[language] for key, labels in OVERVIEW_COPY.items()},
        overview_urgent_count=urgent,
        overview_priority_slots=[
            priority["color"]
            for priority in priorities
            for _ in range(priority["count"])
        ],
        overview_links=[
            {"label": overview_link_labels.get(label, _(label)), "icon": icon, "url": reverse(f"admin:{route}")}
            for label, icon, route in (
                ("Accepted orders", "receipt_long", "orders_sellerorder_changelist"),
                ("Products", "inventory_2", "catalogue_product_changelist"),
                ("Users", "group", "accounts_user_changelist"),
                ("Site Settings", "tune", "site_settings"),
                ("Commerce reports", "monitoring", "reports_commerce"),
            )
        ],
    )
    return context
