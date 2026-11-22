"""Organize the pages already authorized by Django and the Unfold sidebar."""

from urllib.parse import urlsplit

from django.urls import reverse
from django.utils.translation import get_language

from .navigation import active_destination, destination_key

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
    ("Delivery & fulfilment", "ارسال و تحویل", "local_shipping", ()),
    ("Catalogue & stock", "کاتالوگ و موجودی", "inventory_2", (
        "catalogue.product", "catalogue.sourcerevision", "inventory.position",
        "inventory.shortage",
        "catalogue.variant", "catalogue.translation", "inventory.batch", "inventory.movement",
    )),
    ("People & stores", "کاربران و فروشگاه‌ها", "storefront", (
        "accounts.user", "accounts.account", "organizations.businessprofile",
        "verification.reviewcase", "verification.evidence",
        "marketplace.store", "marketplace.storerevision", "marketplace.storemedia",
        "marketplace.storeevent",
        "organizations.membership", "organizations.ownershiptransfer",
        "organizations.invitation", "organizations.invitationmail",
    )),
)

REPORTS = ("Reports and moderation", "گزارش‌ها و نظارت", "flag", (
    "messaging.report",
))
DELIVERY = ("Notifications", "اعلان ها", "mail", (
    "notifications.outbox", "notifications.attempt",
    "notifications.aftercareemail", "notifications.aftercareemailattempt",
))
MESSAGING_AUDIT = ("Messaging audit", "حسابرسی پیام‌ها", "forum", (
    "messaging.conversation", "messaging.message", "messaging.attachment",
    "messaging.readstate", "messaging.caseevent", "messaging.caseaccess",
    "messaging.command",
))
SYSTEM = ("System, audit & access", "سیستم، حسابرسی و دسترسی", "admin_panel_settings", (
    "accounts.auditevent", "admin.logentry", "accounts.accountmail", "accounts.mailattempt",
    "auth.group", "auth.permission",
))
RUNTIME = ("System health", "وضعیت سیستم", "monitoring", (
    "runtime.job", "runtime.scheduler", "runtime.schema", "runtime.transfer",
))

