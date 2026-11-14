"""Per-page search and sharing overrides."""
from django import forms
from django.forms import modelformset_factory
from django.utils.translation import gettext_lazy as _
from ..models import PageSEO
from .base import StyledForm


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

    def clean(self):
        data = super().clean()
        self.inspect_files({"image_file": "image"})
        return data


SEOForms = modelformset_factory(PageSEO, form=SEOForm, extra=1, can_delete=True, max_num=48, validate_max=True)