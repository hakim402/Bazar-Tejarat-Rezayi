"""The singleton settings editor: page tabs plus sidebar section routes, draft and publish."""
from django import forms
from django.contrib import admin, messages
from django.core.exceptions import PermissionDenied, ValidationError
from django.http import HttpResponseRedirect
from django.shortcuts import redirect
from django.templatetags.static import static
from django.urls import reverse
from django.utils.html import format_html, format_html_join
from django.utils.translation import gettext_lazy as _
from unfold.admin import ModelAdmin
from unfold.decorators import action
from ..forms import SettingsForm, logo_static
from ..forms.settings import LOGO_FIELDS
from ..models import SiteSettings, PageSEO, HeroSlide, LOCALES
from ..sections import SECTIONS, ROUTE_SECTIONS
from ..services import working_draft, draft_initial, save_settings, save_settings_draft
from .helpers import ServiceFormMixin, asset_img, slide_thumbnail, slide_state, submit_pressed, with_initial
from .inlines import SEOInline

# Sections that stay as tabs on the main page; their localized inputs stay with them.
MAIN_SECTIONS = tuple(section for section in SECTIONS if section.key not in ROUTE_SECTIONS)
MAIN_LOCALIZED = tuple(dict.fromkeys(name for section in MAIN_SECTIONS for name in section.localized))


