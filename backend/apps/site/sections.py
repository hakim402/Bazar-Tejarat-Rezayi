"""Fixed owner tasks; section boundaries also define which fields may be saved."""
from dataclasses import dataclass
from django.utils.translation import gettext_lazy as _


@dataclass(frozen=True)
class SettingsSection:
    key: str
    title: str
    description: str
    icon: str
    fields: tuple = ()
    localized: tuple = ()
    logos: bool = False


SECTIONS = (
    SettingsSection("general", _("General"), _("Website name, tagline, default language and appearance."), "tune",
                    ("default_locale", "default_theme"), ("name", "tagline")),
    SettingsSection("branding", _("Branding"), _("Website icon and logos for light and dark backgrounds."), "palette",
                    ("favicon_file",), logos=True),
    SettingsSection("contacts", _("Contact information"), _("Support details, address, opening hours and social links."), "contact_support",
                    ("email", "phone", "website", "facebook", "instagram", "linkedin", "youtube"), ("address", "hours")),
    SettingsSection("hero", _("Homepage hero"), _("Choose Image Carousel or Video Carousel, then manage your homepage slides."), "view_carousel",
                    ("hero_mode", "hero_autoplay", "hero_rotate", "hero_interval")),
    SettingsSection("promotions", _("Promotional posts"), _("Manage your image and video library. Choose up to two published posts for the homepage."), "collections",
                    ("promotion_one", "promotion_two")),
    SettingsSection("announcement", _("Announcement"), _("A short message and optional link above the public website."), "campaign",
                    ("announcement_enabled", "announcement_url"), ("announcement", "announcement_label")),
    SettingsSection("maintenance", _("Maintenance"), _("Temporarily pause public pages with a clear visitor message."), "build",
                    ("maintenance_enabled",), ("maintenance_title", "maintenance_message")),
    SettingsSection("seo", _("Search & sharing"), _("Search visibility, page titles, descriptions and social previews."), "travel_explore",
                    ("indexing", "og_file"), ("title_template", "description")),
)
SECTION_MAP = {section.key: section for section in SECTIONS}
