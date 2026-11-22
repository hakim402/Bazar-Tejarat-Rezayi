"""Curated destinations derived from the freshly authorized native model directory."""

from urllib.parse import parse_qs, urlencode, urlsplit
from django.urls import reverse
from django.utils.translation import get_language, gettext_lazy as _


OWNER_NAVIGATION_DARI = {
    "Daily work": "کارهای روزانه",
    "Manage": "مدیریت",
    "Catalogue & stock": "کاتالوگ و موجودی",
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
    "Website & content": "وب‌سایت و محتوا",
    "Content pages": "صفحه‌های محتوا",
    "Homepage content": "محتوای صفحهٔ اصلی",
    "Site settings": "تنظیمات سایت",
    "Payments & refunds": "پرداخت‌ها و بازپرداخت‌ها",
    "Open payment reviews": "بررسی‌های پرداخت باز",
    "Refunds needing attention": "بازپرداخت‌های نیازمند رسیدگی",
    "Confirmed receipts": "رسیدهای تأییدشده",
}


def navigation_title(title):
    if get_language() == "fa-af" and title in OWNER_NAVIGATION_DARI:
        return OWNER_NAVIGATION_DARI[title]
    return _(title)


def navigation(request):
    from .site import owner_site
    from .access import is_owner

    root = is_owner(request)
    available = {
        model["model"]._meta.label_lower: model for app in owner_site.get_app_list(request) for model in app["models"]
    }

    def entry(title, icon, model, filters=None):
        record = available.get(model)
        if not record or not record.get("admin_url"):
            return None
        return {
            "title": navigation_title(title),
            "icon": icon,
            "link": record["admin_url"] + ("?" + urlencode(filters) if filters else ""),
        }

    overview = {"title": _("Overview"), "icon": "space_dashboard", "link": reverse("admin:index")}
    if root:
        groups = owner_groups(entry, overview)
    else:
        groups = staff_groups(entry, overview)

    section_of = {
        "commerce": "Operations", "payments": "Operations", "fulfilment": "Operations", "aftercare": "Operations",
        "catalogue": "Catalogue & Inventory", "stores": "Catalogue & Inventory", "inventory": "Catalogue & Inventory",
        "business": "Marketplace & People", "access": "Marketplace & People",
        "communication": "System & Settings", "system": "System & Settings",
    }
    if root:
        section_of = {
            "overview": "Daily work", "orders": "Daily work", "reviews": "Daily work",
            "payments": "Daily work", "delivery": "Daily work", "catalogue": "Manage",
            "people": "Manage", "website": "Manage", "reports": "Manage",
        }
    index_url = overview["link"]
    preserved_filters = parse_qs(request.GET.get("_changelist_filters", ""))
    icons = {
        "orders": "receipt_long", "people": "groups", "delivery": "local_shipping", "website": "language",
        "commerce": "receipt_long", "payments": "payments", "fulfilment": "local_shipping",
        "aftercare": "assignment_return", "catalogue": "inventory_2", "stores": "storefront",
        "inventory": "inventory", "business": "business", "access": "manage_accounts",
        "communication": "forum", "system": "settings_suggest", "settings": "settings",
    }
    result = []
    for key, title, items in groups:
        children = [item for item in items if item]
        if not children:
            continue
        for item in children:
            target = urlsplit(item["link"])
            expected = parse_qs(target.query)
            path_matches = request.path == target.path or (
                target.path != index_url and request.path.startswith(target.path.rstrip("/") + "/")
            )
            item["active"] = bool(path_matches and all(
                (request.GET.getlist(param) if param in request.GET else preserved_filters.get(param, [])) == value
                for param, value in expected.items()
            ))
        # The settings directory lists every section; General yields to any of them.
        if key == "settings" and request.GET.get("section"):
            for item in children:
                if item.get("key") == "general":
                    item["active"] = False
        # The compact website group keeps Homepage content active across its libraries.
        if root and key == "website":
            homepage_active = request.GET.get("section") in {"hero", "promotions"} or request.path.startswith(
                reverse("admin:site_heroslide_changelist")
            )
            for item in children:
                if item.get("site_destination") == "homepage":
                    item["active"] = homepage_active
                elif item.get("site_destination") == "settings" and homepage_active:
                    item["active"] = False
        dispatch_filter = request.GET.getlist("dispatch") or preserved_filters.get("dispatch", [])
        if root and key == "orders" and dispatch_filter == ["not_dispatched"]:
            children[0]["active"] = False
        if key in icons:
            children = [{
                "title": navigation_title(title), "icon": icons[key], "link": children[0]["link"],
                "active": any(item["active"] for item in children), "items": children,
            }]
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


