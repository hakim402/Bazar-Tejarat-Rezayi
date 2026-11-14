"""The fixed settings form: every section field plus per-language content and logos."""
import re
from types import SimpleNamespace
from django import forms
from django.utils.translation import gettext_lazy as _
from unfold.widgets import UnfoldAdminFileFieldWidget, UnfoldBooleanWidget
from ..models import SiteSettings, SiteLocale, HeroSlide, LOCALES
from ..validation import destination, settings_content
from .base import StyledForm, SITE_TEXT, declare_fields, localized_declarations

LOGO_FIELDS = ["logo_light", "logo_dark"]


def language_fields(code):
    """Field names on one language tab, shared by the form and the admin tabs."""
    return [f"{code}_{name}" for name in SITE_TEXT] + [f"{code}_{name}_{part}" for name in LOGO_FIELDS for part in ("file", "clear")]


class SettingsForm(StyledForm):
    version = forms.IntegerField(widget=forms.HiddenInput)
    favicon_file = forms.FileField(label=_("Favicon image (PNG, JPEG or WebP)"), required=False)
    og_file = forms.FileField(label=_("Default social image"), required=False)

    class Meta:
        model = SiteSettings
        # Derived from the model; protected FKs are replaced by uploads in the service.
        fields = [field.name for field in SiteSettings._meta.fields if field.name not in {"id", "version", "favicon", "og_image"}]

    def __init__(self, *args, publishing=True, **kwargs):
        self.publishing = publishing
        super().__init__(*args, **kwargs)
        self.initial["version"] = self.instance.version
        rows = {row.locale: row for row in self.instance.locales.all()}
        self.locale_fields(SiteLocale, SITE_TEXT, rows)
        self.fields["fa-AF_name"].required = True
        self.fields["fa-AF_title_template"].required = True
        # Logo replacement and restore controls belong to each language tab.
        for tab in self.language_tabs:
            tab["fields"] = language_fields(tab["code"])
        labels = {
            "default_locale": _("Default website language"), "default_theme": _("Default appearance"),
            "email": _("Support email"), "phone": _("Support phone"), "website": _("Website address"),
            "favicon_file": _("Website icon"), "og_file": _("Default social preview image"),
            "hero_mode": _("Homepage layout"), "hero_interval": _("Seconds between slides"),
            "announcement_enabled": _("Show announcement"), "announcement_url": _("Link destination (optional)"),
            "maintenance_enabled": _("Turn on maintenance mode"),
        }
        help_text = {
            "default_locale": _("Used when a visitor has not chosen a language. Existing language links keep working."),
            "default_theme": _("Visitors can still choose their own light or dark appearance."),
            "phone": _("Include the country code, for example +93 followed by the number."),
            "favicon_file": _("Small browser-tab icon. PNG, JPEG or WebP; up to 8 MiB."),
            "og_file": _("Used when a page is shared without its own image. PNG, JPEG or WebP; up to 8 MiB."),
            "announcement_url": _("Use an existing path such as /about, or a public HTTPS address. Leave blank for a message without a link."),
            "hero_mode": _("Only matching published slides appear. With no matching slides, the default hero is shown."),
            "hero_interval": _("5–60 seconds. Used only when automatic rotation is on."),
        }
        for name, label in [("promotion_one", "First promotional card"), ("promotion_two", "Second promotional card")]:
            self.fields[name].queryset = HeroSlide.objects.filter(settings=self.instance, placement="promotion", draft_of__isnull=True, is_draft=False, enabled=True)
            self.fields[name].label = _(label)
            self.fields[name].empty_label = _("Do not display a card")
            self.fields[name].help_text = _("Choose a published image or video post. Each post can be selected only once.")
        for name, field in self.fields.items():
            field.label = labels.get(name, field.label)
            field.help_text = help_text.get(name, field.help_text)
            if isinstance(field, forms.FileField):
                field.widget.attrs["accept"] = "image/png,image/jpeg,image/webp"
            for key, label in {
                "title_template": _("Page title format"), "description": _("Default search description"),
                "name": _("Website name"), "tagline": _("Short tagline"), "hours": _("Opening hours"),
                "announcement": _("Message"), "announcement_label": _("Link text (optional)"),
                "maintenance_title": _("Message heading"), "maintenance_message": _("Message body"),
            }.items():
                if any(name == f"{code}_{key}" for code, _caption in LOCALES):
                    field.label = label
            if name.endswith("_title_template"):
                field.help_text = _("Use {page} for the page title and {site} for the website name. Example: {page} | {site}.")

    def clean(self):
        data = super().clean()
        # Optimistic concurrency: reject input prepared against an older row.
        current = SiteSettings.objects.filter(pk=1).values_list("version", flat=True).first()
        if current is not None and data.get("version") != current:
            self.add_error(None, _("Settings changed in another session. Your input is retained. Reload and compare before saving again."))
        for name in ["website", "facebook", "instagram", "linkedin", "youtube", "announcement_url"]:
            try:
                destination(data.get(name, ""))
            except forms.ValidationError as error:
                self.add_error(name, error)
        if data.get("phone") and not re.fullmatch(r"\+[0-9][0-9 ()-]{6,22}", data["phone"]):
            self.add_error("phone", "Use an international platform phone number.")
        for code, caption in LOCALES:
            template = data.get(f"{code}_title_template", "")
            if template and ("{page}" not in template or any(part not in {"page", "site"} for part in re.findall(r"\{([^{}]*)\}", template)) or template.count("{") != template.count("}")):
                self.add_error(f"{code}_title_template", "Use {page} and optionally {site}; no other placeholders.")
        if data.get("promotion_one") and data.get("promotion_one") == data.get("promotion_two"):
            self.add_error("promotion_two", "Choose a different post, or leave this card empty.")
        # Required-content rules gate publication; drafts may stay incomplete.
        if self.publishing:
            try:
                settings_content(
                    SimpleNamespace(**{name: data.get(name) for name in ["announcement_enabled", "announcement_url", "maintenance_enabled"]}),
                    SimpleNamespace(**{name: data.get(f"fa-AF_{name}", "") for name in ["name", "announcement", "announcement_label", "maintenance_title", "maintenance_message"]}),
                )
            except forms.ValidationError as error:
                self.add_error(None, error)
        self.inspect_files({"favicon_file": "image", "og_file": "image", **{f"{code}_{name}_file": "image" for code, caption in LOCALES for name in LOGO_FIELDS}})
        return data


def logo_declarations():
    """Declared per-language logo upload/restore inputs, already Unfold-styled."""
    mapping = {}
    for code, _caption in LOCALES:
        for name, caption in (("logo_light", _("Logo for light backgrounds")), ("logo_dark", _("Logo for dark backgrounds"))):
            upload = forms.FileField(label=caption, required=False, widget=UnfoldAdminFileFieldWidget(attrs={"accept": "image/png,image/jpeg,image/webp"}))
            restore = forms.BooleanField(label=_("Restore original logo"), required=False, widget=UnfoldBooleanWidget())
            upload.styled = restore.styled = True
            mapping[f"{code}_{name}_file"], mapping[f"{code}_{name}_clear"] = upload, restore
    return mapping


# Declared inputs keep Django's admin form factory happy: fieldset names are
# validated against the class, so runtime-only fields would raise FieldError.
declare_fields(SettingsForm, localized_declarations(SiteLocale, SITE_TEXT))
declare_fields(SettingsForm, logo_declarations())