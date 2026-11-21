"""Categories and sale units: native Unfold CRUD routed through the locked taxonomy services.

Identities stay permanent, versions are checked on every save, and the four
marketplace names are required. Owner and taxonomy staff create/edit/deactivate;
everyone else reads. No custom templates — the native change form renders it all.
"""

from django import forms
from django.contrib import admin, messages
from django.contrib.admin.utils import unquote
from django.core.exceptions import PermissionDenied, ValidationError
from django.db import DatabaseError
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.utils.html import format_html, format_html_join
from django.utils.translation import get_language, gettext_lazy as _
from rest_framework.exceptions import APIException
from unfold.decorators import action

from apps.accounts.admin import owner_site
from apps.accounts.admin.access import admin_actor, is_owner, permits
from apps.accounts.admin.display import state_badge
from apps.organizations.admin import ReadOnlyAdmin
from apps.site.media import store_upload, discard_created, schedule_media_cleanup
from .. import access, contracts, taxonomy
from ..models import Category, SaleUnit, LOCALES
from ..owner_copy import localize
from .helpers import DeleteRecordForm, changeform_context, chrome_locale, operation_form
from .presentation import identity
from .summaries import localized
from apps.accounts.admin.theme import CATALOGUE_THEME

LABEL_FIELDS = {"fa-AF": "label_fa_af", "en": "label_en", "ps": "label_ps", "ar": "label_ar"}

# Curated glyphs shared with the storefront's native icon set (components/ui/icon.tsx).
# Keeping the same paths means one named icon renders identically in admin and public.
CATEGORY_ICONS = {
    "grid": "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
    "leaf": "M20 3C7 2 2 7 5 15c8 4 15-2 15-12Z M4 21 15 9",
    "dress": "m8 3 4 2 4-2 3 5-4 3 5 10H4l5-10-4-3Z",
    "beauty": "M8 10h8v11H8Z M10 10V4l4-2v8 M8 16h8",
    "chair": "M6 11V7a6 6 0 0 1 12 0v4 M4 11h3v6h10v-6h3v8H4Z M6 19v3 M18 19v3",
    "home": "m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-6v-7h-4v7H4a1 1 0 0 1-1-1Z",
    "phone": "M7 3h10v18H7Z M11 18h2",
    "sparkle": "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z",
    "store": "M3 10h18l-2-7H5l-2 7v3a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0v-3 M5 16v5h14v-5 M10 21v-5h4v5",
    "team": "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M18 8a3 3 0 0 1 0 6 M22 21v-2a4 4 0 0 0-3-4",
    "file": "M14 2H5v20h14V7Z M14 2v6h5 M8 12h8 M8 16h8",
    "box": "m12 3 9 5v9l-9 5-9-5V8Z M3 8l9 5 9-5 M12 13v9 m-5-17 10 6",
    "shopping-bag": "M5 7h14l2 14H3Z M8 9V6a4 4 0 0 1 8 0v3",
    "globe": "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M3 12h18 M12 3c5 5 5 13 0 18-5-5-5-13 0-18",
    "star": "m12 2 3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7Z",
    "crown": "m3 6 4.5 4L12 4l4.5 6L21 6l-2 12H5Z M5 21h14",
    "award": "M18 8a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z M15.5 12.5 17 22l-5-3-5 3 1.5-9.5",
    "truck": "M2 4h12v13H2Z M14 8h4l4 5v4h-8 M14 13h8 M8 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0 M20 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0",
    "warehouse": "M3 21V8l9-5 9 5v13 M3 21h18 M7 21V11h10v10 M7 15h10 M7 18h10",
    "monitor": "M2 4h20v12H2Z M8 20h8 M12 16v4",
    "gear": "m10 2-.7 3-2 .9-2.7-.9-2 3.5 2 2v3l-2 2 2 3.5 2.7-.9 2 .9.7 3h4l.7-3 2-.9 2.7.9 2-3.5-2-2v-3l2-2-2-3.5-2.7.9-2-.9-.7-3Z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
    "heart": "M20 5a5 5 0 0 0-8 1 5 5 0 0 0-8-1c-4 5 3 10 8 15 5-5 12-10 8-15Z",
    "cart": "M2 3h3l3 13h11l3-9H6 M10 21h.01 M18 21h.01",
    "headset": "M3 11a9 9 0 0 1 18 0 M3 11h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5Z M21 11h-3a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-5Z M21 16v2a4 4 0 0 1-4 4h-5",
}
CATEGORY_ICON_CHOICES = [("", _("No icon"))] + [(name, name.replace("-", " ").title()) for name in CATEGORY_ICONS]


