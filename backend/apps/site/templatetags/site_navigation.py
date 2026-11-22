"""Shared grouped navigation for every website-management screen."""
from django import template

register = template.Library()


@register.inclusion_tag("site/admin/includes/navigation.html", takes_context=True)
def site_navigation(context):
    # Lazy: template libraries load while the admin modules are still importing.
    from apps.accounts.admin.theme import SITE_THEME
    from ..admin.navigation import active_destination, back_link, destination_groups

    request = context["request"]
    obj = context.get("original") or context.get("object")
    return {
        "groups": destination_groups(),
        "active": active_destination(request, obj),
        "back": back_link(request, obj),
        "nav": SITE_THEME,
    }