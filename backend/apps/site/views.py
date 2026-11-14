from drf_spectacular.utils import extend_schema
from rest_framework.response import Response
from rest_framework.exceptions import APIException, NotFound
from apps.foundation.views import PublicView
from .contracts import PublicSite, PublicPage
from .queries import public_settings, public_page
from .models import SiteSettings


class PublicSettings(PublicView):
    @extend_schema(operation_id="site_settings", responses=PublicSite)
    def get(self, request, locale):
        self.locale(locale)
        try:
            data = public_settings(locale)
        except (SiteSettings.DoesNotExist, KeyError):
            error = APIException("Site settings are not initialized.")
            error.status_code = 503
            raise error from None
        return Response(PublicSite(data).data)


class PublicPageDetail(PublicView):
    @extend_schema(operation_id="site_page", responses=PublicPage)
    def get(self, request, locale, slug):
        self.locale(locale)
        data = public_page(locale, slug)
        if data is None:
            raise NotFound()
        return Response(PublicPage(data).data)
