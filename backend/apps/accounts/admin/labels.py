"""Admin-layer display localization.

Model source stays untouched: at admin registration we wrap display-only metadata
(model/field verbose names and choice labels) in gettext_lazy so the project Dari
catalogue can translate them. English source text is its own gettext key, so English
output is unchanged. Only display values are wrapped; choice keys, validation,
schema and database behavior are untouched. No API/service code reads these displays.
"""

from django.apps import apps
from django.utils import translation
from django.utils.translation import gettext_lazy as _


CATALOGUE_NAMES = {
    "catalogue.product": ("Product", "Products"),
    "catalogue.sourcerevision": ("Product submission", "Product submissions"),
    "catalogue.variant": ("Product variant", "Product variants"),
    "catalogue.category": ("Category", "Categories"),
    "catalogue.saleunit": ("Sale unit", "Sale units"),
    "inventory.position": ("Stock position", "Stock positions"),
    "inventory.batch": ("Stock batch", "Stock batches"),
    "inventory.movement": ("Stock movement", "Stock movements"),
    "inventory.shortage": ("Stock shortage", "Stock shortages"),
    "catalogue.translation": ("Product translation", "Product translations"),
}


def _wrap_choices(choices):
    wrapped = []
    for key, value in choices:
        if isinstance(value, (list, tuple)):
            wrapped.append((key, _wrap_choices(value)))
        elif isinstance(value, str):
            wrapped.append((key, _(value)))
        else:
            with translation.override("en"):
                wrapped.append((key, _(str(value))))
    return wrapped


def localize_model(model):
    opts = model._meta
    # Capture canonical English source text (some defaults are lazy concatenations),
    # then wrap as gettext keys so the Dari catalogue translates them. English output
    # is unchanged because the English source text is its own key.
    with translation.override("en"):
        verbose_name = str(opts.verbose_name)
        verbose_name_plural = str(opts.verbose_name_plural)
        field_labels = [(field, str(field.verbose_name)) for field in [*opts.fields, *opts.many_to_many]]
        config = apps.get_app_config(opts.app_label)
        app_name = str(config.verbose_name)
    verbose_name, verbose_name_plural = CATALOGUE_NAMES.get(opts.label_lower, (verbose_name, verbose_name_plural))
    opts.verbose_name = _(verbose_name)
    opts.verbose_name_plural = _(verbose_name_plural)
    for field, label in field_labels:
        if opts.label_lower == "inventory.batch" and field.name == "code":
            label = "Batch number"
        field.verbose_name = _(label)
        if field.choices:
            choices = field.choices
            if opts.label_lower == "inventory.position" and field.name == "tracking":
                choices = [("plain", "Standard stock"), ("batch", "Batch stock")]
            field.choices = _wrap_choices(choices)
    config.verbose_name = _(app_name)
