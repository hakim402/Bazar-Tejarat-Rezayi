"""Readable, read-only pages for the retained secondary order records.

Everything here is frozen history: accepted order items, checkout requests and
their per-seller outcomes, recorded order events, negotiation submissions and
their command records, and the seller checkout terms. None of these pages owns a
workflow, so none of them offers generic editing or deletion. Each record shows
the order, request or decision it belongs to and links to that workspace instead
of repeating it.
"""

from django.contrib import admin as django_admin
from django.db.models import OuterRef, Subquery
from django.urls import reverse
from django.utils.html import format_html, format_html_join
from django.utils.translation import gettext_lazy as _

from apps.accounts.admin.access import permits
from apps.accounts.admin.display import money, quantity, short_id, state_badge
from apps.catalogue.admin.helpers import link_button, panel_note, panel_table
from apps.catalogue.admin.presentation import compact_text, identity, seller_cell
from apps.catalogue.admin.summaries import localized
from apps.catalogue.models import ProductImage, SourceRevision, Variant
from apps.organizations.admin import ReadOnlyAdmin

from .admin_presentation import RelatedOrderMixin, account_cell, line_identity
from .models import (
    CheckoutOutcome,
    CheckoutSubmission,
    NegotiationCommand,
    NegotiationOutcome,
    NegotiationSubmission,
    NegotiationSubmissionFence,
    OrderEvent,
    OrderLine,
    SellerCheckoutTerms,
)

# Action words are recorded by trusted services. The tone only reflects what the
# action did, never who performed it.
ACTION_TONES = (
    ("approved", "success"),
    ("rejected", "danger"),
    ("failed", "danger"),
    ("withdrawn", "info"),
    ("assigned", "info"),
    ("decided", "info"),
    ("requested", "warning"),
    ("proposed", "warning"),
    ("submitted", "warning"),
    ("opened", "warning"),
    ("hold", "warning"),
)


def readable_action(value):
    text = str(value or "").replace("_", " ").strip()
    return _(text).capitalize() if text else "—"


def action_tone(value):
    text = str(value or "")
    for suffix, tone in ACTION_TONES:
        if text.endswith(suffix):
            return tone
    return "default"


def link_row(links, empty=None):
    if not links:
        return panel_note(empty or _("No related records."))
    return format_html('<div class="flex flex-wrap gap-2">{}</div>', format_html_join("", "{}", ((link,) for link in links)))


def variant_labels(variant_ids):
    """Resolve retained selection rows to product title, SKU and seller name."""
    ids = {str(value) for value in variant_ids if value}
    if not ids:
        return {}
    variants = list(Variant.objects.filter(pk__in=ids).select_related("product__seller"))
    titles = {}
    for revision in SourceRevision.objects.filter(
        product_id__in={variant.product_id for variant in variants}
    ).order_by("-number"):
        body = revision.body or {}
        titles.setdefault(str(revision.product_id), localized(body.get("titles"), body.get("title") or ""))
    return {
        str(variant.pk): (
            titles.get(str(variant.product_id)) or variant.sku,
            variant.sku,
            variant.product.seller.display_name,
        )
        for variant in variants
    }


def selection_table(selections):
    """Compact table of the items a submission carried when it was sent."""
    rows = []
    labels = variant_labels([row.get("variant") for row in selections or []])
    for row in selections or []:
        title, sku, seller_name = labels.get(str(row.get("variant")), ("—", "—", "—"))
        rows.append([
            identity(title, sku),
            state_badge(row.get("tier", "")),
            quantity(row.get("quantity")),
            seller_name,
        ])
    return panel_table(
        [_("Product"), _("Sales tier"), _("Quantity"), _("Seller")],
        rows,
        _("No items in this record."),
    )


class RetainedRecordAdmin(ReadOnlyAdmin):
    """Owner-only retained record: read-only, no new authority."""

    def get_readonly_fields(self, request, obj=None):
        return self.fields


