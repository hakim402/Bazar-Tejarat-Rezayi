"""One shared definition of the website-management destinations.

The page navigation, the owner sidebar and the All-applications directory all
consume these groups, so names, links and active states stay consistent.
"""
from django.urls import reverse
from django.utils.translation import gettext_lazy as _
from ..sections import SECTIONS


def settings_url(section=None):
    url = reverse("admin:site_sitesettings_change", args=(1,))
    return f"{url}?section={section}" if section else url


def destination_groups():
    titles = {section.key: section.title for section in SECTIONS}

    def section(key, icon):
        return {"key": key, "title": titles[key], "icon": icon,
                "link": settings_url(key if key != "general" else None)}

    return (
        {"key": "settings", "title": _("Website settings"), "items": (
            section("general", "tune"),
            section("branding", "palette"),
            section("contacts", "call"),
            section("announcement", "campaign"),
            section("maintenance", "build"),
            section("seo", "travel_explore"),
        )},
        {"key": "homepage", "title": _("Homepage content"), "items": (
            section("hero", "image"),
            section("promotions", "view_carousel"),
            {"key": "library", "title": _("Post library"), "icon": "perm_media",
             "link": reverse("admin:site_heroslide_changelist")},
        )},
        {"key": "pages", "title": _("Website pages"), "items": (
            {"key": "pages", "title": _("Content pages"), "icon": "description",
             "link": reverse("admin:site_contentpage_changelist")},
        )},
    )


def active_destination(request, obj=None):
    """The single selected destination, aware of section and placement parameters."""
    if request.path == reverse("admin:site_sitesettings_change", args=(1,)):
        section = request.GET.get("section")
        return section if section in {item.key for item in SECTIONS} else "general"
    if request.path.startswith(reverse("admin:site_heroslide_changelist")):
        placement = request.GET.get("placement") or getattr(obj, "placement", None)
        return {"main": "hero", "promotion": "promotions"}.get(placement, "library")
    if request.path.startswith(reverse("admin:site_contentpage_changelist")):
        return "pages"
    return None


def back_link(request, obj=None):
    """Contextual return link for record screens; placement survives the round trip."""
    posts_path = reverse("admin:site_heroslide_changelist")
    pages_path = reverse("admin:site_contentpage_changelist")
    if request.path.startswith(posts_path) and request.path != posts_path:
        placement = request.GET.get("placement") or getattr(obj, "placement", None)
        query = f"?placement={placement}" if placement in {"main", "promotion"} else ""
        return {"url": posts_path + query, "label": _("Back to post library")}
    if request.path.startswith(pages_path) and request.path != pages_path:
        return {"url": pages_path, "label": _("Back to content pages")}
    return None