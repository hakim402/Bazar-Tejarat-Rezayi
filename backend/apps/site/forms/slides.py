"""Homepage media forms: one slide base, one post form with draft/publish rules."""
from django import forms
from django.utils.translation import gettext_lazy as _
from ..models import SiteSettings, HeroSlide, HeroLocale, LOCALES
from ..validation import destination, external_media, missing_pair
from .base import StyledForm, HERO_TEXT, declare_fields, localized_declarations


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
            if missing_pair(label, target):
                self.add_error(f"{code}_cta_url", "Provide both a CTA label and destination, or leave both blank.")
            try:
                destination(target)
            except forms.ValidationError as error:
                self.add_error(f"{code}_cta_url", error)
        self.inspect_files({"image_file": "image", "video_file": "video", "poster_file": "image"})
        # A fresh upload always replaces the previous source of the same media.
        if data.get("image_file"):
            data.update(bundled_image=False, image_url="", clear_image=True)
        elif data.get("bundled_image") and self.instance.image_id:
            data["clear_image"] = True
        if data.get("video_file"):
            data.update(video_url="", clear_video=True)
        # Publication requirements only apply when an enabled post is published.
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


# Per-language inputs must be declared on the class: Django's admin form factory
# validates fieldset names against it before __init__ ever runs.
declare_fields(SlideForm, localized_declarations(HeroLocale, HERO_TEXT))


class PostForm(SlideForm):
    version = forms.IntegerField(widget=forms.HiddenInput)

    class Meta(SlideForm.Meta):
        fields = ["placement", *SlideForm.Meta.fields]

    def __init__(self, *args, promotion=False, **kwargs):
        self.promotion = promotion
        super().__init__(*args, **kwargs)
        self.fields["placement"].label = _("Placement")
        self.fields["label"].label = _("Internal name")
        self.fields["enabled"].label = _("Include in the carousel when published")
        self.fields["kind"].label = _("Media type")
        self.fields["position"].label = _("Carousel order")
        # Promotions are always available once published; order is irrelevant.
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

    def clean(self):
        data = super().clean()
        # Optimistic concurrency against the shared settings version.
        current = SiteSettings.objects.filter(pk=1).values_list("version", flat=True).first()
        if current is not None and data.get("version") != current:
            self.add_error(None, _("Site Setting changed in another session. Reload and compare before saving again."))
        if self.promotion and self.publishing and data.get("kind") == "image" and not (data.get("fa-AF_cta_label") and data.get("fa-AF_cta_url")):
            self.add_error("fa-AF_cta_url", "A published image promotion needs Dari button text and a destination.")
        return data