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
from apps.accounts.admin.access import is_owner
from apps.accounts.admin.display import money, quantity
from apps.organizations.admin import ReadOnlyAdmin
from ..models import (
    SourceRevision, Variant, PriceChange, Translation, TranslationJob,
    CatalogueEvent, TranslationBudget,
)
from .helpers import CatalogueRecordAdmin, link_button
from .presentation import ProductIdentityMixin, product_cell
from .summaries import revision_summary, localized, readable


class RevisionAdmin(ProductIdentityMixin, CatalogueRecordAdmin):
    list_display = ["source_title", "seller_identity", "number", "state", "category_name", "created_at", "workflow_link"]
    list_select_related = ["category", "product__seller"]
    list_filter = ["state"]
    ordering = ["-created_at"]
    search_fields = ["body__title", "product__seller__display_name", "product__seller__account__user__email", "product__variants__sku"]
    badge_fields = ["state"]

    @admin.display(description=_("Source title"))
    def source_title(self, obj):
        obj.admin_title = obj.body.get("title") or _("Untitled product")
        return product_cell(obj, _("Revision %(number)s") % {"number": obj.number})

    @admin.display(description=_("Category"))
    def category_name(self, obj):
        return localized(obj.category.labels, obj.category_id)

    @admin.display(description=_("Seller submission"))
    def submission(self, obj):
        return revision_summary(obj)

    def get_readonly_fields(self, request, obj=None):
        return [*super().get_readonly_fields(request, obj), "source_title", "seller_identity", "category_name", "submission", "workflow_link"]

    def get_fieldsets(self, request, obj=None):
        return [
            (_("Identity"), {"fields": ["source_title", "seller_identity", "id", "number", "state", "author", "created_at"]}),
            (_("Seller submission"), {"fields": ["submission"]}),
            (_("Review"), {"fields": ["reason", "workflow_link"]}),
        ]

    def workflow_link(self, obj):
        url = reverse("admin:catalogue_workflow", args=[obj.product_id])
        return link_button(f"{url}?{urlencode({'revision': obj.pk})}", _("Review"), icon="fact_check")


class VariantAdmin(ProductIdentityMixin, CatalogueRecordAdmin):
    list_display = ["product_identity", "sku", "seller_identity", "sale_unit", "retail_price", "wholesale_price", "quantity_step", "wholesale_minimum"]
    list_select_related = ["product", "unit"]
    list_filter = ["unit"]
    search_fields = ["sku", "product__seller__display_name", "product__seller__account__user__email", "product__revisions__body__title"]
    quantity_fields = ["minimum_wholesale"]

    def get_readonly_fields(self, request, obj=None):
        fields = super().get_readonly_fields(request, obj)
        return [*fields, "related_records", "product_identity", "seller_identity", "sale_unit", "retail_price", "wholesale_price", "quantity_step", "wholesale_minimum", "pack_contents", "options"]

    def get_fieldsets(self, request, obj=None):
        return [
            (_("Identity"), {"fields": ["product_identity", "sku", "seller_identity", "id", "related_records"]}),
            (_("Sale configuration"), {"fields": ["sale_unit", "quantity_step", "wholesale_minimum", "pack_contents", "options"]}),
            (_("Seller prices"), {"fields": ["retail_price", "wholesale_price"]}),
        ]

    @admin.display(description=_("Sale unit"), ordering="unit")
    def sale_unit(self, obj):
        return localized(obj.unit.labels, obj.unit_id)

    @admin.display(description=_("Quantity step"), ordering="quantity_increment")
    def quantity_step(self, obj):
        return quantity(obj.quantity_increment)

    @admin.display(description=_("Wholesale minimum"), ordering="minimum_wholesale")
    def wholesale_minimum(self, obj):
        return quantity(obj.minimum_wholesale)

    @admin.display(description=_("Variant options"))
    def options(self, obj):
        return readable(obj.definition.get("attributes", {})) or "—"

    @admin.display(description=_("Pack contents"))
    def pack_contents(self, obj):
        return obj.definition.get("contents") or "—"

    @admin.display(description=_("Related records"))
    def related_records(self, obj):
        from django.utils.html import format_html

        product = reverse("admin:catalogue_product_change", args=[obj.product_id])
        stock = reverse("admin:inventory_position_change", args=[obj.pk]) if hasattr(obj, "stock_position") else None
        return format_html(
            '<div class="flex flex-wrap gap-2">{}{}</div>',
            link_button(product, _("View product"), "inventory_2"),
            link_button(stock, _("View stock position"), "inventory") if stock else "",
        )

    @admin.display(description=_("Retail"))
    def retail_price(self, obj):
        return money(obj.retail, obj.product.currency)

    @admin.display(description=_("Wholesale"))
    def wholesale_price(self, obj):
        return money(obj.wholesale, obj.product.currency)


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

    def get_list_display(self, request):
        columns = super().get_list_display(request)
        return [column for column in columns if column != "workflow_link"] if is_owner(request) else columns

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