class OrderLineAdmin(RelatedOrderMixin, RetainedRecordAdmin):
    """The accepted items of an order: the names, tier, quantity and prices that were frozen at acceptance."""

    order_source = "order"
    fields = [
        "product_identity",
        "order_reference",
        "buyer_identity",
        "seller_identity",
        "tier_label",
        "sale_unit",
        "quantity_label",
        "unit_price_label",
        "goods_amount_label",
        "order_workspace",
    ]
    list_display = [
        "product_identity",
        "order_reference",
        "seller_identity",
        "tier_label",
        "quantity_label",
        "unit_price_label",
        "goods_amount_label",
    ]
    list_filter = ["tier"]
    ordering = ["-order__accepted_at", "pk"]
    search_fields = ["order__id", "order__invoice__number", "snapshot__sku"]
    search_help_text = _("Find by order, invoice number or SKU")
    fieldset_groups = [
        (_("Accepted item"), _("The exact item that was accepted. Names, tier, quantity and prices are frozen history; approved amendments project new values without rewriting this line."),
         ["product_identity", "tier_label", "sale_unit", "quantity_label", "unit_price_label", "goods_amount_label"]),
        (_("Order"), _("The accepted order this item belongs to."), ["order_reference", "buyer_identity", "seller_identity", "order_workspace"]),
    ]

    def staff_view(self, request, obj=None):
        return permits(request, "orders", "read_orders")

    def get_queryset(self, request):
        images = ProductImage.objects.filter(product_id=OuterRef("variant__product_id")).order_by("created_at", "pk")
        return super().get_queryset(request).select_related(
            "order__invoice", "order__buyer__user", "order__seller__account__user", "variant"
        ).annotate(admin_cover=Subquery(images.values("pk")[:1]))

    @django_admin.display(description=_("Product"))
    def product_identity(self, obj):
        return line_identity(obj, getattr(obj, "admin_cover", None))

    @django_admin.display(description=_("Sales tier"))
    def tier_label(self, obj):
        return state_badge(obj.tier)

    @django_admin.display(description=_("Sale unit"))
    def sale_unit(self, obj):
        return localized(obj.snapshot.get("unit_labels"), obj.snapshot.get("unit", "—"))

    @django_admin.display(description=_("Quantity"))
    def quantity_label(self, obj):
        return quantity(obj.quantity)

    @django_admin.display(description=_("Unit price"))
    def unit_price_label(self, obj):
        return money(obj.unit_price, obj.order.currency)

    @django_admin.display(description=_("Line total"))
    def goods_amount_label(self, obj):
        return money(obj.goods_amount, obj.order.currency)


class SellerCheckoutTermsAdmin(RetainedRecordAdmin):
    """A seller's own checkout terms: where they deliver and how they are paid."""

    fields = ["seller_identity", "status_label", "methods_label", "version", "updated_at", "destination_detail"]
    list_display = ["seller_identity", "status_label", "methods_label", "destination_count", "version", "updated_at"]
    ordering = ["-updated_at"]
    search_fields = ["seller__display_name", "seller__account__user__email"]
    search_help_text = _("Find by seller name or email")
    fieldset_groups = [
        (_("Checkout terms"), _("The seller's own checkout terms. Buyers are only offered these destinations and payment methods; the seller changes them in their own store settings."),
         ["seller_identity", "status_label", "methods_label", "version", "updated_at"]),
        (_("Delivery destinations"), _("Where this seller delivers, as accepted at the time."), ["destination_detail"]),
    ]

    def get_queryset(self, request):
        return super().get_queryset(request).select_related("seller__account__user")

    @django_admin.display(description=_("Seller"))
    def seller_identity(self, obj):
        return seller_cell(obj.seller)

    @django_admin.display(description=_("Status"))
    def status_label(self, obj):
        return state_badge("enabled" if obj.enabled else "disabled")

    @django_admin.display(description=_("Payment methods"))
    def methods_label(self, obj):
        labels = {"advance": _("Advance payment"), "cod": _("Cash on delivery")}
        methods = [str(labels.get(method, readable_action(method))) for method in obj.methods or []]
        return ", ".join(methods) if methods else "—"

    @django_admin.display(description=_("Destinations"))
    def destination_count(self, obj):
        return len(obj.destinations or [])

    @django_admin.display(description=_("Delivery destinations"))
    def destination_detail(self, obj):
        rows = []
        for destination in obj.destinations or []:
            cities = destination.get("cities") or []
            rows.append([
                destination.get("country", "—"),
                _("Every city") if destination.get("all_cities") else _("Selected cities"),
                ", ".join(cities) if cities else "—",
            ])
        return panel_table([_("Country"), _("City scope"), _("Cities")], rows, _("No destinations are configured."))