def category_icon(name, css="", size=20):
    """Render a named glyph as inline SVG, matching the storefront Icon component."""
    path = CATEGORY_ICONS.get(name)
    if not path:
        return "—"
    # Size inline: Unfold's compiled CSS omits the size-* utilities, which would
    # otherwise let the SVG fall back to its large default replaced-element size.
    return format_html(
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" '
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="{}" '
        'style="width:{}px;height:{}px;flex:none"><path d="{}"/></svg>',
        css, size, size, path,
    )


def category_cover(image_id, css="", alt="", height=64):
    """A stored category cover streamed through the shared site media endpoint."""
    # Constrain inline: the h-* / object-contain utilities are absent from Unfold's CSS.
    return format_html(
        '<img src="{}" alt="{}" class="{}" loading="lazy" '
        'style="height:{}px;width:auto;max-width:100%;object-fit:contain">',
        reverse("site_media", kwargs={"pk": image_id}), alt, css, height,
    )


# One glyph tile: a hidden radio drives the checked/focus styling on its sibling
# span via category-picker.css (Unfold's CSS lacks the peer-checked utilities).
ICON_TILE_CLASSES = (
    "cat-icon-tile flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-default border "
    "border-base-200 bg-white p-3 text-center text-base-600 transition-colors hover:border-base-300 "
    "hover:bg-base-50 dark:border-base-700 dark:bg-base-900 dark:text-base-300"
)
ICON_NONE_GLYPH = (
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" '
    'aria-hidden="true" class="text-base-400 dark:text-base-500" style="width:24px;height:24px;flex:none">'
    '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/></svg>'
)


class IconChoiceWidget(forms.RadioSelect):
    """A radio grid of glyph tiles so the icon is chosen visually, not by name."""

    class Media:
        css = {"all": ("catalogue/admin/category-picker.css",)}

    def render(self, name, value, attrs=None, renderer=None):
        selected = "" if value is None else str(value)
        tiles = []
        for code, label in self.choices:
            # The shared glyph recolors with the tile; "No icon" gets a muted slashed circle.
            glyph = category_icon(code, "", size=24) if code else format_html(ICON_NONE_GLYPH)
            tiles.append(format_html(
                '<label class="cursor-pointer">'
                '<input type="radio" name="{}" value="{}" class="cat-icon-input sr-only"{}>'
                '<span class="{}">{}<span class="text-xs font-medium">{}</span></span>'
                '</label>',
                name, code, " checked" if str(code) == selected else "", ICON_TILE_CLASSES, glyph, label,
            ))
        return format_html(
            '<div class="cat-icon-grid" id="{}">{}</div>',
            (attrs or {}).get("id", name), format_html_join("", "{}", ((tile,) for tile in tiles)),
        )


class TaxonomyBaseForm(forms.Form):
    version = forms.IntegerField(min_value=0, widget=forms.HiddenInput)
    code = forms.SlugField(
        max_length=40,
        help_text=_("Permanent identity: lowercase letters, digits and hyphens. It cannot change after creation."),
    )
    label_fa_af = forms.CharField(max_length=100, widget=forms.TextInput(attrs={"dir": "rtl"}), help_text=_("Required Dari display name (default marketplace language)."))
    label_en = forms.CharField(max_length=100, widget=forms.TextInput(attrs={"dir": "ltr"}), help_text=_("Required English display name."))
    label_ps = forms.CharField(max_length=100, widget=forms.TextInput(attrs={"dir": "rtl"}), help_text=_("Required Pashto display name."))
    label_ar = forms.CharField(max_length=100, widget=forms.TextInput(attrs={"dir": "rtl"}), help_text=_("Required Arabic display name."))
    active = forms.BooleanField(required=False, initial=True, help_text=_("Inactive entries stay retained but are not offered to new products."))

    def initial_from_row(self, row):
        initial = {"version": row["version"], "code": row["code"], "active": row["active"]}
        initial.update({field: row["labels"].get(locale, "") for locale, field in LABEL_FIELDS.items()})
        return initial

    def labels_payload(self):
        return {locale: self.cleaned_data[field] for locale, field in LABEL_FIELDS.items()}