class SiteSettingsAdmin(ServiceFormMixin, ModelAdmin):
    """One native Unfold change form; persistence belongs to the site services."""

    form = SettingsForm
    inlines = [SEOInline]
    actions_submit_line = ["save_draft", "publish"]
    warn_unsaved_form = True

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    def changelist_view(self, request, extra_context=None):
        # The singleton has no list; open its editor directly (same guard as a native list).
        if not self.has_view_or_change_permission(request):
            raise PermissionDenied
        if SiteSettings.objects.filter(pk=1).exists():
            return redirect("admin:site_sitesettings_change", object_id=1)
        self.message_user(request, _("Site settings are not initialized. Run the setup_site command."), messages.ERROR)
        return redirect("admin:index")

    def get_queryset(self, request):
        return super().get_queryset(request).prefetch_related("locales")

    def _route_section(self, request):
        """The sidebar section route being edited, if any."""
        key = request.GET.get("section")
        return next((section for section in SECTIONS if section.key == key), None) if key in ROUTE_SECTIONS else None

    def _section_fieldset(self, section, obj, description):
        fields = list(section.fields)
        if section.key == "hero":
            fields.insert(0, "hero_slides_panel")
        if section.key == "promotions":
            fields.insert(0, "promotion_posts_panel")
        if section.key == "branding" and obj is not None and obj.favicon_id:
            fields.append("favicon_preview")
        if section.key == "seo" and obj is not None and obj.og_image_id:
            fields.append("sharing_preview")
        return (section.title, {"fields": fields, "classes": ("tab",), "description": description})

    def _language_fieldsets(self, localized, logos=False):
        fieldsets = []
        for code, caption in LOCALES:
            fields = [f"{code}_{name}" for name in localized]
            if logos:
                fields = ["logos_" + code.replace("-", "_"), *fields,
                          *(f"{code}_{name}_{part}" for name in LOGO_FIELDS for part in ("file", "clear"))]
            fieldsets.append((caption, {
                "fields": fields,
                "classes": ("tab",),
                "description": _("Start with Dari. Other languages are optional and fall back to Dari when blank.") if code == "fa-AF" else "",
            }))
        return fieldsets

    def _visible_fieldsets(self, request, obj):
        """Only the active view's tabs; hidden carriers are appended separately."""
        draft = working_draft(obj) if obj is not None else None
        note = _("You are editing a saved draft. The public version stays unchanged until you publish.") if draft else _("Save a draft to prepare changes privately, or publish to update the public website.")
        section = self._route_section(request)
        if section is not None:
            # Routed pages lead with their own guidance; a saved draft takes precedence.
            fieldsets = [self._section_fieldset(section, obj, note if draft else section.description)]
            if section.localized:
                fieldsets += self._language_fieldsets(section.localized)
        else:
            fieldsets = [self._section_fieldset(item, obj, note if index == 0 else item.description)
                         for index, item in enumerate(MAIN_SECTIONS)]
            fieldsets[0][1]["fields"].insert(0, "version")
            fieldsets += self._language_fieldsets(MAIN_LOCALIZED, logos=True)
        if draft is not None and draft.uploads.exists():
            fieldsets.append((_("Saved draft images"), {
                "fields": ["draft_uploads_preview"],
                "classes": ("tab",),
                "description": _("These uploads are retained for publication. Upload a replacement to change them."),
            }))
        return fieldsets

    def get_fieldsets(self, request, obj=None):
        fieldsets = self._visible_fieldsets(request, obj)
        # Inputs outside the active view ride along hidden so every save stays lossless.
        visible = {name for _title, opts in fieldsets for name in opts["fields"]}
        carriers = [name for name, field in SettingsForm.base_fields.items()
                    if name not in visible and not isinstance(field, forms.FileField)]
        if carriers:
            title, opts = fieldsets[0]
            fieldsets[0] = (title, {**opts, "fields": [*opts["fields"], *carriers]})
        return fieldsets

    def get_form(self, request, obj=None, **kwargs):
        # version is a non-editable model field carried by a declared hidden input;
        # fields=None lets the factory use Meta.fields instead of rejecting it.
        kwargs["fields"] = None
        base = super().get_form(request, obj, **kwargs)
        publishing = not submit_pressed(request.POST, "save_draft")
        visible = {name for _title, opts in self._visible_fieldsets(request, obj) for name in opts["fields"]}
        carriers = [name for name, field in base.base_fields.items()
                    if name not in visible and not isinstance(field, forms.FileField)]
        # Unfold renders a label column for every row; hide carrier rows with its
        # native conditional display while the hidden inputs still post their values.
        self.conditional_fields = dict.fromkeys(carriers, "false")

        class SettingsChangeForm(base):
            def __init__(self, *args, **kw):
                kw.setdefault("publishing", publishing)
                super().__init__(*args, **kw)
                # Hidden carriers post their current value; booleans round-trip "True"/"False".
                for name in carriers:
                    self.fields[name].widget = forms.HiddenInput()

        if obj is None:
            return SettingsChangeForm
        # Reopen the saved draft (if any) with the current row version.
        return with_initial(SettingsChangeForm, lambda: {"version": obj.version, **draft_initial(obj)})

    def get_inline_instances(self, request, obj=None):
        # Per-page SEO overrides belong to the Search & sharing route only.
        if request.GET.get("section") != "seo":
            return []
        return super().get_inline_instances(request, obj)

    def get_readonly_fields(self, request, obj=None):
        return ["favicon_preview", "sharing_preview", "draft_uploads_preview", "hero_slides_panel", "promotion_posts_panel",
                *("logos_" + code.replace("-", "_") for code, _caption in LOCALES)]

    @admin.display(description=_("Current website icon"))
    def favicon_preview(self, obj):
        return asset_img(obj.favicon_id, "h-16 max-w-full object-contain", _("Current website icon"))

    @admin.display(description=_("Current social preview image"))
    def sharing_preview(self, obj):
        return asset_img(obj.og_image_id, "h-32 max-w-full object-contain", _("Current social preview image"))

    @admin.display(description=_("Saved draft images"))
    def draft_uploads_preview(self, obj):
        draft = working_draft(obj)
        if draft is None:
            return ""
        return format_html_join("", '<figure><img src="{}" alt="" class="h-24 max-w-full object-contain"><figcaption><bdi>{}</bdi></figcaption></figure>', (
            (reverse("site_media", kwargs={"pk": upload.asset_id}), upload.field)
            for upload in draft.uploads.select_related("asset")
        ))

    def save_model(self, request, obj, form, change):
        """Persistence belongs to the service; skip the default row save."""

    def save_related(self, request, form, formsets, change):
        # The pressed submit-line button chooses draft storage or publication.
        seo = next((formset for formset in formsets if formset.model is PageSEO), None)
        if submit_pressed(request.POST, "save_draft"):
            save_settings_draft(request, form, seo)
            self.message_user(request, _("Draft saved. The public website is unchanged."), messages.SUCCESS)
        elif submit_pressed(request.POST, "publish"):
            save_settings(request, form, seo)
            self.message_user(request, _("Published. Changes apply to the next public request."), messages.SUCCESS)
        else:
            raise ValidationError(_("Choose Save draft or Publish."))

    def response_change(self, request, obj):
        url = reverse("admin:site_sitesettings_change", args=[obj.pk])
        section = self._route_section(request)
        if section is not None:
            url += f"?section={section.key}"
        return HttpResponseRedirect(url)

    @action(description=_("Save draft"), attrs={"formnovalidate": True}, icon="draft")
    def save_draft(self, request, obj=None):
        """Submit-line marker; save_related routes the request to the draft service."""

    @action(description=_("Publish"), icon="publish")
    def publish(self, request, obj=None):
        """Submit-line marker; save_related routes the request to the publish service."""


