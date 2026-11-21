"""Organize the pages already authorized by Django and the Unfold sidebar."""

from urllib.parse import urlsplit

from django.utils.translation import get_language


WORKFLOWS = (
    ("Orders & aftercare", "سفارش‌ها و پیگیری", "receipt_long", (
        "orders.sellerorder", "orders.negotiation", "orders.invoice",
        "orders.cancellationrequest", "orders.amendment", "orders.invoiceadjustment",
        "orders.disputerequest", "orders.review", "orders.orderpolicy",
    )),
    ("Payments & refunds", "پرداخت‌ها و بازپرداخت‌ها", "payments", (
        "payments.reviewcase", "payments.claim", "payments.receipt",
        "payments.refunddue", "payments.refundreport", "payments.correction", "payments.finance",
    )),
    ("Delivery & fulfilment", "ارسال و تحویل", "local_shipping", (
        "fulfilment.state", "fulfilment.reviewcase", "fulfilment.shipment", "fulfilment.preparation",
        "fulfilment.provider", "fulfilment.chargeproposal", "fulfilment.receipt",
        "fulfilment.deliveryrefund", "fulfilment.blocker", "fulfilment.completion",
    )),
    ("Catalogue & stock", "کاتالوگ و موجودی", "inventory_2", (
        "catalogue.product", "catalogue.sourcerevision", "inventory.position",
        "inventory.shortage", "catalogue.category", "catalogue.saleunit",
        "catalogue.variant", "catalogue.translation", "inventory.batch", "inventory.movement",
    )),
    ("People & stores", "کاربران و فروشگاه‌ها", "storefront", (
        "accounts.user", "accounts.account", "marketplace.store", "marketplace.storerevision",
        "marketplace.featuredstore", "organizations.businessprofile", "verification.reviewcase",
        "organizations.membership",
    )),
)

COMMUNICATION = ("Messages & reports", "پیام‌ها و گزارش‌ها", "forum", (
    "messaging.report", "messaging.conversation", "notifications.outbox",
))
SYSTEM = ("System & audit", "سیستم و بررسی فعالیت‌ها", "admin_panel_settings", (
    "accounts.auditevent", "admin.logentry", "accounts.accountmail", "auth.group",
))

DIRECTORY_COPY = {
    "search": ("Find a page", "جستجوی صفحه"),
    "clear": ("Clear search", "پاک کردن جستجو"),
    "empty": ("No matching pages", "صفحه‌ای پیدا نشد"),
    "empty_hint": ("Try a different page or application name.", "نام صفحه یا برنامهٔ دیگری را جستجو کنید."),
    "result_count": ("Matching pages", "صفحه‌های پیدا شده"),
}

DELIVERY_SECTIONS = (
    ("Needs attention", "نیازمند رسیدگی", ("reviewcase", "blocker")),
    ("Dispatch and delivery", "ارسال و تحویل", ("state", "preparation", "preparationline", "recipient", "arrangement", "provider", "partialpermission", "shipment", "tracking", "delivery", "dispatchattempt")),
    ("Delivery payments", "پرداخت های تحویل", ("chargeproposal", "chargedecision", "claim", "claimdecision", "receipt", "correction", "deliveryrefund", "deliveryrefunddecision")),
    ("History and technical records", "تاریخچه و سوابق تخنیکی", ("completion", "blockerclosure", "event", "caseevent", "evidence", "evidencebinding", "publication", "command", "noticecursor")),
)


def application_directory(request, available_apps, sidebar_navigation):
    language = int(get_language() == "fa-af")
    pages = {}
    groups = []

    for app in available_apps:
        for model in app["models"]:
            if url := model.get("admin_url"):
                page = {
                    "title": model["name"],
                    "url": url,
                    "active": request.path.startswith(url),
                    "search": f'{model["name"]} {app["name"]} {app["app_label"]}',
                    "application": app["name"],
                    "app_label": app["app_label"],
                }
                pages[model["model"]._meta.label_lower] = page

    # Reuse unfiltered sidebar labels where available, such as “Accepted orders”.
    # Filtered shortcuts still lead to the full changelist from this directory.
    sidebar_links = {}
    settings_links = []
    for group in sidebar_navigation:
        for item in group["items"]:
            if not item["has_permission"]:
                continue
            for link in item.get("items") or (item,):
                if not link["has_permission"] or not link.get("link"):
                    continue
                if group.get("directory_only"):
                    settings_links.append(link)
                else:
                    target = urlsplit(str(link["link"]))
                    if not target.query:
                        sidebar_links[target.path] = link["title"]

    def add_group(titles, icon, rows=(), sections=()):
        if not rows and not sections:
            return
        groups.append({
            "title": titles[language], "icon": icon, "rows": rows, "sections": sections,
            "count": len(rows) + sum(len(section["rows"]) for section in sections),
        })

    def add_workflow(en, fa, icon, labels):
        add_group((en, fa), icon, [pages.pop(label) for label in labels if label in pages])

    for page in pages.values():
        if title := sidebar_links.get(page["url"]):
            page["title"] = title
            page["search"] = f'{title} {page["search"]}'

    for workflow in (*WORKFLOWS, COMMUNICATION):
        if workflow[0] == "Delivery & fulfilment":
            sections = []
            for en, fa, models in DELIVERY_SECTIONS:
                rows = [pages.pop("fulfilment." + name) for name in models if "fulfilment." + name in pages]
                if rows:
                    sections.append({"title": (en, fa)[language], "rows": rows})
            add_group((workflow[0], workflow[1]), workflow[2], sections=sections)
        else:
            add_workflow(*workflow)

    settings_pages = []
    content_page = pages.get("site.contentpage")
    settings_model = pages.get("site.sitesettings")
    for link in settings_links:
        url = str(link["link"])
        target = urlsplit(url)
        if content_page and url == content_page["url"]:
            native_page = pages.pop("site.contentpage")
        elif settings_model and target.path.startswith(settings_model["url"]):
            native_page = settings_model
            if not target.query:
                # The native General entry handles an uninitialized singleton.
                url = pages.pop("site.sitesettings")["url"]
        else:
            continue
        settings_pages.append({
            "title": link["title"], "url": url,
            "search": f'{link["title"]} {native_page["search"]}', "active": link["active"],
        })
    for model_label in ("site.sitesettings", "site.contentpage", "site.heroslide"):
        if model_label in pages:
            settings_pages.append(pages.pop(model_label))
    add_group(("Site Settings", "تنظیمات وب‌سایت"), "settings", settings_pages)

    add_workflow(*SYSTEM)

    technical_apps = {}
    for page in pages.values():
        section = technical_apps.setdefault(page["app_label"], {"title": page["application"], "rows": []})
        section["rows"].append(page)
    add_group(("Technical records", "سوابق فنی"), "storage", sections=list(technical_apps.values()))

    return {"groups": groups, "copy": {key: value[language] for key, value in DIRECTORY_COPY.items()}}
