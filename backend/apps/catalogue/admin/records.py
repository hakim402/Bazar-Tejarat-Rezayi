"""Read-only inspection tables for retained catalogue history.

Every list is scoped so staff never see their own/linked products, and status
columns render as Unfold badges. Supported changes happen only through the linked
guarded product workspace — generic editing would bypass the safeguards.
"""

from django.contrib import admin
from django.contrib.admin import SimpleListFilter
from django.urls import reverse
from django.utils.translation import gettext_lazy as _
from urllib.parse import urlencode

from apps.accounts.admin import owner_site
from apps.accounts.admin.access import is_owner
from apps.accounts.admin.display import money, quantity, record_identity, state_badge
from apps.accounts.admin.presentation import action_label, context_status, label
from apps.organizations.admin import ReadOnlyAdmin
from ..models import (
    SourceRevision, Variant, PriceChange, Translation, TranslationJob,
    CatalogueEvent, TranslationBudget, LOCALES,
)
from .helpers import CatalogueRecordAdmin, link_button
from .presentation import ProductIdentityMixin, product_cell, compact_text
from .summaries import revision_summary, localized, readable, language_name
from .helpers import panel_table, panel_note


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


class PriceChangeAdmin(ProductIdentityMixin, CatalogueRecordAdmin):
    product_path = "product"
    list_display = ["product_identity", "seller_identity", "variant_sku", "retail_price",
                    "wholesale_price", "product_version", "created_at"]
    list_select_related = ["product__seller__account__user", "variant"]
    ordering = ["-created_at"]
    search_fields = ["variant__sku", "product__seller__display_name",
                     "product__seller__account__user__email", "product__revisions__body__title"]
    search_help_text = _("Find by product name, SKU, seller or email")

    def get_readonly_fields(self, request, obj=None):
        return [*super().get_readonly_fields(request, obj), "product_identity", "seller_identity",
                "variant_sku", "retail_price", "wholesale_price"]

    def get_fieldsets(self, request, obj=None):
        return [
            (_("Identity"), {"fields": ["product_identity", "seller_identity", "variant_sku", "created_at"]}),
            (_("Recorded prices"), {"fields": ["retail_price", "wholesale_price", "product_version"]}),
        ]

    @admin.display(description=_("Product"))
    def product_identity(self, obj):
        return product_cell(obj, obj.variant.sku)

    @admin.display(description=_("SKU"), ordering="variant__sku")
    def variant_sku(self, obj):
        return compact_text(obj.variant.sku)

    @admin.display(description=_("Retail"))
    def retail_price(self, obj):
        return money(obj.retail, obj.product.currency)

    @admin.display(description=_("Wholesale"))
    def wholesale_price(self, obj):
        return money(obj.wholesale, obj.product.currency)


class TranslationLanguageFilter(SimpleListFilter):
    title = _("Language")
    parameter_name = "language"

    def lookups(self, request, model_admin):
        return [(code, language_name(code)) for code in LOCALES]

    def queryset(self, request, queryset):
        return queryset.filter(locale=self.value()) if self.value() else queryset


