"""Owner payment pages: readable identities, references and bounded records.

Mirrors ``apps.fulfilment.admin_presentation``: one record per page, related
facts stay linked, retained financial history is read-only and every guarded
decision happens in its own workspace. Display-only — no permission, guard or
business behavior lives here.
"""

from django.contrib import admin
from django.db import models
from django.urls import NoReverseMatch, reverse
from django.utils.html import format_html, format_html_join
from django.utils.translation import gettext_lazy as _

from apps.accounts.admin.access import is_owner
from apps.accounts.admin.display import money, quantity, short_id, state_badge
from apps.catalogue.admin.helpers import link_button, panel_table
from apps.catalogue.admin.presentation import seller_cell
from apps.orders.admin_presentation import account_cell


# Relation path from each record to its order; defaults to a direct ``order``.
ORDER_PATHS = {
    "correction": "receipt__order", "receiptseal": "receipt__order",
    "claimdecision": "claim__order", "stockplanline": "plan__order",
    "stockplanseal": "plan__order", "allocationattempt": "intent__order",
    "evidencebinding": "evidence__order", "caseevent": "case__order",
    "refundreport": "due__order", "refunddecision": "report__due__order",
    "refundseal": "due__order", "emailattempt": "email__order",
    "noticecursor": "event__order",
}
NO_ORDER = {"sweepcursor"}
# Reverse relations prefetched once per owner listing to avoid a query per row.
PREFETCH = {"refunddue": ["reports__decision"], "refundreport": ["decision"]}
# Scalars hidden from the readable record panel (secret/technical or shown elsewhere).
INTERNAL = {
    "id", "order", "event", "actor", "account", "creator", "created_at", "key",
    "sha256", "digest", "storage_alias", "lease", "identity_digest", "after_id",
    "after_account", "previous", "replacement",
}
BADGEABLE = {"kind", "state", "action", "cause", "status", "code"}
LABELS = {
    "kind": _("Review category"), "state": _("Status"), "status": _("Status"),
    "action": _("Decision"), "cause": _("Cause"), "code": _("Result code"),
    "result": _("Recorded result"), "amount": _("Amount"), "currency": _("Currency"),
    "quantity": _("Quantity"), "reference": _("Reference"), "description": _("Description"),
    "reason": _("Reason"), "paid_at": _("Paid at"), "sent_at": _("Refund sent at"),
    "due_at": _("Deadline"), "before_at": _("Previous deadline"), "target_version": _("Target receipt version"),
    "version": _("Version"), "generation": _("Generation"), "revision": _("Revision"),
    "slot": _("Slot"), "attempts": _("Attempts"), "number": _("Attempt number"),
    "next_check_at": _("Next check"), "checked_at": _("Last checked"),
    "overdue_active": _("Overdue case open"), "intent_version": _("Selection version"),
    "complete": _("Complete"), "sector": _("Sweep sector"), "name": _("Name"),
    "size": _("File size (bytes)"), "width": _("Image width"), "height": _("Image height"),
    "expires_at": _("Expires at"), "lease_until": _("Leased until"), "allocation": _("Stock allocation"),
}


def describe(value):
    if value is None:
        return "—"
    if isinstance(value, dict):
        return panel_table([_("Field"), _("Value")],
                           [[LABELS.get(key, _(key.replace("_", " ").capitalize())), describe(item)] for key, item in value.items()],
                           _("No recorded values."))
    if isinstance(value, list):
        return format_html_join("", '<div class="mb-2">{}</div>', ((describe(item),) for item in value)) or "—"
    if isinstance(value, bool):
        return _("Yes") if value else _("No")
    return value


# Explicit owner columns for the daily-attention records; others compute generically.
OWNER_LISTS = {
    "reviewcase": ["record_reference", "order_reference", "buyer_identity", "seller_identity", "kind", "state", "reviewer", "created_at", "workspace"],
    "refunddue": ["record_reference", "order_reference", "buyer_identity", "seller_identity", "cause", "amount_display", "state", "reviewer", "created_at", "workspace"],
    "refundreport": ["record_reference", "order_reference", "seller_identity", "amount_display", "report_state", "sent_at", "created_at"],
    "claim": ["record_reference", "order_reference", "seller_identity", "amount_display", "paid_at", "created_at"],
    "receipt": ["record_reference", "order_reference", "seller_identity", "amount_display", "paid_at", "created_at"],
    "correction": ["record_reference", "order_reference", "amount_display", "target_version", "created_at"],
    "finance": ["order_reference", "buyer_identity", "seller_identity", "version", "next_check_at"],
    "evidence": ["record_reference", "order_reference", "size", "created_at"],
}
GENERIC_BADGES = ("kind", "state", "status", "action", "cause", "code")
GENERIC_NUMBERS = ("version", "number", "target_version", "generation", "attempts", "slot")
GENERIC_DATES = ("paid_at", "sent_at", "due_at", "next_check_at", "checked_at", "created_at", "updated_at")


