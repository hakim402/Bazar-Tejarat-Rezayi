from django.urls import include, path, re_path, register_converter
from apps.foundation.converters import MarketplaceContext, SellerContext
from drf_spectacular.views import SpectacularAPIView

from apps.foundation.errors import not_found
from apps.foundation.views import BootstrapView, LiveView, ReadyView
from apps.accounts.admin import owner_site

register_converter(MarketplaceContext, "marketplace")
register_converter(SellerContext, "seller")

urlpatterns = [
    path("api/v1/cart/", include("apps.cart.urls")),
    path("api/v1/payments/", include("apps.payments.urls")),
    path("api/v1/fulfilment/", include("apps.fulfilment.urls")),
    path("api/v1/orders/", include("apps.orders.urls")),
    path("api/v1/messaging/", include("apps.messaging.urls")),
    path("api/v1/notifications/", include("apps.notifications.urls")),
    path("api/v1/marketplace/", include("apps.marketplace.urls")),
    path("api/v1/inventory/", include("apps.inventory.urls")),
    path("api/v1/catalogue/", include("apps.catalogue.urls")),
    path("api/v1/site/", include("apps.site.urls")),
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