def owner_groups(entry, overview):
    from apps.fulfilment.queries import OPEN_HOLDS_FILTER, UNDISPATCHED_FILTER
    from apps.site.admin.navigation import destination_groups, settings_url
    from .review_queues import review_labels

    # One shared destination set feeds both the compact sidebar and the directory.
    site_items = [item for group in destination_groups() for item in group["items"]]
    hero = next(item for item in site_items if item["key"] == "hero")
    pages = entry("Content pages", "description", "site.contentpage")
    return [
        ("overview", "Overview", [overview]),
        ("reviews", "Review queues", [
            {"title": review_labels()["title"], "icon": "fact_check", "link": reverse("admin:review_queues")},
        ]),
        ("orders", "Orders", [
            entry("Accepted orders", "receipt_long", "orders.sellerorder"),
            entry("Formal requests", "request_quote", "orders.negotiation"),
            entry("Goods invoices", "description", "orders.invoice"),
        ]),
        ("payments", "Payments & refunds", [
            entry("Open payment reviews", "fact_check", "payments.reviewcase", {"state": "open"}),
            entry("Refunds needing attention", "currency_exchange", "payments.refunddue", {"refund_review": "pending"}),
            entry("Confirmed receipts", "payments", "payments.receipt"),
        ]),
        ("delivery", "Delivery operations", [
            entry("Open delivery reviews", "fact_check", "fulfilment.reviewcase", {"state__exact": "open"}),
            entry("Not dispatched", "local_shipping", "orders.sellerorder", UNDISPATCHED_FILTER),
            entry("Open holds", "pause_circle", "fulfilment.blocker", OPEN_HOLDS_FILTER),
            entry("Shipments", "inventory_2", "fulfilment.shipment"),
            entry("All delivery records", "inventory_2", "fulfilment.state"),
        ]),
        ("catalogue", "Catalogue & stock", [
            entry("Products", "inventory_2", "catalogue.product"),
            entry("Product source review", "fact_check", "catalogue.sourcerevision", {"state__exact": "submitted"}),
            entry("Variants", "sell", "catalogue.variant"),
            entry("Stock positions", "inventory", "inventory.position"),
            entry("Categories", "category", "catalogue.category"),
            entry("Sale units", "straighten", "catalogue.saleunit"),
        ]),
        ("people", "People & stores", [
            entry("Users", "group", "accounts.user"),
            entry("Buyer accounts", "person", "accounts.account", {"context__exact": "buyer"}),
            entry("Seller accounts", "storefront", "accounts.account", {"context__exact": "seller"}),
            entry("Business profiles", "business", "organizations.businessprofile"),
            entry("Verification cases", "verified_user", "verification.reviewcase"),
            entry("Public stores", "store", "marketplace.store"),
            entry("Store reviews", "fact_check", "marketplace.storerevision", {"state__exact": "submitted"}),
        ]),
        ("website", "Website & content", [
            pages,
            {"title": navigation_title("Homepage content"), "icon": "image",
             "link": hero["link"], "site_destination": "homepage"},
            {"title": navigation_title("Site settings"), "icon": "tune",
             "link": settings_url(), "site_destination": "settings"},
        ]),
        ("reports", "Commerce reports", [
            {"title": _("Commerce reports"), "icon": "monitoring", "link": reverse("admin:reports_commerce")},
        ]),
        ("settings", "Site Settings", site_items),
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
                entry("Categories", "category", "catalogue.category"),
                entry("Sale units", "straighten", "catalogue.saleunit"),
                entry("Product media", "image", "catalogue.productimage"),
            ],
        ),
        (
            "stores",
            "Marketplace & Stores",
            [
                entry("Public stores", "store", "marketplace.store"),
                entry("Store reviews", "fact_check", "marketplace.storerevision"),
                entry("Featured Rezayi store", "star", "marketplace.featuredstore"),
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
