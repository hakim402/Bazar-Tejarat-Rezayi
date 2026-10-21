from django.urls import include, path, re_path
from drf_spectacular.views import SpectacularAPIView

from apps.foundation.errors import not_found
from apps.foundation.views import BootstrapView, LiveView, ReadyView
from apps.accounts.admin import owner_site

urlpatterns = [
    path("api/v1/content/", include("apps.content.urls")),
    path("admin/", owner_site.urls),
    path("api/v1/organizations/", include("apps.organizations.urls")),
    path("api/v1/verification/", include("apps.verification.urls")),
    path("api/v1/auth/", include("apps.accounts.urls")),
    path("api/v1/bootstrap/", BootstrapView.as_view(), name="bootstrap"),
    path("api/v1/health/live/", LiveView.as_view(), name="liveness"),
    path("api/v1/health/ready/", ReadyView.as_view(), name="readiness"),
    path("api/v1/schema/", SpectacularAPIView.as_view(authentication_classes=[], permission_classes=[]), name="schema"),
    re_path(r"^api/.*$", not_found),
]
handler404 = "apps.foundation.errors.not_found"
handler500 = "apps.foundation.errors.server_error"
