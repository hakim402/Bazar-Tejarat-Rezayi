"""Read-only inspection tables for retained catalogue history.

Every list is scoped so staff never see their own/linked products, and status
columns render as Unfold badges. Supported changes happen only through the linked
guarded product workspace — generic editing would bypass the safeguards.
"""

from django.contrib import admin
from django.urls import reverse
from django.utils.translation import gettext_lazy as _
from urllib.parse import urlencode

from apps.accounts.admin import owner_site
from apps.accounts.admin.display import money
from apps.organizations.admin import ReadOnlyAdmin
from ..models import (
    SourceRevision, Variant, PriceChange, Translation, TranslationJob,
    CatalogueEvent, TranslationBudget,
)
from .helpers import CatalogueRecordAdmin, link_button


class RevisionAdmin(CatalogueRecordAdmin):
    list_display = ["product", "number", "state", "category", "created_at", "workflow_link"]
    list_filter = ["state"]
    ordering = ["-created_at"]
    search_fields = ["product__seller__display_name", "product__variants__sku"]
    badge_fields = ["state"]

    def workflow_link(self, obj):
        return link_button(reverse("admin:catalogue_workflow", args=[obj.product_id]), _("Review"), icon="fact_check")


class VariantAdmin(CatalogueRecordAdmin):
    list_display = ["sku", "product", "unit", "retail_price", "wholesale_price", "minimum_wholesale"]
    list_filter = ["unit"]
    search_fields = ["sku", "product__seller__display_name"]
    quantity_fields = ["minimum_wholesale"]

    @admin.display(description=_("Retail"))
    def retail_price(self, obj):
        return money(obj.retail)

    @admin.display(description=_("Wholesale"))
    def wholesale_price(self, obj):
        return money(obj.wholesale)


class PriceChangeAdmin(CatalogueRecordAdmin):
    list_display = ["product", "variant", "retail_price", "wholesale_price", "product_version", "created_at"]
    ordering = ["-created_at"]
    search_fields = ["variant__sku", "product__seller__display_name"]

    @admin.display(description=_("Retail"))
    def retail_price(self, obj):
        return money(obj.retail)

    @admin.display(description=_("Wholesale"))
    def wholesale_price(self, obj):
        return money(obj.wholesale)


class TranslationAdmin(CatalogueRecordAdmin):
    list_display = ["revision", "locale", "state", "version", "title", "workflow_link"]
    list_filter = ["state", "locale"]
    search_fields = ["title", "revision__product__seller__display_name"]
    badge_fields = ["state"]

    @admin.display(description=_("Title"))
    def title(self, obj):
        return obj.title or "—"

    def workflow_link(self, obj):
        url = reverse("admin:catalogue_workflow", args=[obj.revision.product_id])
        query = urlencode({"translation": "1", "revision": str(obj.revision_id), "target": obj.locale})
        return link_button(f"{url}?{query}", _("Open"), icon="translate")


class TranslationJobAdmin(CatalogueRecordAdmin):
    list_display = ["translation", "status", "attempts", "next_attempt_at", "error_code"]
    list_filter = ["status"]
    ordering = ["-next_attempt_at"]
    badge_fields = ["status"]


class CatalogueEventAdmin(CatalogueRecordAdmin):
    list_display = ["created_at", "product", "action", "context", "reason"]
    list_filter = ["action", "context"]
    ordering = ["-created_at"]
    search_fields = ["reason"]
    badge_fields = ["action"]

    @admin.display(description=_("Reason"))
    def reason(self, obj):
        return obj.reason or "—"


class BudgetAdmin(ReadOnlyAdmin):
    list_display = ["day", "calls", "characters"]
    ordering = ["-day"]


owner_site.register(SourceRevision, RevisionAdmin)
owner_site.register(Variant, VariantAdmin)
owner_site.register(PriceChange, PriceChangeAdmin)
owner_site.register(Translation, TranslationAdmin)
owner_site.register(TranslationJob, TranslationJobAdmin)
owner_site.register(CatalogueEvent, CatalogueEventAdmin)
owner_site.register(TranslationBudget, BudgetAdmin)