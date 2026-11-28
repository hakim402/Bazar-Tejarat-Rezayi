"""Curated destinations derived from the freshly authorized native model directory."""

from functools import cache
from urllib.parse import parse_qs, urlencode, urlsplit

from django.urls import reverse
from django.utils.functional import lazy
from django.utils.translation import get_language, gettext_lazy as _


OWNER_NAVIGATION_DARI = {
    "Daily work": "کارهای روزانه",
    "Manage": "مدیریت",
    "Catalogue & stock": "دسته بندی محصولات ثبت شده",
    "People & stores": "کاربران و فروشگاه‌ها",
    "Delivery operations": "عملیات تحویل",
    "All delivery records": "همهٔ سوابق تحویل",
    "Not dispatched": "ارسال نشده",
    "Open holds": "توقف های باز",
    "Needs preparation": "نیازمند آماده سازی",
    "Stock shortage": "کمبود موجودی",
    "Stock unavailable": "موجودی در دسترس نیست",
    "Payment or partial-dispatch approval required": "پرداخت یا تأیید ارسال بخشی از سفارش لازم است",
    "Cancellation hold": "توقف به دلیل درخواست لغو",
    "Last attempt: %(reason)s": "آخرین تلاش: %(reason)s",
    "Check delivery workflow": "بررسی روند تحویل",
    "Website & content": "وب سایت و محتوا",
    "Site settings": "تنظیمات وب سایت",
    "Content pages": "صفحات وب سایت",
    "Payments & refunds": "پرداخت‌ها و بازپرداخت‌ها",
    "Open payment reviews": "بررسی‌های پرداخت باز",
    "Refunds needing attention": "بازپرداخت‌های نیازمند رسیدگی",
    "Confirmed receipts": "رسیدهای تأییدشده",
    "Messages & reports": "پیام ها و گزارش ها",
    "Open reports": "گزارش های باز",
    "Pending cancellations": "لغوهای در انتظار بررسی",
    "Open disputes": "اختلاف های باز",
    "Pending amendments": "تغییرات در انتظار بررسی",
    "Unresolved shortages": "کمبودهای حل نشده",
}


def navigation_title(title):
    if get_language() == "fa-af" and title in OWNER_NAVIGATION_DARI:
        return OWNER_NAVIGATION_DARI[title]
    return _(title)


def destination_key(url):
    target = urlsplit(str(url))
    return target.path, tuple(sorted((name, tuple(values)) for name, values in parse_qs(target.query).items()))


def active_destination(request, urls, index_path):
    """Prefer the most specific matching shortcut, including filters from change forms."""
    params = parse_qs(request.GET.get("_changelist_filters", ""))
    params.update(request.GET.lists())

    def current_values(name):
        alias = name.removesuffix("__exact") if name.endswith("__exact") else f"{name}__exact"
        return tuple(params.get(name, params.get(alias, ())))

    best = None
    best_score = (-1, -1)
    for url in urls:
        path, filters = destination_key(url)
        if not (request.path == path or path != index_path and request.path.startswith(path.rstrip("/") + "/")):
            continue
        if any(current_values(name) != values for name, values in filters):
            continue
        score = (len(path), len(filters))
        if score > best_score:
            best, best_score = destination_key(url), score
    return best


def review_badge(counter):
    def label():
        total = counter()
        return str(total) if total else ""

    return {"badge": lazy(label, str)(), "badge_variant": "warning", "badge_class": "shrink-0"}


