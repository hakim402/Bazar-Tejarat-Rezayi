"""English form adapters with manual locale tabs and hidden optimistic versions."""
import re
from django import forms
from django.forms import modelformset_factory
from django.utils.translation import gettext_lazy as _
from .models import SiteSettings, SiteLocale, HeroSlide, HeroLocale, PageSEO, LOCALES
from .validation import text, destination, external_media
from .media import inspect_upload

CONTROL = "ra:block ra:w-full ra:min-w-0 ra:min-h-11 ra:rounded-lg ra:border ra:border-control ra:bg-panel ra:px-3 ra:py-2 ra:text-ink"
SITE_TEXT = ["name", "tagline", "title_template", "description", "address", "hours", "announcement", "announcement_label", "maintenance_title", "maintenance_message"]
HERO_TEXT = ["title", "description", "alt", "cta_label", "cta_url", "transcript"]
SITE_FIELDS = ["default_locale", "default_theme", "indexing", "email", "phone", "website", "facebook", "instagram", "linkedin", "youtube", "announcement_enabled", "announcement_url", "maintenance_enabled", "hero_mode", "hero_autoplay", "hero_rotate", "hero_interval", "promotion_one", "promotion_two"]


class StyledForm(forms.ModelForm):
    uploads = {}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        for field in self.fields.values():
            if isinstance(field.widget, forms.HiddenInput):
                continue
            field.widget.attrs["class"] = "ra:size-5 ra:accent-action" if isinstance(field.widget, forms.CheckboxInput) else CONTROL
            if isinstance(field, forms.CharField) and not isinstance(field, forms.FileField):
                field.validators.append(text)
        self.uploads = {}

    def inspect_files(self, mapping):
        for name, kind in mapping.items():
            file = self.cleaned_data.get(name)
            if file:
                try:
                    inspect_upload(file, kind)
                    file.seek(0)
                    self.uploads[name] = kind
                except forms.ValidationError as error:
                    self.add_error(name, error)

    def locale_fields(self, model, names, rows):
        self.language_tabs = []
        for code, caption in LOCALES:
            keys = []
            row = rows.get(code)
            for name in names:
                key = f"{code}_{name}"
                original = model._meta.get_field(name)
                self.fields[key] = forms.CharField(label=_(name.replace("_", " ").title()), max_length=original.max_length, required=False, initial=getattr(row, name, ""), validators=[text], widget=forms.Textarea(attrs={"class": CONTROL, "rows": 3, "dir": "ltr" if code == "en" or name.endswith("_url") else "rtl", "lang": code}) if name in {"description", "maintenance_message", "transcript"} else forms.TextInput(attrs={"class": CONTROL, "dir": "ltr" if code == "en" or name.endswith("_url") else "rtl", "lang": code}))
                keys.append(key)
            self.language_tabs.append({"code": code, "caption": caption, "fields": keys})

    def core_fields(self):
        return [self[name] for name in self.fields if not any(name.startswith(code + "_") for code, caption in LOCALES) and not self[name].is_hidden]

    def localized_tabs(self):
        return [{**tab, "fields": [self[name] for name in tab["fields"]]} for tab in self.language_tabs]