class CategoryForm(TaxonomyBaseForm):
    parent = forms.ChoiceField(required=False, choices=(), help_text=_("Optional parent category. Hierarchy is bounded to four levels and cycles are refused."))
    units = forms.MultipleChoiceField(
        choices=(),
        help_text=_("Select 1 to 9 active sale units offered for products in this category."),
    )
    attributes = forms.JSONField(required=False, widget=forms.Textarea(attrs={"rows": 4, "dir": "ltr"}), help_text=_("Optional advanced attribute definitions as a JSON list. Leave [] unless this category needs extra variant attributes."))
    icon = forms.ChoiceField(required=False, choices=CATEGORY_ICON_CHOICES, widget=IconChoiceWidget(choices=CATEGORY_ICON_CHOICES), help_text=_("Optional named glyph shown beside the category on the storefront."))
    image_file = forms.FileField(required=False, help_text=_("Optional cover image (JPEG, PNG or WebP), stored in the shared site media library."))
    image_clear = forms.BooleanField(required=False, help_text=_("Remove the current cover image."))

    def clean_units(self):
        units = self.cleaned_data["units"]
        if len(units) > 9:
            raise forms.ValidationError(_("Select at most 9 sale units."))
        return units

    def clean_attributes(self):
        value = self.cleaned_data.get("attributes")
        if value is None:
            return []
        if not isinstance(value, list):
            raise forms.ValidationError(_("Attributes must be a JSON list, for example []."))
        return value

    def payload(self, image_id=None):
        return {
            "version": self.cleaned_data["version"],
            "code": self.cleaned_data["code"],
            "labels": self.labels_payload(),
            "parent": self.cleaned_data.get("parent") or None,
            "attributes": self.cleaned_data["attributes"],
            "units": self.cleaned_data["units"],
            "active": self.cleaned_data["active"],
            "icon": self.cleaned_data.get("icon", ""),
            "image": image_id,
        }


class UnitForm(TaxonomyBaseForm):
    code = forms.SlugField(max_length=16, help_text=_("Permanent identity: lowercase letters, digits and hyphens, at most 16 characters."))
    fractional = forms.BooleanField(required=False, help_text=_("Allow fractional quantities such as 0.25 kg; whole-count units stay unchecked."))

    def payload(self):
        return {
            "version": self.cleaned_data["version"],
            "code": self.cleaned_data["code"],
            "labels": self.labels_payload(),
            "fractional": self.cleaned_data["fractional"],
            "active": self.cleaned_data["active"],
        }


def taxonomy_error(form, error, generic):
    """Map a service's field-level refusal onto the bound form so input is retained."""
    detail = getattr(error, "detail", {})
    mapped = False
    if isinstance(detail, dict):
        for key, messages in detail.items():
            target = key if key in form.fields else None
            if key == "labels":
                target = None
            form.add_error(target, messages if isinstance(messages, list) else [str(messages)])
            mapped = True
    if not mapped:
        form.add_error(None, generic)


class TaxonomyAdmin(ReadOnlyAdmin):
    """Native routes drive the guarded taxonomy workflows."""

    list_filter = ["active"]
    ordering = ["code"]
    actions = None

    def staff_view(self, request, obj=None):
        return permits(request, "catalogue", "manage_taxonomy")

    def staff_change(self, request, obj=None):
        # GuardedAdminMixin routes staff change permission through this hook.
        return permits(request, "catalogue", "manage_taxonomy")

    def _may_edit(self, request):
        return is_owner(request) or permits(request, "catalogue", "manage_taxonomy")

    def has_add_permission(self, request):
        return self._may_edit(request)

    def has_change_permission(self, request, obj=None):
        return self._may_edit(request)

    def has_delete_permission(self, request, obj=None):
        return is_owner(request)

    def delete_view(self, request, object_id, extra_context=None):
        if not self.has_delete_permission(request):
            raise PermissionDenied
        original = get_object_or_404(self.get_queryset(request), pk=unquote(object_id))
        form = DeleteRecordForm(request.POST if request.method == "POST" else None, initial={"version": original.version})
        if request.method == "POST" and form.is_valid():
            try:
                taxonomy.delete_taxonomy(admin_actor(request), self.model, original.pk, form.cleaned_data["version"])
            except APIException as error:
                form.add_error(None, _(
                    "This record is in use. Deactivate it to keep existing catalogue references."
                ) if error.status_code == 400 else _("The record changed. Reload and try again."))
            else:
                messages.success(request, _("Record deleted."))
                return redirect(f"admin:catalogue_{self.model._meta.model_name}_changelist")
        return operation_form(
            request, self, form, [(_("Confirm deletion"), {"fields": ["version", "confirm"]})],
            _("Delete taxonomy record"), original=original, submit=_("Delete"),
        )

    def changeform_view(self, request, object_id=None, form_url="", extra_context=None):
        # The native add/change views delegate to the guarded plain-form workflow.
        return self.workflow(request, unquote(object_id) if object_id is not None else None)

    @admin.display(description=_("Active"))
    def active_state(self, obj):
        return state_badge("active" if obj.active else "disabled")

    @admin.display(description=_("Name"))
    def label(self, obj):
        locale = "fa-AF" if get_language() == "fa-af" else "en"
        return obj.labels.get(locale) or obj.labels.get("en") or obj.code

    @action(description=_("Save guarded changes"), icon="save")
    def save(self, request, obj=None):
        """Submit-line marker; the workflow POST handler routes to the taxonomy service."""


