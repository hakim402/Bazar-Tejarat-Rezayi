"""Compatibility redirects: legacy section URLs land on the native Unfold screens."""
from django.urls import path, reverse
from django.views.generic import RedirectView
from ..models import SiteSettings
from ..sections import ROUTE_SECTIONS


class SettingsRedirect(RedirectView):
    """The old sectioned editor is now one singleton change form."""

    permanent = False

    def get_redirect_url(self, *args, **kwargs):
        if SiteSettings.objects.filter(pk=1).exists():
            return reverse("admin:site_sitesettings_change", args=[1])
        return reverse("admin:index")


class SectionRedirect(SettingsRedirect):
    """Routed sections reopen their sidebar editor; the rest land on the main page."""

    def get_redirect_url(self, *args, **kwargs):
        section = kwargs.get("section")
        if section in ROUTE_SECTIONS:
            return reverse("admin:site_sitesettings_change", args=[1]) + f"?section={section}"
        return super().get_redirect_url(*args, **kwargs)


class PostRedirect(RedirectView):
    """Legacy post URLs carried a section slug; native routes only need the pk."""

    permanent = False

    def get_redirect_url(self, *args, **kwargs):
        return reverse(self.pattern_name, kwargs={"pk": kwargs["pk"]} if "pk" in kwargs else {})


def settings_urls(admin_site):
    """Legacy owner URLs kept as redirects so bookmarks and dashboard links survive."""
    return [
        path("site-setting/", admin_site.admin_view(SettingsRedirect.as_view()), name="site_settings"),
        path("site-setting/hero/", admin_site.admin_view(SectionRedirect.as_view()), {"section": "hero"}, name="site_hero"),
        path("site-setting/<slug:section>/new/", admin_site.admin_view(PostRedirect.as_view(pattern_name="admin:site_heroslide_add")), name="site_post_add"),
        path("site-setting/<slug:section>/<uuid:pk>/", admin_site.admin_view(PostRedirect.as_view(pattern_name="admin:site_heroslide_change")), name="site_post_edit"),
        path("site-setting/<slug:section>/<uuid:pk>/delete/", admin_site.admin_view(PostRedirect.as_view(pattern_name="admin:site_heroslide_delete")), name="site_post_delete"),
        path("site-setting/<slug:section>/", admin_site.admin_view(SectionRedirect.as_view()), name="site_settings_section"),
    ]