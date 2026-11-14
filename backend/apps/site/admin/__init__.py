"""Pure-Unfold owner admin for site settings, homepage media and content pages."""
from apps.accounts.admin import owner_site
from ..models import SiteSettings, HeroSlide, ContentPage
from .settings import SiteSettingsAdmin
from .slides import HeroSlideAdmin
from .pages import ContentPageAdmin
from .urls import settings_urls

# Registration wraps each admin with GuardedAdminMixin: owner-only by default.
owner_site.register(SiteSettings, SiteSettingsAdmin)
owner_site.register(HeroSlide, HeroSlideAdmin)
owner_site.register(ContentPage, ContentPageAdmin)

__all__ = ["settings_urls"]