class CategoryAdmin(TaxonomyAdmin):
    list_display = ["category_identity", "parent_name", "sale_units", "attribute_count", "active_state"]
    list_select_related = ["parent"]
    search_fields = ["code", "labels__en", "labels__fa-AF", "labels__ps", "labels__ar"]

    def get_queryset(self, request):
        return super().get_queryset(request).select_related("parent").prefetch_related("units")

    @admin.display(description=_("Category"), ordering="code")
    def category_identity(self, obj):
        cover = reverse("site_media", args=[obj.image_id]) if obj.image_id else None
        return identity(localized(obj.labels, _("Unnamed category")), "", cover, "category",
                        icon=category_icon(obj.icon) if obj.icon else "")

    @admin.display(description=_("Parent category"), ordering="parent")
    def parent_name(self, obj):
        return localized(obj.parent.labels, obj.parent_id) if obj.parent_id else _("Top level")

    @admin.display(description=_("Sale units"))
    def sale_units(self, obj):
        return format_html('<div class="{}">{}</div>', CATALOGUE_THEME["badges"], format_html_join(
            "", "{}", ((state_badge(localized(unit.labels, unit.code)),) for unit in obj.units.all()),
        ))

    @admin.display(description=_("Attributes"))
    def attribute_count(self, obj):
        return len(obj.attributes)

    def get_readonly_fields(self, request, obj=None):
        # Guard assertion for the disabled native model form; staff never edit units here.
        return [*super().get_readonly_fields(request, obj), "units"]

    @admin.display(description=_("Icon"))
    def icon_glyph(self, obj):
        return category_icon(obj.icon, "text-primary-600 dark:text-primary-300", size=20)

    @admin.display(description=_("Cover"))
    def cover_thumb(self, obj):
        return category_cover(obj.image_id, "rounded-default", _("Category cover"), height=40) if obj.image_id else "—"

    def workflow(self, request, code):
        locale = chrome_locale(request)
        actor = admin_actor(request)
        access.staff(actor, "manage_taxonomy")
        original = get_object_or_404(Category, pk=code) if code is not None else None
        row = next((r for r in taxonomy.taxonomy()["categories"] if r["code"] == code), None)
        if code is None:
            row = {"version": 0, "code": "", "labels": {loc: "" for loc in LOCALES},
                   "parent": None, "attributes": [], "units": [], "active": True, "icon": ""}
        form = CategoryForm(request.POST if request.method == "POST" else None, request.FILES or None)
        form.initial = form.initial_from_row(row)
        form.initial.update({"parent": row["parent"] or "", "units": row["units"], "attributes": row["attributes"], "icon": row.get("icon", "")})
        form.fields["parent"].choices = [("", _("No parent (top level)"))] + [
            (c.code, f"{c.code} — {c.labels.get('en') or c.labels.get('fa-AF') or ''}")
            for c in Category.objects.order_by("code") if c.code != code
        ]
        # Offer active sale units as checkboxes; keep an already-assigned unit visible
        # even if it was later deactivated, so saving never silently drops it.
        unit_rows = {u.code: u for u in SaleUnit.objects.order_by("code")}
        offered = [u for u in unit_rows.values() if u.active]
        offered += [unit_rows[c] for c in row["units"] if c in unit_rows and not unit_rows[c].active]
        form.fields["units"].choices = [
            (u.code, f"{u.code} — {u.labels.get('en') or u.labels.get('fa-AF') or u.code}")
            for u in sorted(offered, key=lambda u: u.code)
        ]
        if code is not None:
            form.fields["code"].disabled = True
        t = localize(form, locale)
        if request.method == "POST" and form.is_valid():
            created = []
            previous_image = original.image_id if original else None
            image_id = previous_image
            try:
                # Resolve the cover: clear, replace via the shared library, or retain.
                if form.cleaned_data.get("image_clear"):
                    image_id = None
                elif form.cleaned_data.get("image_file"):
                    image_id = store_upload(form.cleaned_data["image_file"], "image", created).pk
                contract = contracts.CatalogueTaxonomyInput(data=form.payload(image_id))
                contract.is_valid(raise_exception=True)
                if code is None and contract.validated_data["version"] != 0 or code is not None and contract.validated_data["code"] != code:
                    form.add_error("code", _("The code is permanent and cannot change after creation."))
                else:
                    taxonomy.save_category(actor, contract.validated_data)
                    if previous_image and previous_image != image_id:
                        schedule_media_cleanup([previous_image])
                    return redirect("admin:catalogue_category_change", object_id=contract.validated_data["code"])
            except ValidationError as error:
                discard_created(created)
                form.add_error("image_file", " ".join(error.messages))
            except (OSError, DatabaseError):
                discard_created(created)
                form.add_error("image_file", _("The cover image could not be stored. Re-select the file and save again."))
            except APIException as error:
                discard_created(created)
                taxonomy_error(form, error, t["error"])
        fieldsets = [
            (_("Identity"), {"fields": ["version", "code"], "description": _("The code is a permanent identity referenced by products; it cannot change after creation.")}),
            (_("Names in all four languages"), {"fields": ["label_fa_af", "label_en", "label_ps", "label_ar"]}),
            (_("Structure and availability"), {"fields": ["parent", "units", "active"]}),
            (_("Storefront presentation"), {"fields": ["icon", "image_file", "image_clear"], "description": _("An optional named glyph and cover image shown on public category cards.")}),
            (_("Advanced attributes (optional)"), {"fields": ["attributes"], "classes": ("collapse",)}),
        ]
        # Readonly preview of what is currently stored, rendered outside the POST form.
        datasets = []
        if original:
            datasets.append(format_html(
                '<div class="rounded-default border border-base-200 bg-white p-4 dark:border-base-800 dark:bg-base-900">'
                '<h2 class="mb-2 text-base font-semibold">{}</h2><div class="flex flex-wrap items-center gap-4">{}{}</div></div>',
                _("Category overview"), self.category_identity(original), self.sale_units(original),
            ))
        context = changeform_context(
            request, self, form, fieldsets,
            original=original, title=t["payload"],
            actions=[self.get_unfold_action("save")], datasets=datasets,
            extra={"selection": None, "editing": code is not None, "kind": "category",
                   "show_delete_link": bool(original and self.has_delete_permission(request, original))},
        )
        return render(request, "admin/change_form.html", context)