def navigation(request):
    from .site import owner_site
    from .access import is_owner

    root = is_owner(request)
    available = {
        model["model"]._meta.label_lower: model for app in owner_site.get_app_list(request) for model in app["models"]
    }

    badge_counts = {}

    def entry(title, icon, model, filters=None, *, queue=None):
        record = available.get(model)
        if not record or not record.get("admin_url"):
            return None
        item = {
            "title": navigation_title(title),
            "icon": icon,
            "link": record["admin_url"] + ("?" + urlencode(filters) if filters else ""),
        }
        if queue is not None and root:
            # Reuse each count in the parent badge and its child. Evaluate it only when rendered.
            @cache
            def pending_count():
                return queue.open_items(record["model"]._default_manager.all(), request.user).count()

            item["link"] = queue.url(record["admin_url"])
            badge_counts[item["link"]] = pending_count
            item.update(review_badge(pending_count))
        return item

    overview = {"title": _("Overview"), "icon": "space_dashboard", "link": reverse("admin:index")}
    if root:
        groups = owner_groups(entry, overview)
    else:
        groups = staff_groups(entry, overview)

    section_of = {
        "commerce": "Operations", "payments": "Operations", "fulfilment": "Operations", "aftercare": "Operations",
        "catalogue": "Catalogue & Inventory", "stores": "Catalogue & Inventory", "inventory": "Catalogue & Inventory",
        "business": "Marketplace & People", "access": "Marketplace & People",
        "communication": "System & Settings", "website": "System & Settings", "system": "System & Settings",
    }
    if root:
        section_of = {
            "overview": "Daily work", "orders": "Daily work", "reviews": "Daily work", "reports": "Daily work",
            "payments": "Daily work", "delivery": "Daily work", "aftercare": "Daily work", "moderation": "Daily work",
            "catalogue": "Manage", "people": "Manage", "access": "Manage", "website": "Manage",
            "system_health": "Manage", "audit": "Manage",
        }
    index_url = overview["link"]
    visible_active = active_destination(
        request, (item["link"] for key, _, items in groups if key != "settings" for item in items if item), index_url,
    )
    settings_active = active_destination(
        request, (item["link"] for key, _, items in groups if key == "settings" for item in items if item), index_url,
    )
    icons = {
        "orders": "receipt_long", "people": "groups", "delivery": "local_shipping", "website": "language",
        "commerce": "receipt_long", "payments": "payments", "fulfilment": "local_shipping",
        "aftercare": "assignment_return", "catalogue": "inventory_2", "stores": "storefront",
        "inventory": "inventory", "business": "business", "access": "manage_accounts",
        "communication": "forum", "moderation": "forum", "system": "settings_suggest", "settings": "settings",
        "system_health": "monitoring", "audit": "policy",
    }
    result = []
    for key, title, items in groups:
        children = [item.copy() for item in items if item]
        if not children:
            continue
        active = settings_active if key == "settings" else visible_active
        for item in children:
            item["active"] = destination_key(item["link"]) == active
        if key in icons:
            parent = {
                "title": navigation_title(title), "icon": icons[key], "link": children[0]["link"],
                "active": any(item["active"] for item in children), "items": children,
            }
            if key == "people":
                counters = tuple(badge_counts[item["link"]] for item in children if item["link"] in badge_counts)
                if counters:
                    parent.update(review_badge(lambda: sum(count() for count in counters)))
            children = [parent]
        section = section_of.get(key)
        result.append({
            "key": key,
            "title": None,
            "section": navigation_title(section) if section else None,
            "collapsible": False,
            "items": children,
            "directory_only": key == "settings",
        })
    return result


def website_taxonomy_links(entry):
    return [
        entry("Categories", "category", "catalogue.category"),
        entry("Sale units", "straighten", "catalogue.saleunit"),
    ]


