"""Owner workflow labels; product descriptions remain database content."""

from django import forms
from django.utils.translation import gettext_lazy as _, override
from unfold.widgets import (
    UnfoldAdminSelectWidget,
    UnfoldAdminSelect2MultipleWidget,
    UnfoldAdminTextareaWidget,
    UnfoldAdminIntegerFieldWidget,
    UnfoldAdminTextInputWidget,
    UnfoldAdminFileFieldWidget,
)

COPY = {
    'title': _('Product review'),
    'target': _('Target language'),
    'load': _('Load selected translation'),
    'load_help': _('Loading replaces unsaved inputs. Save your draft first, or deliberately load another source/target.'),
    'version': _('Version'),
    'revision': _('Source revision to review'),
    'action': _('Action'),
    'reason': _('Decision reason'),
    'locale': _('Target language'),
    'description': _('Translated description'),
    'image_alts': _('Translated image descriptions'),
    'payload': _('Category details'),
    'code': _('Code'),
    'parent': _('Parent category'),
    'units': _('Sale units'),
    'attributes': _('Advanced attributes'),
    'icon': _('Icon'),
    'image_file': _('Cover image'),
    'image_clear': _('Remove cover image'),
    'active': _('Active'),
    'fractional': _('Fractional quantities'),
    'label_fa_af': _('Dari name'),
    'label_en': _('English name'),
    'label_ps': _('Pashto name'),
    'label_ar': _('Arabic name'),
    'save': _('Save draft'),
    'publish': _('Approve and publish'),
    'reject': _('Reject'),
    'unpublish': _('Unpublish'),
    'approve': _('Approve translation'),
    'generate': _('Request automatic draft'),
    'retry': _('Retry job'),
    'conflict': _('This record changed or differs from the saved draft. Your input is retained. Load the selected translation again and review it before resubmitting.'),
    'error': _('Review required fields, current version and permissions.'),
    'unit': _('Sale unit details'),
}


def localize(form, locale):
    with override("fa-af" if locale == "fa-AF" else locale):
        copy = {key: str(value) for key, value in COPY.items()}
        translated_title = str(_("Translated title"))
    for name, field in form.fields.items():
        # Custom radio widgets (e.g. the icon glyph grid) keep their own rendering.
        if not field.widget.is_hidden and not isinstance(field.widget, forms.RadioSelect):
            attrs = {**field.widget.attrs}
            if isinstance(field, forms.MultipleChoiceField):
                # A searchable dropdown that accepts several values (category sale units).
                field.widget = UnfoldAdminSelect2MultipleWidget(attrs=attrs, choices=field.choices)
            elif isinstance(field, (forms.ModelChoiceField, forms.ChoiceField)):
                field.widget = UnfoldAdminSelectWidget(attrs=attrs, choices=field.choices)
            elif isinstance(field, forms.FileField):
                # Keep a real file input; the text widgets below cannot upload.
                field.widget = UnfoldAdminFileFieldWidget(attrs=attrs)
            elif isinstance(field, forms.BooleanField):
                field.widget = forms.CheckboxInput(attrs=attrs)
            elif isinstance(field.widget, forms.Textarea):
                field.widget = UnfoldAdminTextareaWidget(attrs={**attrs, "rows": 5})
            elif isinstance(field, forms.IntegerField):
                field.widget = UnfoldAdminIntegerFieldWidget(attrs=attrs)
            else:
                field.widget = UnfoldAdminTextInputWidget(attrs=attrs)
        field.label = translated_title if name == "title" else copy.get(name, name)
    if "action" in form.fields:
        form.fields["action"].choices = [(value, copy.get(value, value)) for value, _ in form.fields["action"].choices]
    return copy