class TranslationAdmin(ProductIdentityMixin, CatalogueRecordAdmin):
    product_path = "revision__product"
    list_display = ["product_identity", "seller_identity", "language", "state", "translated_name", "version", "workflow_link"]
    list_select_related = ["revision__product__seller"]
    list_filter = ["state", TranslationLanguageFilter]
    search_fields = ["title", "revision__body__title", "revision__product__seller__display_name", "revision__product__seller__account__user__email"]
    search_help_text = _("Find by product name, translated title, seller or email")
    badge_fields = ["state"]

    @admin.display(description=_("Product"))
    def product_identity(self, obj):
        obj.admin_title = obj.revision.body.get("title") or _("Untitled product")
        return product_cell(obj, _("Revision %(number)s") % {"number": obj.revision.number})

    def get_list_display(self, request):
        columns = super().get_list_display(request)
        return [column for column in columns if column != "workflow_link"] if is_owner(request) else columns

    @admin.display(description=_("Translated title"), ordering="title")
    def translated_title(self, obj):
        return obj.title or "—"

    @admin.display(description=_("Translated title"), ordering="title")
    def translated_name(self, obj):
        return compact_text(obj.title)

    @admin.display(description=_("Language"), ordering="locale")
    def language(self, obj):
        return language_name(obj.locale)

    @admin.display(description=_("Source revision"), ordering="revision__number")
    def source_revision(self, obj):
        return _("Revision %(number)s") % {"number": obj.revision.number}

    @admin.display(description=_("Description"))
    def translated_description(self, obj):
        from django.utils.html import format_html

        return format_html('<div class="whitespace-pre-wrap break-words" dir="auto">{}</div>', obj.description or "—")

    @admin.display(description=_("Image descriptions"))
    def image_descriptions(self, obj):
        images = obj.revision.body.get("images", [])
        rows = [[_("Image %(number)s") % {"number": index}, image.get("alt") or "—",
                 obj.image_alts.get(str(image.get("id"))) or "—"] for index, image in enumerate(images, 1)]
        return panel_table([_("Image"), _("Original description"), _("Translated description")], rows, _("No image descriptions."))

    @admin.display(description=_("Approved translation"))
    def approved_content(self, obj):
        from django.utils.html import format_html

        if not obj.approved_body:
            return panel_note(_("No approved translation yet."))
        content = panel_table([_("Field"), _("Value")], [
            [_("Translated title"), obj.approved_body.get("title") or "—"],
            [_("Translated description"), obj.approved_body.get("description") or "—"],
        ], "")
        descriptions = obj.approved_body.get("image_alts") or {}
        images = obj.revision.body.get("images", [])
        return format_html('<div class="flex flex-col gap-3">{}{}</div>', content, panel_table(
            [_("Image"), _("Approved image description")],
            [[_("Image %(number)s") % {"number": index}, descriptions.get(str(image.get("id"))) or "—"]
             for index, image in enumerate(images, 1)], _("No image descriptions."),
        ))

    @admin.display(description=_("Related records"))
    def related_records(self, obj):
        return link_button(reverse("admin:catalogue_product_change", args=[obj.revision.product_id]), _("View product"), "inventory_2")

    def get_readonly_fields(self, request, obj=None):
        return [*super().get_readonly_fields(request, obj), "product_identity", "seller_identity", "language", "source_revision", "translated_title",
                "translated_description", "image_descriptions", "approved_content", "related_records"]

    def get_fieldsets(self, request, obj=None):
        return [
            (_("Identity"), {"fields": ["product_identity", "seller_identity", "source_revision", "language", "id", "related_records"]}),
            (_("Translation content"), {"fields": ["translated_title", "translated_description", "image_descriptions"]}),
            (_("Review status"), {"fields": ["state", "version", "human_edited", "reason", "approved_content"]}),
        ]

    def workflow_link(self, obj):
        url = reverse("admin:catalogue_workflow", args=[obj.revision.product_id])
        query = urlencode({"translation": "1", "revision": str(obj.revision_id), "target": obj.locale})
        return link_button(f"{url}?{query}", _("Open"), icon="translate")


JOB_TONES = {
    "queued": "warning", "running": "info", "completed": "success",
    "failed": "danger", "retry": "warning", "blocked": "default", "stale": "default",
}
CONTEXT_TONES = {
    "buyer": "info", "seller": "info", "staff": "default",
    "owner": "info", "system": "default", "other": "default",
}


