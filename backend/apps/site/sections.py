"""Fixed owner tasks; section boundaries define the settings tabs and localized fields."""
from dataclasses import dataclass
from django.utils.translation import gettext_lazy as _


@dataclass(frozen=True)
class SettingsSection:
    key: str
    title: str
    description: str
    fields: tuple = ()
    localized: tuple = ()


SECTIONS = (
    SettingsSection("general", _("General"), _("Website name, tagline, default language and appearance."),
                    ("default_locale", "default_theme"), ("name", "tagline")),
    SettingsSection("branding", _("Branding"), _("Website icon and logos for light and dark backgrounds."),
                    ("favicon_file",)),
    SettingsSection("contacts", _("Contact information"), _("Support details, address, opening hours and social links."),
                    ("email", "phone", "website", "facebook", "instagram", "linkedin", "youtube"), ("address", "hours")),
    SettingsSection("hero", _("Homepage hero"), _("Add and edit the homepage slides below, then choose how the carousel behaves."),
                    ("hero_mode", "hero_autoplay", "hero_rotate", "hero_interval")),
    SettingsSection("promotions", _("Promotional posts"), _("Add and edit posts in the library below, then choose up to two published posts for the homepage."),
                    ("promotion_one", "promotion_two")),
    SettingsSection("announcement", _("Announcement"), _("A short message and optional link above the public website."),
                    ("announcement_enabled", "announcement_url"), ("announcement", "announcement_label")),
    SettingsSection("maintenance", _("Maintenance"), _("Temporarily pause public pages with a clear visitor message."),
                    ("maintenance_enabled",), ("maintenance_title", "maintenance_message")),
    SettingsSection("seo", _("Search & sharing"), _("Search visibility, page titles, descriptions and social previews."),
                    ("indexing", "og_file"), ("title_template", "description")),
)

# Sections promoted to sidebar routes under Site Settings; the rest stay as page tabs.
ROUTE_SECTIONS = ("announcement", "contacts", "hero", "promotions", "seo")