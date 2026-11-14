"""Content page forms: record fields plus the Trix-backed translation form."""
from django import forms
from django.urls import reverse_lazy
from django.utils.translation import gettext_lazy as _
from unfold.contrib.forms.widgets import WysiwygWidget
from unfold.widgets import (
    UnfoldAdminSelectWidget, UnfoldAdminTextareaWidget, UnfoldAdminTextInputWidget, UnfoldBooleanWidget,
)
from ..models import ContentPage, ContentPageLocale, SiteMedia
from ..validation import text, destination, missing_pair
from ..sanitize import sanitize_body
from .base import StyledForm


class ContentPageForm(StyledForm):
    cover_file = forms.FileField(label=_("Upload a cover image"), required=False, help_text=_("PNG, JPEG or WebP, up to 8 MiB. A new upload replaces the selected cover."))

    class Meta:
        model = ContentPage
        fields = ["slug", "kind", "group", "position", "status", "show_in_footer", "cover"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["cover_file"].widget.attrs["accept"] = "image/png,image/jpeg,image/webp"
        self.fields["cover"].queryset = SiteMedia.objects.filter(kind="image").order_by("-id")
        self.fields["cover"].label = _("Existing cover image")
        self.fields["cover"].help_text = _("Pick a stored image, or leave empty and upload above.")

    def clean(self):
        data = super().clean()
        self.inspect_files({"cover_file": "image"})
        return data


class ContentPageLocaleForm(forms.ModelForm):
    """Plain ModelForm: StyledForm would replace the Trix widget with a text input."""

    class Meta:
        model = ContentPageLocale
        fields = ["locale", "is_draft", "title", "intro", "cta_label", "cta_url", "cta_secondary_label", "cta_secondary_url", "body", "meta_description"]
        widgets = {
            "locale": UnfoldAdminSelectWidget(),
            "is_draft": UnfoldBooleanWidget(),
            "title": UnfoldAdminTextInputWidget(),
            "intro": UnfoldAdminTextareaWidget(attrs={"rows": 2}),
            "cta_label": UnfoldAdminTextInputWidget(),
            "cta_url": UnfoldAdminTextInputWidget(attrs={"dir": "ltr"}),
            "cta_secondary_label": UnfoldAdminTextInputWidget(),
            "cta_secondary_url": UnfoldAdminTextInputWidget(attrs={"dir": "ltr"}),
            "meta_description": UnfoldAdminTextareaWidget(attrs={"rows": 2}),
            "body": WysiwygWidget(attrs={
                "data-upload-url": reverse_lazy("admin:site_contentpage_media_upload"),
                "data-image-label": _("Insert image"),
                "data-image-error": _("The image could not be uploaded. Try again."),
            }),
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        for name, label in {"locale": _("Language"), "is_draft": _("Keep this language as draft"), "title": _("Title"), "intro": _("Intro"), "cta_label": _("Hero button text"), "cta_url": _("Hero button link"), "cta_secondary_label": _("Second button text (optional)"), "cta_secondary_url": _("Second button link"), "body": _("Body"), "meta_description": _("SEO description (optional)")}.items():
            self.fields[name].label = label
        for name in ("title", "intro", "cta_label", "cta_secondary_label", "meta_description"):
            self.fields[name].validators.append(text)
        for name in ("cta_url", "cta_secondary_url"):
            self.fields[name].validators.append(destination)

    def clean(self):
        data = super().clean()
        # Both button pairs use the same shared completeness rule.
        for label, url in (("cta_label", "cta_url"), ("cta_secondary_label", "cta_secondary_url")):
            side = missing_pair(data.get(label), data.get(url))
            if side == "url":
                self.add_error(url, _("A button needs a destination."))
            elif side == "label":
                self.add_error(label, _("A button needs visible text."))
        return data

    def clean_body(self):
        return sanitize_body(self.cleaned_data.get("body", ""))