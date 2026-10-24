from drf_spectacular.utils import extend_schema
from rest_framework.response import Response
from rest_framework.exceptions import APIException
from apps.foundation.views import PublicView
from .contracts import PublicSite
from .queries import public_settings
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