class SettingsForm(StyledForm):
    version = forms.IntegerField(widget=forms.HiddenInput)
    favicon_file = forms.FileField(label=_("Favicon image (PNG, JPEG or WebP)"), required=False)
    og_file = forms.FileField(label=_("Default social image"), required=False)

    class Meta:
        model = SiteSettings
        fields = SITE_FIELDS

    def __init__(self, *args, section=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.section = section
        self.initial["version"] = self.instance.version
        rows = {row.locale: row for row in self.instance.locales.all()}
        self.locale_rows = rows
        self.locale_fields(SiteLocale, SITE_TEXT, rows)
        self.fields["fa-AF_name"].required = True
        self.fields["fa-AF_title_template"].required = True
        for tab in self.language_tabs:
            for name in ["logo_light", "logo_dark"]:
                key = f"{tab['code']}_{name}_file"
                self.fields[key] = forms.FileField(label=_(name.replace("_", " ").title() + " replacement (raster image)"), required=False, widget=forms.FileInput(attrs={"class": CONTROL, "accept": "image/png,image/jpeg,image/webp"}))
                clear = f"{tab['code']}_{name}_clear"
                self.fields[clear] = forms.BooleanField(label=_("Restore original " + name.replace("_", " ")), required=False, widget=forms.CheckboxInput(attrs={"class":"ra:size-5 ra:accent-action"}))
                tab["fields"].extend([key, clear])
        if section:
            allowed = {"version", *section.fields}
            for tab in self.language_tabs:
                allowed.update(f"{tab['code']}_{name}" for name in section.localized)
                if section.logos:
                    allowed.update(f"{tab['code']}_{name}_{action}" for name in ["logo_light", "logo_dark"] for action in ["file", "clear"])
                tab["fields"] = [name for name in tab["fields"] if name in allowed]
            self.fields = {name: field for name, field in self.fields.items() if name in allowed}
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
            if name in self.fields:
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
                "logo_light_file": _("Logo for light backgrounds"), "logo_dark_file": _("Logo for dark backgrounds"),
            }.items():
                if any(name == f"{code}_{key}" for code, _caption in LOCALES):
                    field.label = label
            if name.endswith("_title_template"):
                field.help_text = _("Use {page} for the page title and {site} for the website name. Example: {page} | {site}.")

    def localized_tabs(self):
        tabs = [tab for tab in super().localized_tabs() if tab["fields"]]
        if self.section and self.section.logos:
            for tab in tabs:
                row = self.locale_rows.get(tab["code"])
                tab["logo_light"] = row.logo_light if row else None
                tab["logo_light_static"] = f"accounts/site-logo-{tab['code']}-blue.svg"
                tab["logo_dark"] = row.logo_dark if row else None
                tab["logo_dark_static"] = f"accounts/site-logo-{tab['code']}-white.svg"
        return tabs

    def clean(self):
        data = super().clean()
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
        self.inspect_files({"favicon_file": "image", "og_file": "image", **{f"{code}_{name}_file": "image" for code, caption in LOCALES for name in ["logo_light", "logo_dark"]}})
        return data


class SlideForm(StyledForm):
    image_file = forms.FileField(label=_("Upload image"), required=False)
    video_file = forms.FileField(label=_("Upload MP4 video"), required=False)
    poster_file = forms.FileField(label=_("Upload video poster"), required=False)
    clear_image = forms.BooleanField(label=_("Clear the previous uploaded image reference"), required=False)
    clear_video = forms.BooleanField(label=_("Clear the previous uploaded video reference"), required=False)

    class Meta:
        model = HeroSlide
        fields = ["label", "enabled", "position", "kind", "bundled_image", "image_url", "video_url", "source_url", "silent"]

    def __init__(self, *args, publishing=True, **kwargs):
        self.publishing = publishing
        super().__init__(*args, **kwargs)
        rows = {row.locale: row for row in self.instance.locales.all()} if self.instance.pk and not self.instance._state.adding else {}
        self.locale_fields(HeroLocale, HERO_TEXT, rows)
        for name, label in {
            "label": _("Slide name (only visible to you)"), "enabled": _("Show this slide"),
            "position": _("Display order"), "kind": _("Slide type"), "bundled_image": _("Use the included marketplace image"),
        }.items():
            self.fields[name].label = label
        self.fields["source_url"].help_text = _("Opens when visitors click the video. Use an existing page/product preview path or public HTTPS URL. Video headlines and buttons are hidden on the public hero.")
        for name in ["image_file", "poster_file"]:
            self.fields[name].widget.attrs["accept"] = "image/png,image/jpeg,image/webp"
        self.fields["video_file"].widget.attrs["accept"] = "video/mp4"
        for code, _caption in LOCALES:
            for name, label in {
                "title": _("Headline"), "description": _("Supporting text"), "alt": _("Image description"),
                "cta_label": _("Button text (optional)"), "cta_url": _("Button destination (optional)"),
                "transcript": _("Video transcript"),
            }.items():
                self.fields[f"{code}_{name}"].label = label

    def basics(self):
        return [self[name] for name in ["label", "enabled", "position", "kind"]]

    def image_fields(self):
        return [self[name] for name in ["bundled_image", "image_file", "clear_image"]]

    def video_fields(self):
        return [self[name] for name in ["video_file", "poster_file", "source_url", "silent", "clear_video"]]

    def clean(self):
        data = super().clean()
        for name, kind in [("image_url", "image"), ("video_url", "video")]:
            try:
                external_media(data.get(name, ""), kind)
            except forms.ValidationError as error:
                self.add_error(name, error)
        try:
            destination(data.get("source_url", ""))
        except forms.ValidationError as error:
            self.add_error("source_url", error)
        for code, caption in LOCALES:
            label, target = data.get(f"{code}_cta_label", ""), data.get(f"{code}_cta_url", "")
            if bool(label) != bool(target):
                self.add_error(f"{code}_cta_url", "Provide both a CTA label and destination, or leave both blank.")
            try:
                destination(target)
            except forms.ValidationError as error:
                self.add_error(f"{code}_cta_url", error)
        self.inspect_files({"image_file": "image", "video_file": "video", "poster_file": "image"})
        if data.get("image_file"):
            data.update(bundled_image=False, image_url="", clear_image=True)
        elif data.get("bundled_image") and self.instance.image_id:
            data["clear_image"] = True
        if data.get("video_file"):
            data.update(video_url="", clear_video=True)
        if self.publishing and data.get("enabled") and not data.get("DELETE"):
            if data.get("kind") == "image" and not data.get("fa-AF_title"):
                self.add_error("fa-AF_title", "Dari title is required for an enabled slide.")
            if data.get("kind") == "image":
                sources = sum(bool(v) for v in [data.get("image_file") or (self.instance.image_id and not data.get("clear_image")), data.get("image_url"), data.get("bundled_image")])
                if sources != 1:
                    self.add_error(None, "An enabled image slide needs exactly one image source. Clear the old upload or bundled choice when switching source.")
                if not data.get("fa-AF_alt"):
                    self.add_error("fa-AF_alt", "Provide the Dari image description.")
            else:
                if not data.get("source_url"):
                    self.add_error("source_url", "Provide the destination opened when visitors click the video.")
                if not data.get("fa-AF_alt"):
                    self.add_error("fa-AF_alt", "Describe the video for assistive technology in Dari.")
                sources = sum(bool(v) for v in [data.get("video_file") or (self.instance.video_id and not data.get("clear_video")), data.get("video_url")])
                if sources != 1 or not (data.get("poster_file") or self.instance.poster_id or data.get("video_file")):
                    self.add_error(None, "An enabled video slide needs exactly one video source and an uploaded poster.")
                if not data.get("silent") and not data.get("fa-AF_transcript"):
                    self.add_error("fa-AF_transcript", "Provide a transcript when audio conveys information.")
        return data