# Keep supporting records with their workflow, so they remain findable when the
# operator browses instead of being mixed into the global technical section.
SUPPORTING_SECTIONS = {
    "Orders & aftercare": (
        ("Order and request history", "تاریخچه سفارش ها و درخواست ها", ("orders", "cart")),
    ),
    "Payments & refunds": (
        ("Stock reservations", "ذخیره موجودی", ("payments.stockplan", "payments.stockplanline", "payments.stockplanseal",
            "payments.allocationintent", "payments.allocationattempt")),
        ("Decisions, evidence and history", "تصمیم ها، مدارک و تاریخچه", ("payments.claimdecision", "payments.refunddecision",
            "payments.receiptseal", "payments.refundseal", "payments.extension", "payments.caseevent", "payments.evidence",
            "payments.evidencebinding", "payments.event")),
        ("Payment email delivery", "ارسال ایمیل پرداخت", ("payments.email", "payments.emailattempt")),
    ),
    "Catalogue & stock": (
        ("Catalogue history and media", "تاریخچه و رسانه های کاتالوگ", ("catalogue",)),
        ("Stock operations and history", "عملیات و تاریخچه موجودی", ("inventory",)),
    ),
    "People & stores": (
        ("Account details", "جزئیات حساب", ("accounts.address",)),
    ),
}

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
                    "search": f'{model["name"]} {model["object_name"]} {app["name"]} {app["app_label"]}',
                    "application": app["name"],
                    "app_label": app["app_label"],
                }
                pages[model["model"]._meta.label_lower] = page

    # Reuse unfiltered sidebar labels where available, such as “Accepted orders”.
    # Filtered shortcuts still lead to the full changelist from this directory.
    sidebar_links = {}
    shortcuts = {}
    tools = []
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
                    shortcuts.setdefault(target.path, []).append(str(link["title"]))
                    if not target.query:
                        sidebar_links[target.path] = link["title"]
                    if group.get("key") in {"reviews", "reports"}:
                        tools.append({"title": link["title"], "url": link["link"], "search": str(link["title"])})

    seen = set()

    def unique(rows, search_title):
        result = []
        for row in rows:
            key = destination_key(row["url"])
            if key not in seen:
                seen.add(key)
                result.append({**row, "search": f'{row["search"]} {search_title}'})
        return result

    def add_group(titles, icon, rows=(), sections=()):
        search_title = " ".join(titles)
        rows = unique(rows, search_title)
        visible_sections = []
        for section in sections:
            entries = unique(section["rows"], f'{search_title} {section["title"]}')
            if entries:
                visible_sections.append({**section, "rows": entries})
        if not rows and not visible_sections:
            return
        groups.append({
            "title": titles[language], "icon": icon, "rows": rows, "sections": visible_sections,
            "count": len(rows) + sum(len(section["rows"]) for section in visible_sections),
        })

    def add_workflow(en, fa, icon, labels):
        rows = [pages.pop(label) for label in labels if label in pages]
        sections = []
        for title_en, title_fa, matches in SUPPORTING_SECTIONS.get(en, ()):
            related = [pages.pop(label) for label in tuple(pages) if label in matches or label.split(".")[0] in matches]
            sections.append({"title": (title_en, title_fa)[language], "rows": related})
        add_group((en, fa), icon, rows, sections)

    for page in pages.values():
        if title := sidebar_links.get(page["url"]):
            page["title"] = title
        if aliases := shortcuts.get(page["url"]):
            page["search"] = f'{page["search"]} {" ".join(aliases)}'

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
                # Use the native entry, which handles an uninitialized singleton.
                url = settings_model["url"]
                pages.pop("site.sitesettings", None)
        else:
            continue
        settings_pages.append({
            "title": link["title"], "url": url,
            "search": f'{link["title"]} {native_page["search"]} {link.get("search_aliases", "")}',
        })
    for model_label in (
        "site.sitesettings", "site.contentpage", "site.heroslide", "marketplace.featuredstore",
        "catalogue.category", "catalogue.saleunit",
    ):
        if model_label in pages:
            settings_pages.append(pages.pop(model_label))

    add_group(("Review queues and reports", "صف های بررسی و گزارش ها"), "monitoring", tools)
    for workflow in (*WORKFLOWS, REPORTS, DELIVERY, MESSAGING_AUDIT):
        if workflow[0] == "Delivery & fulfilment":
            sections = []
            for en, fa, models in DELIVERY_SECTIONS:
                rows = [pages.pop("fulfilment." + name) for name in models if "fulfilment." + name in pages]
                if rows:
                    sections.append({"title": (en, fa)[language], "rows": rows})
            add_group((workflow[0], workflow[1]), workflow[2], sections=sections)
        else:
            add_workflow(*workflow)
    add_group(("Website & content", "وب سایت و محتوا"), "language", settings_pages)

    add_workflow(*SYSTEM)
    add_workflow(*RUNTIME)

    technical_apps = {}
    for page in pages.values():
        section = technical_apps.setdefault(page["app_label"], {"title": page["application"], "rows": []})
        section["rows"].append(page)
    add_group(("Technical records", "سوابق فنی"), "storage", sections=list(technical_apps.values()))

    rows = [row for group in groups for section in (group, *group["sections"]) for row in section["rows"]]
    active = active_destination(request, (row["url"] for row in rows), reverse("admin:index"))
    for group in groups:
        for section in (group, *group["sections"]):
            for row in section["rows"]:
                row["active"] = destination_key(row["url"]) == active
            section["active"] = any(row["active"] for row in section["rows"])
        group["active"] |= any(section["active"] for section in group["sections"])

    return {"groups": groups, "copy": {key: value[language] for key, value in DIRECTORY_COPY.items()}}