class UnitAdmin(TaxonomyAdmin):
    list_display = ["label", "code", "fractional", "active_state", "version"]
    search_fields = ["code", "labels__en", "labels__fa-AF", "labels__ps", "labels__ar"]

    def workflow(self, request, code):
        actor = admin_actor(request)
        access.staff(actor, "manage_taxonomy")
        locale = chrome_locale(request)
        original = get_object_or_404(SaleUnit, pk=code) if code is not None else None
        row = next((r for r in taxonomy.taxonomy()["units"] if r["code"] == code), None)
        if code is None:
            row = {"version": 0, "code": "", "labels": {loc: "" for loc in LOCALES},
                   "fractional": False, "active": True}
        form = UnitForm(request.POST if request.method == "POST" else None)
        form.initial = form.initial_from_row(row)
        form.initial["fractional"] = row["fractional"]
        if code is not None:
            form.fields["code"].disabled = True
        t = localize(form, locale)
        if request.method == "POST" and form.is_valid():
            try:
                contract = contracts.CatalogueUnitInput(data=form.payload())
                contract.is_valid(raise_exception=True)
                if code is None and contract.validated_data["version"] != 0 or code is not None and contract.validated_data["code"] != code:
                    form.add_error("code", _("The code is permanent and cannot change after creation."))
                else:
                    taxonomy.save_unit(actor, contract.validated_data)
                    return redirect("admin:catalogue_saleunit_change", object_id=contract.validated_data["code"])
            except APIException as error:
                taxonomy_error(form, error, t["error"])
        fieldsets = [
            (_("Identity"), {"fields": ["version", "code"], "description": _("The code is a permanent identity referenced by variants; it cannot change after creation.")}),
            (_("Names in all four languages"), {"fields": ["label_fa_af", "label_en", "label_ps", "label_ar"]}),
            (_("Structure and availability"), {"fields": ["fractional", "active"]}),
        ]
        context = changeform_context(
            request, self, form, fieldsets,
            original=original, title=t["unit"],
            actions=[self.get_unfold_action("save")],
            extra={"selection": None, "editing": code is not None, "kind": "unit",
                   "show_delete_link": bool(original and self.has_delete_permission(request, original))},
        )
        return render(request, "admin/change_form.html", context)


owner_site.register(Category, CategoryAdmin)
owner_site.register(SaleUnit, UnitAdmin)
