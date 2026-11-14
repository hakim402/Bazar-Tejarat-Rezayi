"""Shared form base: Unfold widgets, upload inspection and per-language fields."""
from django import forms
from django.utils.translation import gettext_lazy as _
from unfold.widgets import (
    UnfoldAdminEmailInputWidget, UnfoldAdminFileFieldWidget, UnfoldAdminIntegerFieldWidget,
    UnfoldAdminSelectWidget, UnfoldAdminTextareaWidget, UnfoldAdminTextInputWidget,
    UnfoldAdminURLInputWidget, UnfoldBooleanWidget,
)
from ..models import HeroLocale, LOCALES
from ..sections import SECTIONS
from ..validation import text
from ..media import inspect_upload

# Localized field names come from the section definitions, never a second list.
SITE_TEXT = list(dict.fromkeys(name for section in SECTIONS for name in section.localized))
HERO_TEXT = [field.name for field in HeroLocale._meta.fields if field.name not in {"id", "slide", "locale"}]


def logo_static(code, tone):
    """Bundled fallback logo shipped with the accounts app, per language and tone."""
    return f"accounts/site-logo-{code}-{'blue' if tone == 'light' else 'white'}.svg"


def locale_field(model, code, name):
    """One styled '{code}_{name}' input with native direction for its language."""
    original = model._meta.get_field(name)
    attrs = {"dir": "ltr" if code == "en" or name.endswith("_url") else "rtl", "lang": code}
    multiline = name in {"description", "maintenance_message", "transcript"}
    field = forms.CharField(
        label=_(name.replace("_", " ").title()), max_length=original.max_length, required=False, validators=[text],
        widget=UnfoldAdminTextareaWidget(attrs={"rows": 3, **attrs}) if multiline else UnfoldAdminTextInputWidget(attrs=attrs),
    )
    # Already Unfold-styled; the widget swap in StyledForm must leave it intact.
    field.styled = True
    return field


def declare_fields(form_class, mapping):
    """Attach generated inputs as real declared fields.

    Django's admin form factory validates fieldset names against the class, so
    runtime-only fields would raise FieldError; register them in both registries.
    """
    for key, field in mapping.items():
        setattr(form_class, key, field)
        form_class.declared_fields[key] = field
        form_class.base_fields[key] = field


def localized_declarations(model, names):
    """Class-level per-language inputs, shared by the settings and post forms."""
    return {f"{code}_{name}": locale_field(model, code, name) for code, _caption in LOCALES for name in names}


class StyledForm(forms.ModelForm):
    uploads = {}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Swap every default widget for its Unfold equivalent in one pass.
        for field in self.fields.values():
            widget = field.widget
            if isinstance(widget, forms.HiddenInput) or getattr(field, "styled", False):
                continue
            attrs = {key: value for key, value in widget.attrs.items() if key != "class"}
            if isinstance(widget, forms.CheckboxInput):
                field.widget = UnfoldBooleanWidget(attrs=attrs)
            elif isinstance(widget, forms.Select):
                field.widget = UnfoldAdminSelectWidget(attrs=attrs, choices=widget.choices)
            elif isinstance(widget, forms.Textarea):
                field.widget = UnfoldAdminTextareaWidget(attrs=attrs)
            elif isinstance(widget, forms.NumberInput):
                field.widget = UnfoldAdminIntegerFieldWidget(attrs=attrs)
            elif isinstance(widget, forms.EmailInput):
                field.widget = UnfoldAdminEmailInputWidget(attrs=attrs)
            elif isinstance(widget, forms.URLInput):
                field.widget = UnfoldAdminURLInputWidget(attrs=attrs)
            elif isinstance(widget, forms.FileInput):
                field.widget = UnfoldAdminFileFieldWidget(attrs=attrs)
            else:
                field.widget = UnfoldAdminTextInputWidget(attrs=attrs)
            if isinstance(field, forms.CharField) and not isinstance(field, forms.FileField):
                field.validators.append(text)
        self.uploads = {}

    def inspect_files(self, mapping):
        """Validate uploads early so drafts and publication share one media policy."""
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
        """Bind stored translations onto the declared inputs and group language tabs."""
        self.language_tabs = []
        for code, caption in LOCALES:
            row = rows.get(code)
            keys = [f"{code}_{name}" for name in names]
            for name in names:
                self.fields[f"{code}_{name}"].initial = getattr(row, name, "")
            self.language_tabs.append({"code": code, "caption": caption, "fields": keys})