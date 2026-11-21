"""Readable presentation of retained seller snapshots."""

from django.utils.translation import get_language, gettext as _
from django.utils.html import format_html, format_html_join
from .helpers import panel_table, panel_note
from apps.accounts.admin.display import quantity

LANGUAGES = {"fa-AF": "Dari", "en": "English", "ps": "Pashto", "ar": "Arabic"}


def language_name(code):
    return _(LANGUAGES.get(code, code or "Unknown"))


def localized(labels, fallback="—"):
    if not isinstance(labels, dict):
        return fallback
    locale = "fa-AF" if get_language() == "fa-af" else "en"
    return labels.get(locale) or labels.get("en") or labels.get("fa-AF") or fallback


def readable(value):
    if isinstance(value, dict):
        return ", ".join(f"{key.replace('_', ' ')}: {readable(item)}" for key, item in value.items())
    if isinstance(value, list):
        return ", ".join(readable(item) for item in value)
    if isinstance(value, bool):
        return _("Yes") if value else _("No")
    return str(value) if value not in (None, "") else "—"


def attributes(values, schema, labels=None):
    definitions = {item.get("code"): item for item in schema if isinstance(item, dict)}
    rows = []
    for code, value in (values or {}).items():
        definition = definitions.get(code, {})
        title = localized((labels or {}).get(code) or definition.get("labels"), code.replace("_", " ").capitalize())
        rows.append([title, readable(value)])
    return rows


def revision_summary(revision):
    body = revision.body
    rows = [
        [_("Product title"), body.get("title") or "—"],
        [_("Description"), format_html('<span class="whitespace-pre-wrap break-words">{}</span>', body.get("description") or "—")],
        [_("Category"), localized(body.get("category_labels"), revision.category_id)],
        [_("Source language"), language_name(body.get("locale"))],
        [_("Brand"), body.get("brand") or "—"],
    ]
    rows.extend(attributes(body.get("attributes"), body.get("attribute_schema", []), body.get("attribute_labels")))
    content = [panel_table([_("Product detail"), _("Value")], rows, "")]
    variants = body.get("variants", [])
    if variants:
        variant_rows = []
        for row in variants:
            options = attributes(row.get("attributes"), body.get("attribute_schema", []), row.get("attribute_labels"))
            variant_rows.append([
                row.get("sku") or _("Unnamed variant"),
                localized(row.get("unit_labels"), row.get("unit", "—")),
                quantity(row.get("increment")),
                quantity(row.get("minimum")),
                quantity(row.get("contents")),
                ", ".join(f"{key}: {value}" for key, value in options) or "—",
                _("Available in this revision") if row.get("active") else _("Hidden in this revision"),
            ])
        content.append(panel_table(
            [_("SKU"), _("Sale unit"), _("Quantity step"), _("Wholesale minimum"), _("Pack contents"), _("Options"), _("Availability")],
            variant_rows, "",
        ))
    else:
        content.append(panel_note(_("This revision has no variants.")))
    images = body.get("images") or []
    if images:
        sku_by_id = {str(row.get("id")): row.get("sku") for row in variants}
        content.append(panel_table(
            [_("Image description"), _("Applies to")],
            [[image.get("alt") or _("No description"), sku_by_id.get(str(image.get("variant")), _("Whole product"))]
             for image in images], "",
        ))
    return format_html_join("", '<div class="mb-3">{}</div>', [(section,) for section in content])
