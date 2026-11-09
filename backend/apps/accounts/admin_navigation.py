"""Curated destinations derived from the freshly authorized native model directory."""

from urllib.parse import parse_qs, urlencode, urlsplit
from django.urls import reverse
from django.utils.translation import gettext_lazy as _


def navigation(request):
    from .admin import owner_site
    from .admin_access import is_owner
    from apps.site.sections import SECTIONS

    root = is_owner(request)
    available = {
        model["model"]._meta.label_lower: model for app in owner_site.get_app_list(request) for model in app["models"]
    }

    def entry(title, icon, model, filters=None, badge=None, badge_variant="warning"):
        record = available.get(model)
        if not record or not record.get("admin_url"):
            return None
        item = {
            "title": _(title),
            "icon": icon,
            "link": record["admin_url"] + ("?" + urlencode(filters) if filters else ""),
        }
        if badge:
            item["badge"] = badge
            item["badge_variant"] = badge_variant
        return item

    # Queue badges are owner-only aggregates; staff navigation stays scoped and
    # count-free so assignment-limited users never see global queue volumes.
    badges = {}
    if root:
        from apps.catalogue.models import SourceRevision
        from apps.fulfilment.models import ReviewCase as DeliveryReviewCase
        from apps.orders.models import Amendment, CancellationRequest, DisputeRequest, Review
        from apps.payments.models import ReviewCase as PaymentReviewCase
        from apps.verification.models import ReviewCase as VerificationCase

        badges = {
            "orders.cancellationrequest": CancellationRequest.objects.filter(state="pending").count(),
            "orders.amendment": Amendment.objects.filter(state="pending").count(),
            "orders.disputerequest": DisputeRequest.objects.filter(state="pending").count(),
            "orders.review": Review.objects.filter(state="pending").count(),
            "payments.reviewcase": PaymentReviewCase.objects.filter(state="open").count(),
            "fulfilment.reviewcase": DeliveryReviewCase.objects.filter(state="open").count(),
            "catalogue.sourcerevision": SourceRevision.objects.filter(state="submitted").count(),
            "verification.reviewcase": VerificationCase.objects.filter(status__in=["submitted", "under_review"]).count(),
        }

    def queue(model):
        return badges.get(model) or None

    groups = [
        ("overview", "Overview", [{"title": _("Overview"), "icon": "space_dashboard", "link": reverse("admin:index")}]),
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
                entry("Goods payment review", "fact_check", "payments.reviewcase", badge=queue("payments.reviewcase")),
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
                entry("Delivery review", "fact_check", "fulfilment.reviewcase", badge=queue("fulfilment.reviewcase")),
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
                entry("Cancellation requests", "cancel", "orders.cancellationrequest", badge=queue("orders.cancellationrequest")),
                entry("Accepted amendments", "edit_note", "orders.amendment", badge=queue("orders.amendment")),
                entry("Invoice adjustments", "receipt", "orders.invoiceadjustment"),
                entry("Order disputes", "gavel", "orders.disputerequest", badge=queue("orders.disputerequest")),
                entry("Buyer reviews", "rate_review", "orders.review", badge=queue("orders.review")),
            ],
        ),
        (
            "catalogue",
            "Catalogue",
            [
                entry("Products", "inventory_2", "catalogue.product"),
                entry("Product source review", "fact_check", "catalogue.sourcerevision", {"state__exact": "submitted"}, badge=queue("catalogue.sourcerevision")),
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
                entry("Verification cases", "verified_user", "verification.reviewcase", badge=queue("verification.reviewcase")),
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
    if root:
        groups.append(
            (
                "settings",
                "Site Settings",
                [
                    {
                        "title": section.title,
                        "icon": section.icon,
                        "link": reverse("admin:site_settings_section", kwargs={"section": section.key}),
                    }
                    for section in SECTIONS
                ],
            )
        )
    section_of = {
        "commerce": "operations", "payments": "operations", "fulfilment": "operations", "aftercare": "operations",
        "catalogue": "catalogue", "stores": "catalogue", "inventory": "catalogue",
        "business": "marketplace", "access": "marketplace",
        "communication": "system", "system": "system", "settings": "system",
    }
    section_titles = {
        "operations": _("Operations"),
        "catalogue": _("Catalogue & Inventory"),
        "marketplace": _("Marketplace & People"),
        "system": _("System & Settings"),
    }
    result = [
        {"key": key, "title": _(title), "section": section_titles.get(section_of.get(key)),
         "collapsible": key != "overview", "items": [item for item in items if item]}
        for key, title, items in groups
    ]
    result = [group for group in result if group["items"]]
    index_url = reverse("admin:index")
    preserved_filters = parse_qs(request.GET.get("_changelist_filters", ""))
    icons = {
        "commerce": "receipt_long", "payments": "payments", "fulfilment": "local_shipping",
        "aftercare": "assignment_return", "catalogue": "inventory_2", "stores": "storefront",
        "inventory": "inventory", "business": "business", "access": "manage_accounts",
        "communication": "forum", "system": "settings_suggest", "settings": "settings",
    }
    for group in result:
        for item in group["items"]:
            target = urlsplit(item["link"])
            expected = parse_qs(target.query)
            path_matches = request.path == target.path or (
                target.path != index_url and request.path.startswith(target.path.rstrip("/") + "/")
            )
            item["active"] = bool(path_matches and all(
                (request.GET.getlist(key) if key in request.GET else preserved_filters.get(key, [])) == value
                for key, value in expected.items()
            ))
        if group["key"] != "overview":
            children = group["items"]
            group["items"] = [{
                "title": group["title"], "icon": icons[group["key"]], "link": children[0]["link"],
                "active": any(item["active"] for item in children), "items": children,
            }]
        group["title"] = None
        group["collapsible"] = False
    return result