class PostForm(SlideForm):
    version = forms.IntegerField(widget=forms.HiddenInput)

    def __init__(self, *args, promotion=False, **kwargs):
        self.promotion = promotion
        super().__init__(*args, **kwargs)
        self.fields["label"].label = _("Internal name")
        self.fields["enabled"].label = _("Include in the carousel when published")
        self.fields["kind"].label = _("Media type")
        self.fields["position"].label = _("Carousel order")
        if promotion:
            for name in ["enabled", "position"]:
                self.fields[name].widget = forms.HiddenInput()
            self.initial["enabled"] = True
            self.initial["position"] = 0
        for code, _caption in LOCALES:
            self.fields[f"{code}_alt"].label = _("Media description (accessibility)")
            if promotion:
                self.fields[f"{code}_cta_label"].label = _("Button text")
                self.fields[f"{code}_cta_url"].label = _("Product / page link")

    def clean_enabled(self):
        # Promotion availability is publication-controlled, never a trusted hidden flag.
        return True if self.promotion else self.cleaned_data["enabled"]

    def basics(self):
        names = ["label", "kind"] if self.promotion else ["label", "kind", "enabled", "position"]
        return [self[name] for name in names]

    def clean(self):
        data = super().clean()
        if self.promotion and self.publishing and data.get("kind") == "image" and not (data.get("fa-AF_cta_label") and data.get("fa-AF_cta_url")):
            self.add_error("fa-AF_cta_url", "A published image promotion needs Dari button text and a destination.")
        return data


class SEOForm(StyledForm):
    image_file = forms.FileField(label=_("Social image override"), required=False)

    class Meta:
        model = PageSEO
        fields = ["page", "locale", "title", "description"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["page"].choices = [(key, caption.replace("-", " ").title()) for key, caption in self.fields["page"].choices]
        for name, label in {"page": _("Page"), "locale": _("Language"), "title": _("Page title"), "description": _("Search description")}.items():
            self.fields[name].label = label

    def caption(self):
        page = dict(self.fields["page"].choices).get(self["page"].value(), "")
        locale = dict(LOCALES).get(self["locale"].value(), "")
        return f"{page} · {locale}" if page and locale else _("New page override")

    def clean(self):
        data = super().clean()
        self.inspect_files({"image_file": "image"})
        return data


SlideForms = modelformset_factory(HeroSlide, form=SlideForm, extra=1, can_delete=True, max_num=12, validate_max=True)
SEOForms = modelformset_factory(PageSEO, form=SEOForm, extra=1, can_delete=True, max_num=48, validate_max=True)
