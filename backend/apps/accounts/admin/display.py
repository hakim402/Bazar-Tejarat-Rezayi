"""Shared admin presentation helpers: status badges, exact money, grouped fieldsets.

Display-only: no permission, guard or business behavior changes. The badge palette
lives in ``admin_theme`` (single source of truth) and is re-exported here so existing
``from apps.accounts.admin.display import BADGE_*`` callers keep working. Badge classes
reuse Unfold's compiled palette, so no extra CSS build is required.
"""

from django.contrib.admin.utils import label_for_field
from django.template.defaultfilters import truncatechars
from django.utils.html import format_html
from django.utils.translation import gettext as _

from .theme import BADGE_BASE, BADGE_COLORS, IDENTITY_THEME, STATE_VARIANTS

__all__ = [
    "BADGE_BASE", "BADGE_COLORS", "STATE_VARIANTS", "state_variant", "state_badge",
    "money", "quantity", "short_id", "record_identity", "default_list_display",
    "default_search_fields", "AdminDisplayMixin",
]


def state_variant(value):
    key = str(value or "").lower()
    for variant, values in STATE_VARIANTS.items():
        if key in values:
            return variant
    return "default"


def state_badge(value, label=None, tone=None):
    """Badge for one state. ``tone`` overrides the shared palette for a context
    whose own states must not read like the generic ones."""
    if value in (None, ""):
        return "—"
    variant = tone if tone in BADGE_COLORS else state_variant(value)
    text = label if label is not None else _(str(value)).replace("_", " ")
    return format_html('<span class="{} {}">{}</span>', BADGE_BASE, BADGE_COLORS[variant], text)


def money(amount, currency=None):
    if amount is None:
        return "—"
    text = format(amount, ",.2f").rstrip("0").rstrip(".")
    if currency:
        return format_html('<span class="tabular-nums whitespace-nowrap" dir="ltr">{} {}</span>', text, currency)
    return format_html('<span class="tabular-nums whitespace-nowrap" dir="ltr">{}</span>', text)


def quantity(value):
    if value is None:
        return "—"
    from decimal import Decimal, InvalidOperation

    try:
        text = format(Decimal(str(value)), ",f")
        text = text.rstrip("0").rstrip(".") if "." in text else text
    except (InvalidOperation, ValueError):
        text = str(value)
    return format_html('<span class="tabular-nums whitespace-nowrap" dir="ltr">{}</span>', text)


def short_id(value):
    if not value:
        return "—"
    text = str(value)
    return format_html('<span class="text-xs" title="{}">{}</span>', text, text[:8])


def record_identity(name, secondary="", glyph="description", icon="", owner="", picture=None):
    """Readable identity for a stored record: a name with its supporting detail.

    Both lines are truncated for the listing and keep the full value in the
    title attribute, so a technical record never appears as a bare identifier.
    """
    tile = picture or format_html('<span class="material-symbols-outlined" aria-hidden="true">{}</span>', glyph)
    return format_html(
        '<div class="{identity}">{tile}{icon}<div class="{text}">'
        '<bdi class="{name}" title="{name_title}">{name_text}</bdi>'
        '<bdi class="{meta}" title="{meta_title}">{meta_text}</bdi>{owner}</div></div>',
        identity=IDENTITY_THEME["identity"], tile=tile, icon=icon, text=IDENTITY_THEME["text"],
        name=IDENTITY_THEME["name"], name_title=name, name_text=truncatechars(name, 36),
        meta=IDENTITY_THEME["meta"], meta_title=secondary, meta_text=truncatechars(secondary, 42),
        owner=format_html('<bdi class="{}" title="{}">{}</bdi>', IDENTITY_THEME["meta"], owner, truncatechars(owner, 36)) if owner else "",
    )


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
    quantity_fields: quantities with insignificant trailing zeros removed.
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
        render.short_description = label_for_field(name, self.model, model_admin=self)
        return render
