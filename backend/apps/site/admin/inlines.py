"""Inline formsets: SEO overrides with draft prefill, and page translations."""
from django.utils.translation import gettext_lazy as _
from unfold.admin import StackedInline
from ..forms import SEOForm, ContentPageLocaleForm
from ..models import PageSEO, ContentPageLocale
from ..services import working_draft


class SEOInline(StackedInline):
    model = PageSEO
    form = SEOForm
    fields = ["page", "locale", "title", "description", "image_file"]
    extra = 1
    max_num = 48
    verbose_name = _("Page override")
    verbose_name_plural = _("Individual page overrides (optional)")

    def get_formset(self, request, obj=None, **kwargs):
        base = super().get_formset(request, obj, validate_max=True, **kwargs)
        # Saved SEO draft rows reopen on GET only; POST validation stays native.
        draft = working_draft(obj) if obj is not None and request.method == "GET" else None
        seo_data = {key: value for key, value in draft.form_data.items() if key.startswith("seo-")} if draft else {}

        class DraftFormSet(base):
            def __init__(self, *args, **kw):
                if seo_data and not args and kw.get("data") is None:
                    kw["data"] = seo_data
                super().__init__(*args, **kw)

        return DraftFormSet


class ContentPageLocaleInline(StackedInline):
    model = ContentPageLocale
    form = ContentPageLocaleForm
    fields = [("locale", "is_draft"), "title", "intro", ("cta_label", "cta_url"), ("cta_secondary_label", "cta_secondary_url"), "body", "meta_description"]
    extra = 0
    max_num = 4
    verbose_name = _("Translation")
    verbose_name_plural = _("Translations — one per language")

    class Media:
        js = ["site/content-pages.js"]