class OwnerPaymentPresentation:
    """Readable owner listings/details; staff scoping and guards are untouched."""

    owner_rich_detail = True

    def order_relation(self):
        return ORDER_PATHS.get(self.model._meta.model_name, "order")

    def payment_order(self, obj):
        if self.model._meta.model_name in NO_ORDER:
            return None
        for part in self.order_relation().split("__"):
            obj = getattr(obj, part, None)
            if obj is None:
                return None
        return obj

    def get_queryset(self, request):
        qs = super().get_queryset(request)
        if not is_owner(request):
            return qs
        if hasattr(self.model, "construction"):
            qs = self.model.construction.all()
        if self.model._meta.model_name in NO_ORDER:
            return qs
        path = self.order_relation()
        relations = [field.name for field in self.model._meta.fields if field.is_relation]
        qs = qs.select_related(*relations, path + "__invoice", path + "__buyer__user", path + "__seller__account__user")
        if prefetch := PREFETCH.get(self.model._meta.model_name):
            qs = qs.prefetch_related(*prefetch)
        return qs

    # --- Listing columns ----------------------------------------------------
    def generic_columns(self):
        fields = {field.name for field in self.model._meta.fields}
        columns = ["record_reference"]
        if self.model._meta.model_name not in NO_ORDER:
            columns.append("order_reference")
        columns += [name for name in GENERIC_BADGES if name in fields]
        if "amount" in fields:
            columns.append("amount_display")
        if "quantity" in fields:
            columns.append("quantity_display")
        columns += [name for name in GENERIC_NUMBERS if name in fields]
        columns += [name for name in GENERIC_DATES if name in fields]
        return list(dict.fromkeys(columns))

    def owner_columns(self):
        columns = OWNER_LISTS.get(self.model._meta.model_name) or self.generic_columns()
        result = []
        for name in columns:
            if hasattr(self, name):
                result.append(name)
            elif name in BADGEABLE:
                result.append(self._badge_column(name))
            else:
                result.append(name)
        return result

    def _badge_column(self, field):
        def render(obj):
            display = getattr(obj, f"get_{field}_display", None)
            return state_badge(display() if display else getattr(obj, field, None))
        render.short_description = LABELS.get(field, field.replace("_", " ").capitalize())
        render.admin_order_field = field
        return render

    def get_list_display(self, request):
        if is_owner(request):
            return self.owner_columns()
        return super().get_list_display(request)

    def get_search_fields(self, request):
        if not is_owner(request) or self.model._meta.model_name in NO_ORDER:
            return super().get_search_fields(request)
        path = self.order_relation()
        fields = {field.name for field in self.model._meta.fields}
        return [path + "__invoice__number", path + "__seller__display_name", path + "__buyer__user__email",
                *[name for name in ("reference", "reason", "description") if name in fields]]

    # --- Detail wiring ------------------------------------------------------
    def owner_readonly(self, request, fields):
        extra = ["record_reference", "order_reference", "buyer_identity", "seller_identity",
                 "record_details", "related_records", "recorded_at", "owner_workflow"]
        return list(dict.fromkeys([*fields, *extra])) if is_owner(request) else fields

    def get_fields(self, request, obj=None):
        if getattr(self, "fields", None):
            return super().get_fields(request, obj)
        names = [field.name for field in self.model._meta.fields]
        if not is_owner(request):
            names = [name for name in names if name not in {"actor", "account", "creator", "key", "digest", "sha256", "storage_alias", "lease", "identity_digest"}]
        return names

    def get_readonly_fields(self, request, obj=None):
        return self.owner_readonly(request, self.get_fields(request, obj))

    def get_fieldsets(self, request, obj=None):
        if not is_owner(request) or not self.owner_rich_detail:
            return super().get_fieldsets(request, obj)
        identity = ["record_reference"]
        if self.model._meta.model_name not in NO_ORDER:
            identity += ["order_reference", "buyer_identity", "seller_identity"]
        if any(field.name == "created_at" for field in self.model._meta.fields):
            identity.append("recorded_at")
        return [
            (_("Identity"), {"fields": identity}),
            (_("Record details"), {"fields": ["record_details"]}),
            (_("Related records and actions"), {"fields": ["owner_workflow", "related_records"],
             "description": _("Open the related record for its full details. Financial changes use the guarded review workspace; retained money and stock history cannot be edited or deleted here.")}),
        ]

    # --- Display methods ----------------------------------------------------
    @admin.display(description=_("Reference"))
    def record_reference(self, obj):
        return short_id(obj.pk)

    @admin.display(description=_("Order"))
    def order_reference(self, obj):
        order = self.payment_order(obj)
        if order is None:
            return "—"
        invoice = getattr(order, "invoice", None)
        try:
            url = reverse("admin:orders_sellerorder_change", args=[order.pk])
        except NoReverseMatch:
            return invoice.number if invoice else short_id(order.pk)
        return link_button(url, invoice.number if invoice else str(order.pk)[:8], "receipt_long")

    @admin.display(description=_("Buyer account"))
    def buyer_identity(self, obj):
        order = self.payment_order(obj)
        return account_cell(order.buyer) if order else "—"

    @admin.display(description=_("Seller account"))
    def seller_identity(self, obj):
        order = self.payment_order(obj)
        return seller_cell(order.seller) if order else "—"

    @admin.display(description=_("Amount"), ordering="amount")
    def amount_display(self, obj):
        order = self.payment_order(obj)
        currency = getattr(obj, "currency", None) or (order.currency if order else None)
        return money(getattr(obj, "amount", None), currency)

    @admin.display(description=_("Quantity"), ordering="quantity")
    def quantity_display(self, obj):
        return quantity(getattr(obj, "quantity", None))

    @admin.display(description=_("Recorded at"))
    def recorded_at(self, obj):
        return getattr(obj, "created_at", None)

    @admin.display(description=_("Report status"))
    def report_state(self, obj):
        decision = getattr(obj, "decision", None)
        return state_badge(decision.action if decision else "pending")

    @admin.display(description=_("Record details"))
    def record_details(self, obj):
        rows = []
        order = self.payment_order(obj)
        for field in self.model._meta.fields:
            if field.is_relation or field.name in INTERNAL:
                continue
            if field.name == "currency" and hasattr(obj, "amount"):
                continue
            value = getattr(obj, field.name)
            if isinstance(field, models.DecimalField):
                value = quantity(value) if field.name == "quantity" else money(value, getattr(obj, "currency", None) or (order.currency if order else None))
            elif field.name in BADGEABLE:
                display = getattr(obj, f"get_{field.name}_display", None)
                value = state_badge(display() if display else value)
            elif isinstance(field, models.BooleanField):
                value = _("Yes") if value else _("No")
            else:
                value = describe(value)
            rows.append([LABELS.get(field.name, field.verbose_name), value])
        return panel_table([_("Field"), _("Value")], rows, _("This record only links related facts."))

    @admin.display(description=_("Actions"))
    def owner_workflow(self, obj):
        order = self.payment_order(obj)
        if order is None:
            return "—"
        return link_button(reverse("admin:orders_sellerorder_change", args=[order.pk]), _("View order"), "receipt_long")

    @admin.display(description=_("Related records"))
    def related_records(self, obj):
        links = []
        for field in self.model._meta.fields:
            if not field.is_relation or field.name in INTERNAL or not getattr(obj, field.attname, None):
                continue
            related = getattr(obj, field.name)
            label = next((getattr(related, name) for name in ("number", "name", "sku", "reference", "display_name") if getattr(related, name, None)), None)
            title = format_html('{} · {}', field.verbose_name, label or str(related.pk)[:8])
            try:
                url = reverse(f"admin:{related._meta.app_label}_{related._meta.model_name}_change", args=[related.pk])
            except NoReverseMatch:
                continue
            links.append(link_button(url, title))
        return format_html('<div class="flex flex-wrap gap-2">{}</div>', format_html_join("", "{}", ((link,) for link in links))) or "—"