class CheckoutSubmissionAdmin(RetainedRecordAdmin):
    """A buyer's checkout request before it becomes an accepted order."""

    fields = ["buyer_identity", "item_count", "seller_count", "currency_label", "command_key", "created_at", "submitted_items", "submission_records"]
    list_display = ["buyer_identity", "item_count", "seller_count", "currency_label", "command_key", "created_at"]
    list_filter = ["created_at"]
    ordering = ["-created_at"]
    search_fields = ["buyer__user__display_name", "buyer__user__email"]
    search_help_text = _("Find by buyer name or email")
    fieldset_groups = [
        (_("Submission"), _("The buyer's checkout request exactly as it was sent. It is retained history; the accepted order and its invoice hold the binding values."),
         ["buyer_identity", "item_count", "seller_count", "currency_label", "command_key", "created_at"]),
        (_("Submitted items"), _("The items the buyer submitted with this request."), ["submitted_items"]),
        (_("Related records"), _("The workspace that owns this record. Any change happens there, never in this retained history."), ["submission_records"]),
    ]

    def get_queryset(self, request):
        return super().get_queryset(request).select_related("buyer__user")

    @django_admin.display(description=_("Buyer account"))
    def buyer_identity(self, obj):
        return account_cell(obj.buyer)

    @django_admin.display(description=_("Items"))
    def item_count(self, obj):
        return len(obj.selections or [])

    @django_admin.display(description=_("Sellers"))
    def seller_count(self, obj):
        return len({row.get("seller") for row in obj.selections or []})

    @django_admin.display(description=_("Currency"))
    def currency_label(self, obj):
        return (obj.payload or {}).get("currency", "—")

    @django_admin.display(description=_("Command key"))
    def command_key(self, obj):
        return short_id(obj.key)

    @django_admin.display(description=_("Submitted items"))
    def submitted_items(self, obj):
        return selection_table(obj.selections)

    @django_admin.display(description=_("Outcome"))
    def submission_records(self, obj):
        links = [
            link_button(reverse("admin:orders_checkoutoutcome_change", args=[outcome.pk]), _("View checkout outcome"), "receipt_long")
            for outcome in obj.outcomes.all()
        ]
        return link_row(links)