def _posts_panel(placement, panel_title, add_label, empty_label):
    """Embedded library for one placement: Add/Edit in place, full library one click away."""
    @admin.display(description=panel_title)
    def panel(self, obj):
        slides = (HeroSlide.objects.filter(placement=placement, draft_of__isnull=True)
                  .select_related("image", "poster", "pending_draft"))
        add_url = reverse("admin:site_heroslide_add") + f"?placement={placement}"
        library_url = reverse("admin:site_heroslide_changelist") + f"?placement={placement}"
        # One compact row per public post: preview, name, status and a direct edit link.
        rows = format_html_join(
            "",
            '<div class="flex items-center gap-3 p-2.5">'
            '<div class="shrink-0">{}</div>'
            '<div class="grow min-w-0"><div class="font-medium text-sm truncate"><bdi>{}</bdi></div>'
            '<div class="text-xs text-base-500 dark:text-base-400">{}</div></div>'
            '<div class="shrink-0">{}</div>'
            '<a href="{}" class="shrink-0 text-sm font-medium text-primary-600 hover:underline dark:text-primary-400">{}</a>'
            '</div>',
            ((slide_thumbnail(s), s.label, s.get_kind_display(), slide_state(s),
              reverse("admin:site_heroslide_change", args=[s.pk]), _("Edit")) for s in slides),
        )
        body = rows or format_html('<div class="p-4 text-sm text-base-500 dark:text-base-400 text-center">{}</div>', empty_label)
        return format_html(
            '<div class="flex flex-col gap-3">'
            '<div class="flex items-center justify-between gap-3 flex-wrap">'
            '<a href="{}" class="font-medium inline-flex items-center gap-1 rounded-default justify-center whitespace-nowrap cursor-pointer px-3 py-2 border border-transparent bg-primary-600 text-white hover:bg-primary-600/80">'
            '<span class="material-symbols-outlined text-[18px]">add</span>{}</a>'
            '<a href="{}" class="text-sm font-medium text-primary-600 hover:underline dark:text-primary-400">{}</a>'
            '</div>'
            '<div class="border border-base-200 rounded-default divide-y divide-base-200 dark:border-base-800 dark:divide-base-800 overflow-hidden">{}</div>'
            '</div>',
            add_url, add_label, library_url, _("Open full library"), body,
        )
    return panel


SiteSettingsAdmin.hero_slides_panel = _posts_panel("main", _("Homepage slides"), _("Add slide"), _("No homepage slides yet. Add the first one."))
SiteSettingsAdmin.promotion_posts_panel = _posts_panel("promotion", _("Post library"), _("Add post"), _("No promotional posts yet. Add the first one."))


def _logo_preview(code):
    """Readonly pair of current logos for one language, with bundled fallbacks."""
    @admin.display(description=_("Logos by language"))
    def preview(self, obj):
        row = next((row for row in obj.locales.all() if row.locale == code), None)

        def source(asset_id, tone):
            return reverse("site_media", kwargs={"pk": asset_id}) if asset_id else static(logo_static(code, tone))

        return format_html(
            '<div class="flex flex-wrap gap-4">'
            '<div class="bg-white border border-base-200 p-3 rounded-default"><img src="{}" alt="{}" class="h-12 max-w-48 object-contain"></div>'
            '<div class="bg-base-900 p-3 rounded-default"><img src="{}" alt="{}" class="h-12 max-w-48 object-contain"></div>'
            '</div>',
            source(row.logo_light_id if row else None, "light"), _("Current logo for light backgrounds"),
            source(row.logo_dark_id if row else None, "dark"), _("Current logo for dark backgrounds"),
        )
    return preview


# One readonly logo preview per language, referenced by name in the fieldsets.
for _code, _caption in LOCALES:
    setattr(SiteSettingsAdmin, "logos_" + _code.replace("-", "_"), _logo_preview(_code))