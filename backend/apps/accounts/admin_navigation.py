"""Task-oriented navigation; links do not grant any authorization."""

from django.urls import reverse
from django.utils.translation import gettext_lazy as _


def navigation(request):
    from apps.site.sections import SECTIONS

    def item(title, icon, route):
        return {"title": title, "icon": icon, "link": reverse("admin:" + route)}

    return [
        {"title": _("Workspace"), "items": [item(_("Overview"), "space_dashboard", "index")]},
        {"title": _("Operations"), "items": [
            item(_("Products"), "inventory_2", "catalogue_product_changelist"),
            item(_("Verification cases"), "verified_user", "verification_reviewcase_changelist"),
            item(_("Organizations"), "business", "organizations_businessprofile_changelist"),
        ]},
        {"title": _("Administration"), "separator": True, "items": [
            item(_("Users"), "group", "accounts_user_changelist"),
            item(_("Staff accounts"), "manage_accounts", "accounts_account_changelist"),
            item(_("Activity log"), "history", "accounts_auditevent_changelist"),
        ]},
        {"title": _("Site Setting"), "separator": True, "collapsible": True, "items": [
            {"title": section.title, "icon": section.icon,
             "link": reverse("admin:site_settings_section", kwargs={"section": section.key})} for section in SECTIONS
        ]},
    ]
