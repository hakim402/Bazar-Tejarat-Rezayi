"""Shared admin presentation helpers: status badges, exact money, grouped fieldsets.

Display-only: no permission, guard or business behavior changes. Badge classes reuse
Unfold's compiled badge palette so no extra CSS build is required.
"""

from django.utils.html import format_html

BADGE_BASE = (
    "font-semibold h-[18px] leading-[18px] px-1 rounded-xs text-center text-[11px] "
    "whitespace-nowrap uppercase min-w-[18px] inline-block align-middle"
)
BADGE_COLORS = {
    "warning": "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400",
    "success": "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400",
    "danger": "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400",
    "info": "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400",
    "default": "bg-base-100 text-base-700 dark:bg-base-500/20 dark:text-base-400",
}
STATE_VARIANTS = {
    "warning": {
        "pending", "open", "submitted", "under_review", "reported", "review_required",
        "shortage", "blocked_zero", "queued", "retry_due", "claimed", "dispatching",
        "draft", "referred", "incomplete", "unpaid", "partial",
    },
    "success": {
        "approved", "confirmed", "completed", "active", "resolved", "paid", "published",
        "captured", "smtp_accepted", "consumed", "released", "verified", "enabled",
        "overpaid", "delivered", "dispatched", "settled",
    },
    "danger": {
        "rejected", "cancelled", "suspended", "exhausted", "failed", "expired",
        "disabled", "delivery_unknown", "revoked", "blocked",
    },
    "info": {
        "held", "reserved", "sealed", "withdrawn", "decided", "erroneous", "running",
        "complete", "done", "reduced", "unreserved", "flat", "unknown",
    },
}


def state_variant(value):
    key = str(value or "").lower()
    for variant, values in STATE_VARIANTS.items():
        if key in values:
            return variant
    return "default"


def state_badge(value):
    if value in (None, ""):
        return "—"
    variant = state_variant(value)
    return format_html(
        '<span class="{} {}">{}</span>', BADGE_BASE, BADGE_COLORS[variant], str(value).replace("_", " ")
    )


def money(amount, currency=None):
    if amount is None:
        return "—"
    text = format(amount, ",.2f")
    if currency:
        return format_html('<span class="tabular-nums whitespace-nowrap" dir="ltr">{} {}</span>', text, currency)
    return format_html('<span class="tabular-nums whitespace-nowrap" dir="ltr">{}</span>', text)


def quantity(value):
    if value is None:
        return "—"
    return format_html('<span class="tabular-nums whitespace-nowrap" dir="ltr">{}</span>', format(value, ",.3f"))


def short_id(value):
    if not value:
        return "—"
    text = str(value)
    return format_html('<span class="font-mono text-xs" title="{}">{}</span>', text, text[:8])


# Curated, privacy-safe defaults for lists that define no explicit native columns.
# Only a fixed allowlist of non-relation status/timestamp columns is ever surfaced;
# private contact/secret fields are never auto-added.
_DEFAULT_STATUS_FIELDS = ("status", "state", "action", "kind", "review_status", "purpose", "result", "phase")
_DEFAULT_TIME_FIELDS = ("created_at", "updated_at")
_DEFAULT_SEARCH_FIELDS = ("reference", "code", "name", "title", "subject", "sku", "external_id")


def _local_field_names(model):
    return {field.name for field in model._meta.fields if not field.is_relation}


def default_list_display(model):
    names = _local_field_names(model)
    columns = ["__str__"]
    columns += [name for name in _DEFAULT_STATUS_FIELDS if name in names]
    columns += [name for name in _DEFAULT_TIME_FIELDS if name in names]
    return columns


def default_search_fields(model):
    names = _local_field_names(model)
    return [name for name in _DEFAULT_SEARCH_FIELDS if name in names]


class AdminDisplayMixin:
    """List-column conventions applied without touching guards or ordering.

    badge_fields: state/kind/action columns rendered as Unfold badges.
    money_fields: {amount field: currency field or None}.
    quantity_fields: exact 3-decimal quantity columns.
    The first column is never wrapped so the change link stays intact.
    """

    badge_fields = ()
    money_fields = {}
    quantity_fields = ()

    def get_list_display(self, request):
        if not self.list_display:
            return default_list_display(self.model)
        fields = list(super().get_list_display(request))
        return [fields[0]] + [self._display_column(name) for name in fields[1:]] if fields else fields

    def get_search_fields(self, request):
        if not self.search_fields:
            return default_search_fields(self.model)
        return super().get_search_fields(request)

    def _display_column(self, name):
        if not isinstance(name, str) or hasattr(self, name):
            return name
        if name in self.badge_fields:
            def render(obj):
                return state_badge(getattr(obj, name, ""))
        elif name in self.money_fields:
            currency_field = self.money_fields[name]
            def render(obj):
                return money(getattr(obj, name, None), getattr(obj, currency_field, None) if currency_field else None)
        elif name in self.quantity_fields:
            def render(obj):
                return quantity(getattr(obj, name, None))
        else:
            return name
        render.admin_order_field = name
        render.short_description = name.replace("_", " ").capitalize()
        return render