class TranslationJobAdmin(CatalogueRecordAdmin):
    list_display = ["job_identity", "job_locale", "job_state", "attempts", "next_attempt_at", "error_code"]
    list_filter = ["status"]
    ordering = ["-next_attempt_at"]
    search_fields = ["translation__revision__body__title", "translation__revision__product__seller__display_name",
                     "translation__revision__product__seller__account__user__email"]
    search_help_text = _("Find by product name, seller or email")
    badge_fields = ["status"]

    def get_queryset(self, request):
        return super().get_queryset(request).select_related(
            "translation__revision__product__seller__account__user")

    def get_readonly_fields(self, request, obj=None):
        return [*super().get_readonly_fields(request, obj), "job_identity", "job_locale", "job_state"]

    def get_fieldsets(self, request, obj=None):
        return [
            (_("Identity"), {"fields": ["job_identity", "job_locale", "translation", "expected_version", "created_at"]}),
            (_("Delivery"), {"fields": ["job_state", "attempts", "next_attempt_at", "error_code", "input_chars"]}),
        ]

    @admin.display(description=_("Product"))
    def job_identity(self, obj):
        revision = obj.translation.revision
        title = revision.body.get("title") or _("Untitled product")
        return record_identity(title, obj.translation.revision.product.seller.display_name, glyph="translate")

    @admin.display(description=_("Language"), ordering="translation__locale")
    def job_locale(self, obj):
        return language_name(obj.translation.locale)

    @admin.display(description=_("Status"), ordering="status")
    def job_state(self, obj):
        return state_badge(obj.status, action_label(obj.status), JOB_TONES.get(obj.status, "default"))


class CatalogueEventAdmin(CatalogueRecordAdmin):
    list_display = ["event_identity", "event_context", "actor_identity", "event_reason", "created_at"]
    list_filter = ["action", "context"]
    ordering = ["-created_at"]
    search_fields = ["reason", "action", "product__seller__display_name", "product__seller__account__user__email"]
    search_help_text = _("Find by product, seller or email")
    badge_fields = ["action"]

    def get_queryset(self, request):
        return super().get_queryset(request).select_related("product__seller__account__user", "actor")

    def get_readonly_fields(self, request, obj=None):
        return [*super().get_readonly_fields(request, obj), "event_identity", "event_context", "actor_identity"]

    def get_fieldsets(self, request, obj=None):
        return [
            (_("Identity"), {"fields": ["event_identity", "event_context", "actor_identity", "created_at"]}),
            (_("Event"), {"fields": ["action", "reason", "product", "translation", "translation_version", "version"]}),
        ]

    @admin.display(description=_("Event"), ordering="action")
    def event_identity(self, obj):
        subject = obj.product.seller.display_name if obj.product_id else label("System")
        return record_identity(action_label(obj.action), subject, glyph="history")

    @admin.display(description=_("Context"), ordering="context")
    def event_context(self, obj):
        key, title = context_status(obj.context)
        return state_badge(obj.context, title, CONTEXT_TONES.get(key, "default"))

    @admin.display(description=_("Actor"), ordering="actor__display_name")
    def actor_identity(self, obj):
        if not obj.actor_id:
            return label("System")
        return record_identity(obj.actor.display_name or obj.actor.email, obj.actor.email, glyph="person")

    @admin.display(description=_("Reason"))
    def event_reason(self, obj):
        return obj.reason or "—"


class BudgetAdmin(ReadOnlyAdmin):
    list_display = ["day", "calls", "characters"]
    ordering = ["-day"]

    def get_fieldsets(self, request, obj=None):
        return [(None, {"fields": ["day", "calls", "characters"], "description": self.RECORD_DESCRIPTION})]


owner_site.register(SourceRevision, RevisionAdmin)
owner_site.register(Variant, VariantAdmin)
owner_site.register(PriceChange, PriceChangeAdmin)
owner_site.register(Translation, TranslationAdmin)
owner_site.register(TranslationJob, TranslationJobAdmin)
owner_site.register(CatalogueEvent, CatalogueEventAdmin)
owner_site.register(TranslationBudget, BudgetAdmin)