class CheckoutOutcomeAdmin(RelatedOrderMixin, RetainedRecordAdmin):
    """The outcome of one seller's part of a checkout request."""

    order_source = "order"
    fields = ["seller_identity", "state_label", "code_label", "version", "submission_reference", "order_workspace"]
    list_display = ["seller_identity", "state_label", "code_label", "version", "submission_reference"]
    ordering = ["-id"]
    search_fields = ["seller__display_name", "seller__account__user__email", "submission__buyer__user__email"]
    search_help_text = _("Find by seller name or buyer email")
    fieldset_groups = [
        (_("Outcome"), _("How one seller's part of a checkout request ended. The accepted order and its invoice are created from the same request."),
         ["seller_identity", "state_label", "code_label", "version"]),
        (_("Related records"), _("The workspace that owns this record. Any change happens there, never in this retained history."), ["submission_reference", "order_workspace"]),
    ]

    def get_queryset(self, request):
        return super().get_queryset(request).select_related(
            "seller__account__user", "submission__buyer__user", "order__invoice"
        )

    @django_admin.display(description=_("Seller"))
    def seller_identity(self, obj):
        return seller_cell(obj.seller)

    @django_admin.display(description=_("Status"))
    def state_label(self, obj):
        return state_badge(obj.state)

    @django_admin.display(description=_("Outcome code"))
    def code_label(self, obj):
        return compact_text(obj.code, 40) if obj.code else "—"

    @django_admin.display(description=_("Submission"))
    def submission_reference(self, obj):
        return link_button(
            reverse("admin:orders_checkoutsubmission_change", args=[obj.submission_id]),
            _("View checkout submission"),
            "receipt_long",
        )


class OrderEventAdmin(RelatedOrderMixin, RetainedRecordAdmin):
    """Recorded order activity: what happened, who recorded it and when."""

    order_source = "order"
    fields = ["event_identity", "order_reference", "action_label", "actor_identity", "context_label", "reason_excerpt", "created_at", "event_state", "order_workspace"]
    list_display = ["event_identity", "order_reference", "action_label", "actor_identity", "context_label", "created_at"]
    list_filter = ["context", "action", "created_at"]
    ordering = ["-created_at"]
    search_fields = ["actor__email", "account__user__email", "order__invoice__number"]
    search_help_text = _("Find by actor email or invoice number")
    fieldset_groups = [
        (_("Recorded activity"), _("What the trusted order services recorded, and who recorded it. The event log is append-only history."),
         ["event_identity", "action_label", "actor_identity", "context_label", "reason_excerpt", "created_at"]),
        (_("Related records"), _("The workspace that owns this record. Any change happens there, never in this retained history."), ["order_reference", "order_workspace", "event_state"]),
    ]

    def get_queryset(self, request):
        return super().get_queryset(request).select_related(
            "actor", "account__user", "order__invoice", "seller__account__user"
        )

    @django_admin.display(description=_("Activity"))
    def event_identity(self, obj):
        return identity(readable_action(obj.action), str(obj.pk)[:8], glyph="bolt")

    @django_admin.display(description=_("Action"))
    def action_label(self, obj):
        return state_badge(obj.action, readable_action(obj.action), action_tone(obj.action))

    @django_admin.display(description=_("Recorded by"))
    def actor_identity(self, obj):
        user = obj.actor
        return identity(user.display_name or user.email, user.email, glyph="person")

    @django_admin.display(description=_("Context"))
    def context_label(self, obj):
        return state_badge(obj.context)

    @django_admin.display(description=_("Reason"))
    def reason_excerpt(self, obj):
        return compact_text(obj.reason, 80)

    @django_admin.display(description=_("Recorded state"))
    def event_state(self, obj):
        state = obj.state or {}
        rows = [[key, compact_text(str(value), 80)] for key, value in list(state.items())[:12]]
        return panel_table([_("State detail"), _("Value")], rows, _("No additional state was recorded."))


