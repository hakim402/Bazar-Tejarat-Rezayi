"""Form adapters for the pure-Unfold site admin; one widget and locale strategy."""
from .base import StyledForm, SITE_TEXT, HERO_TEXT, logo_static
from .settings import SettingsForm, language_fields
from .slides import SlideForm, PostForm
from .seo import SEOForm, SEOForms
from .pages import ContentPageForm, ContentPageLocaleForm

# Model-driven scalar list, kept as a stable export for services and tests.
SITE_FIELDS = SettingsForm.Meta.fields

__all__ = [
    "StyledForm", "SITE_TEXT", "HERO_TEXT", "SITE_FIELDS", "logo_static", "language_fields",
    "SettingsForm", "SlideForm", "PostForm", "SEOForm", "SEOForms",
    "ContentPageForm", "ContentPageLocaleForm",
]