def owner_groups(entry, overview):
    from apps.fulfilment.queries import OPEN_HOLDS_FILTER, UNDISPATCHED_FILTER, not_dispatched, open_blockers
    from apps.site.sections import ROUTE_SECTIONS, SECTIONS
    from .review_queues import (
        CANCELLATION_QUEUE, DISPUTE_QUEUE, PAYMENT_REVIEW_QUEUE, REFUND_REVIEW_QUEUE,
        STORE_REVIEW_QUEUE, VERIFICATION_QUEUE, Queue, review_labels,
    )

    def review_link(title, queue):
        return entry(title, queue.icon, queue.model.lower(), queue=queue)

    dispatch_queue = Queue("Not dispatched", "local_shipping", "orders.SellerOrder", "trading", "today",
                           "dispatch", UNDISPATCHED_FILTER["dispatch"], scope=not_dispatched)
    hold_queue = Queue("Open holds", "pause_circle", "fulfilment.Blocker", "trading", "today",
                       "hold", OPEN_HOLDS_FILTER["hold"], scope=lambda qs: qs.filter(pk__in=open_blockers().values("pk")))

    settings = entry("Site settings", "settings", "site.sitesettings")
    settings_url = reverse("admin:site_sitesettings_change", args=(1,))
    settings_titles = {section.key: section.title for section in SECTIONS}
    main_settings_tabs = " ".join(str(section.title) for section in SECTIONS if section.key not in ROUTE_SECTIONS)
    sections = {
        key: {"title": settings_titles[key], "link": f"{settings_url}?section={key}"}
        for key in ROUTE_SECTIONS
    } if settings else {}
    pages = entry("Content pages", "description", "site.contentpage")
    return [
        ("overview", "Overview", [overview]),
        ("reviews", "Review queues", [
            {"title": review_labels()["title"], "icon": "fact_check", "link": reverse("admin:review_queues")},
        ]),
        ("reports", "Commerce reports", [
            {"title": _("Commerce reports"), "icon": "monitoring", "link": reverse("admin:reports_commerce")},
        ]),
        ("orders", "Orders", [
            entry("Accepted orders", "receipt_long", "orders.sellerorder"),
            entry("Formal requests", "request_quote", "orders.negotiation"),
            entry("Goods invoices", "description", "orders.invoice"),
        ]),
        ("payments", "Payments & refunds", [
            review_link("Open payment reviews", PAYMENT_REVIEW_QUEUE),
            review_link("Refunds needing attention", REFUND_REVIEW_QUEUE),
            entry("Confirmed receipts", "payments", "payments.receipt"),
        ]),
        ("delivery", "Delivery operations", [
            entry("Open delivery reviews", "fact_check", "fulfilment.reviewcase", {"state__exact": "open"}),
            review_link("Not dispatched", dispatch_queue),
            review_link("Open holds", hold_queue),
            entry("Shipments", "inventory_2", "fulfilment.shipment"),
        ]),
        ("aftercare", "Aftercare", [
            review_link("Open disputes", DISPUTE_QUEUE),
            review_link("Pending cancellations", CANCELLATION_QUEUE),
            entry("Pending amendments", "edit_note", "orders.amendment", {"state": "pending"}),
        ]),
        ("moderation", "Messages & reports", [
            entry("Open reports", "flag", "messaging.report", {"status__exact": "open"}),
            entry("Notification issues", "mail", "notifications.outbox", {"delivery": "issues"}),
        ]),
        ("catalogue", "Catalogue & stock", [
            entry("Products", "inventory_2", "catalogue.product"),
            entry("Product source review", "fact_check", "catalogue.sourcerevision", {"state__exact": "submitted"}),
            entry("Variants", "sell", "catalogue.variant"),
            entry("Stock positions", "inventory", "inventory.position"),
            entry("Unresolved shortages", "warning", "inventory.shortage", {"shortage_state": "unresolved_roots"}),
        ]),
        ("people", "People & stores", [
            entry("Buyer accounts", "person", "accounts.account", {"context__exact": "buyer"}),
            entry("Seller accounts", "storefront", "accounts.account", {"context__exact": "seller"}),
            entry("Business profiles", "business", "organizations.businessprofile"),
            review_link("Verification cases", VERIFICATION_QUEUE),
            entry("Public stores", "store", "marketplace.store"),
            review_link("Store reviews", STORE_REVIEW_QUEUE),
        ]),
        ("access", "Access Control", [
            entry("Users", "group", "accounts.user"),
            entry("Staff accounts", "badge", "accounts.account", {"context__exact": "staff"}),
            entry("Role Groups", "groups", "auth.group"),
            entry("Permissions", "security", "auth.permission"),
        ]),
        ("website", "Website & content", [
            pages,
            sections.get("hero"),
            sections.get("promotions"),
            entry("Featured store", "star", "marketplace.featuredstore"),
            *website_taxonomy_links(entry),
            sections.get("announcement"),
            sections.get("contacts"),
            sections.get("seo"),
            settings,
        ]),
        ("system_health", "System Health", [
            entry("Background jobs", "task_alt", "runtime.job"),
            entry("Schedulers", "schedule", "runtime.scheduler"),
        ]),
        ("audit", "Audit", [
            entry("Audit log", "policy", "accounts.auditevent"),
            entry("Admin change history", "history", "admin.logentry"),
        ]),
        ("settings", "Site Settings", [
            {**settings, "title": settings_titles["general"], "search_aliases": main_settings_tabs} if settings else None,
            *sections.values(), pages,
        ]),
    ]