class NegotiationSubmissionAdmin(RetainedRecordAdmin):
    """A buyer's formal request before it becomes a negotiation."""

    fields = ["buyer_identity", "item_count", "seller_count", "currency_label", "command_key", "created_at", "submitted_items", "proposal_detail", "submission_records"]
    list_display = ["buyer_identity", "item_count", "seller_count", "currency_label", "command_key", "created_at"]
    list_filter = ["created_at"]
    ordering = ["-created_at"]
    search_fields = ["buyer__user__display_name", "buyer__user__email"]
    search_help_text = _("Find by buyer name or email")
    fieldset_groups = [
        (_("Submission"), _("The buyer's formal request exactly as it was sent, including one proposal per seller. The negotiation record holds the accepted proposal history."),
         ["buyer_identity", "item_count", "seller_count", "currency_label", "command_key", "created_at"]),
        (_("Submitted items"), _("The items the buyer submitted with this request."), ["submitted_items"]),
        (_("Seller proposals"), _("The proposal each seller received with this request."), ["proposal_detail"]),
        (_("Related records"), _("The workspace that owns this record. Any change happens there, never in this retained history."), ["submission_records"]),
    ]

    def get_queryset(self, request):
        return super().get_queryset(request).select_related("buyer__user")

    @django_admin.display(description=_("Buyer account"))
    def buyer_identity(self, obj):
        return account_cell(obj.buyer)

    @django_admin.display(description=_("Items"))
    def item_count(self, obj):
        return len(obj.selections or [])

    @django_admin.display(description=_("Sellers"))
    def seller_count(self, obj):
        return len({row.get("seller") for row in obj.selections or []})

    @django_admin.display(description=_("Currency"))
    def currency_label(self, obj):
        return (obj.payload or {}).get("currency", "—")

    @django_admin.display(description=_("Command key"))
    def command_key(self, obj):
        return short_id(obj.key)

    @django_admin.display(description=_("Submitted items"))
    def submitted_items(self, obj):
        return selection_table(obj.selections)

    @django_admin.display(description=_("Seller proposals"))
    def proposal_detail(self, obj):
        rows = []
        for proposal in (obj.payload or {}).get("proposals", []):
            choice = proposal.get("choice", {})
            rows.append([
                short_id(choice.get("seller")),
                choice.get("country", "—"),
                choice.get("city", "—"),
                _("Cash on delivery") if choice.get("method") == "cod" else _("Advance payment"),
                len(proposal.get("lines", [])),
            ])
        return panel_table(
            [_("Seller"), _("Country"), _("City"), _("Payment method"), _("Proposed items")],
            rows,
            _("No proposals were sent with this request."),
        )

    @django_admin.display(description=_("Outcome"))
    def submission_records(self, obj):
        links = [
            link_button(reverse("admin:orders_negotiationoutcome_change", args=[outcome.pk]), _("View request outcome"), "receipt_long")
            for outcome in obj.outcomes.all()
        ]
        return link_row(links)


class NegotiationOutcomeAdmin(RelatedOrderMixin, RetainedRecordAdmin):
    """The outcome of one seller's part of a formal request."""

    order_source = "request__order"
    fields = ["seller_identity", "state_label", "code_label", "version", "submission_reference", "request_workspace", "order_workspace"]
    list_display = ["seller_identity", "state_label", "code_label", "version", "submission_reference"]
    ordering = ["-id"]
    search_fields = ["seller__display_name", "seller__account__user__email", "submission__buyer__user__email"]
    search_help_text = _("Find by seller name or buyer email")
    fieldset_groups = [
        (_("Outcome"), _("How one seller's part of a formal request ended. An accepted request becomes a negotiation with its own proposal history."),
         ["seller_identity", "state_label", "code_label", "version"]),
        (_("Related records"), _("The workspace that owns this record. Any change happens there, never in this retained history."), ["submission_reference", "request_workspace", "order_workspace"]),
    ]

    def get_queryset(self, request):
        return super().get_queryset(request).select_related(
            "seller__account__user", "submission__buyer__user", "request__buyer__user", "request__seller__account__user"
        )

    @django_admin.display(description=_("Seller"))
    def seller_identity(self, obj):
        return seller_cell(obj.seller)

    @django_admin.display(description=_("Status"))
    def state_label(self, obj):
        return state_badge(obj.state)

    @django_admin.display(description=_("Outcome code"))
    def code_label(self, obj):
        return compact_text(obj.code, 40) if obj.code else "—"

    @django_admin.display(description=_("Submission"))
    def submission_reference(self, obj):
        return link_button(
            reverse("admin:orders_negotiationsubmission_change", args=[obj.submission_id]),
            _("View request submission"),
            "receipt_long",
        )

    @django_admin.display(description=_("Request workspace"))
    def request_workspace(self, obj):
        request = getattr(obj, "request", None)
        if request is None:
            return panel_note(_("No formal request is linked to this record."))
        return link_button(
            reverse("admin:orders_negotiation_change", args=[request.pk]),
            _("View formal request"),
            "receipt_long",
        )


