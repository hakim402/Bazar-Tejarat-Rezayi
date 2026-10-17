from django.contrib import admin
from django.urls import path, re_path
from drf_spectacular.views import SpectacularAPIView

from foundation.errors import not_found
from foundation.views import BootstrapView, LiveView, ReadyView

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/v1/bootstrap/", BootstrapView.as_view(), name="bootstrap"),
    path("api/v1/health/live/", LiveView.as_view(), name="liveness"),
    path("api/v1/health/ready/", ReadyView.as_view(), name="readiness"),
    path("api/v1/schema/", SpectacularAPIView.as_view(authentication_classes=[], permission_classes=[]), name="schema"),
    re_path(r"^api/.*$", not_found),
]
handler404 = "foundation.errors.not_found"
handler500 = "foundation.errors.server_error"