def staff_groups(entry, overview):
    return [
        ("overview", "Overview", [overview]),
        (
            "commerce",
            "Orders & Invoices",
            [
                entry("Accepted orders", "receipt_long", "orders.sellerorder"),
                entry("Formal requests", "request_quote", "orders.negotiation"),
                entry("Goods invoices", "description", "orders.invoice"),
                entry("Advance due policy", "schedule", "orders.orderpolicy"),
            ],
        ),
        (
            "payments",
            "Payments & Review",
            [
                entry("Goods payment review", "fact_check", "payments.reviewcase"),
                entry("Confirmed receipts", "payments", "payments.receipt"),
                entry("Goods refund reports", "currency_exchange", "payments.refundreport"),
                entry("Payment claims", "receipt", "payments.claim"),
                entry("Receipt corrections", "edit_document", "payments.correction"),
                entry("Reservation plans", "inventory", "payments.stockplan"),
                entry("Allocation attempts", "history", "payments.allocationattempt"),
            ],
        ),
        (
            "fulfilment",
            "Delivery & Fulfilment",
            [
                entry("Delivery review", "fact_check", "fulfilment.reviewcase"),
                entry("Delivery operations", "local_shipping", "fulfilment.state"),
                entry("Shipments", "inventory_2", "fulfilment.shipment"),
                entry("Delivery charges", "receipt", "fulfilment.chargeproposal"),
                entry("Provider receipts", "payments", "fulfilment.receipt"),
                entry("Delivery refund reports", "currency_exchange", "fulfilment.deliveryrefund"),
                entry("Operational holds", "pause_circle", "fulfilment.blocker"),
                entry("Completion history", "task_alt", "fulfilment.completion"),
            ],
        ),
        (
            "aftercare",
            "Aftercare",
            [
                entry("Cancellation requests", "cancel", "orders.cancellationrequest"),
                entry("Accepted amendments", "edit_note", "orders.amendment"),
                entry("Invoice adjustments", "receipt", "orders.invoiceadjustment"),
                entry("Order disputes", "gavel", "orders.disputerequest"),
                entry("Buyer reviews", "rate_review", "orders.review"),
            ],
        ),
        (
            "catalogue",
            "Catalogue",
            [
                entry("Products", "inventory_2", "catalogue.product"),
                entry("Product source review", "fact_check", "catalogue.sourcerevision", {"state__exact": "submitted"}),
                entry("Translation review", "translate", "catalogue.translation"),
                entry("Product media", "image", "catalogue.productimage"),
            ],
        ),
        (
            "stores",
            "Marketplace & Stores",
            [
                entry("Public stores", "store", "marketplace.store"),
                entry("Store reviews", "fact_check", "marketplace.storerevision"),
                entry("Store media", "image", "marketplace.storemedia"),
            ],
        ),
        (
            "inventory",
            "Inventory",
            [
                entry("Stock positions", "inventory", "inventory.position"),
                entry("Batches", "package_2", "inventory.batch"),
                entry("Movements", "history", "inventory.movement"),
                entry("Allocations", "checklist", "inventory.allocation"),
                entry("Shortages", "warning", "inventory.shortage"),
                entry("Recovery records", "restore", "inventory.recovery"),
            ],
        ),
        (
            "business",
            "Businesses & Verification",
            [
                entry("Business profiles", "business", "organizations.businessprofile"),
                entry("Verification cases", "verified_user", "verification.reviewcase"),
                entry("Company teams", "groups", "organizations.membership"),
                entry("Ownership transfers", "swap_horiz", "organizations.ownershiptransfer"),
            ],
        ),
        (
            "access",
            "Accounts & Access",
            [
                entry("Users", "group", "accounts.user"),
                entry("Buyer accounts", "person", "accounts.account", {"context__exact": "buyer"}),
                entry("Seller accounts", "storefront", "accounts.account", {"context__exact": "seller"}),
                entry("Staff accounts", "manage_accounts", "accounts.account", {"context__exact": "staff"}),
                entry("Roles & Permissions", "groups", "auth.group"),
            ],
        ),
        (
            "communication",
            "Communication",
            [
                entry("Content & order reports", "flag", "messaging.report"),
                entry("Communication delivery", "mail", "notifications.outbox"),
            ],
        ),
        ("website", "Website & content", website_taxonomy_links(entry)),
        (
            "system",
            "System Records",
            [
                entry("Audit activity", "history", "accounts.auditevent"),
                entry("Mail delivery", "mail", "accounts.accountmail"),
                entry("Invitation delivery", "mail", "organizations.invitationmail"),
                entry("Translation jobs", "translate", "catalogue.translationjob"),
                entry("Browser access", "security", "accounts.browserauthority"),
                entry("Authenticators", "shield", "accounts.authenticator"),
            ],
        ),
    ]