class NegotiationCommandAdmin(RelatedOrderMixin, RetainedRecordAdmin):
    """A settled command of a formal request: the exact input that was accepted once."""

    order_source = "request__order"
    fields = ["command_identity", "actor_identity", "request_reference", "request_workspace", "command_key", "created_at", "command_result", "order_workspace"]
    list_display = ["command_identity", "request_reference", "actor_identity", "command_key", "created_at"]
    ordering = ["-created_at"]
    search_fields = ["actor__user__email", "request__buyer__user__email", "request__seller__display_name"]
    search_help_text = _("Find by actor email, buyer email or seller name")
    fieldset_groups = [
        (_("Command"), _("One accepted command of a formal request. Commands are settled once; the same command key cannot be replayed with different input."),
         ["command_identity", "actor_identity", "command_key", "created_at"]),
        (_("Related records"), _("The workspace that owns this record. Any change happens there, never in this retained history."), ["request_reference", "request_workspace", "order_workspace"]),
        (_("Command result"), _("What the accepted command produced. The technical digest stays secondary."), ["command_result"]),
    ]

    def get_queryset(self, request):
        return super().get_queryset(request).select_related(
            "actor__user", "request__buyer__user", "request__seller__account__user"
        )

    @django_admin.display(description=_("Command"))
    def command_identity(self, obj):
        return identity(_("Negotiation command"), str(obj.pk)[:8], glyph="bolt")

    @django_admin.display(description=_("Submitted by"))
    def actor_identity(self, obj):
        return account_cell(obj.actor)

    @django_admin.display(description=_("Request"))
    def request_reference(self, obj):
        request = getattr(obj, "request", None)
        if request is None:
            return "—"
        return identity(_("Negotiation"), str(request.pk)[:8], glyph="receipt_long")

    @django_admin.display(description=_("Request workspace"))
    def request_workspace(self, obj):
        request = getattr(obj, "request", None)
        if request is None:
            return panel_note(_("No formal request is linked to this record."))
        return link_button(
            reverse("admin:orders_negotiation_change", args=[request.pk]),
            _("View formal request"),
            "receipt_long",
        )

    @django_admin.display(description=_("Command key"))
    def command_key(self, obj):
        return short_id(obj.key)

    @django_admin.display(description=_("Command result"))
    def command_result(self, obj):
        result = obj.result or {}
        rows = [[key, compact_text(str(value), 80)] for key, value in list(result.items())[:12]]
        return panel_table([_("Result detail"), _("Value")], rows, _("No result detail was recorded."))


class NegotiationSubmissionFenceAdmin(RetainedRecordAdmin):
    """A settled recovery marker that stops one request key from being reused."""

    fields = ["buyer_identity", "command_key", "created_at"]
    list_display = ["buyer_identity", "command_key", "created_at"]
    ordering = ["-created_at"]
    search_fields = ["buyer__user__display_name", "buyer__user__email"]
    search_help_text = _("Find by buyer name or email")
    fieldset_groups = [
        (_("Recovery marker"), _("A request key that has already been settled. It exists so an uncertain submission can never be applied twice."),
         ["buyer_identity", "command_key", "created_at"]),
    ]

    def get_queryset(self, request):
        return super().get_queryset(request).select_related("buyer__user")

    @django_admin.display(description=_("Buyer account"))
    def buyer_identity(self, obj):
        return account_cell(obj.buyer)

    @django_admin.display(description=_("Command key"))
    def command_key(self, obj):
        return short_id(obj.key)
