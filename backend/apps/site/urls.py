from django.urls import path
from .views import PublicSettings
from .media import public_media

urlpatterns = [
    path("public/<str:locale>/", PublicSettings.as_view(), name="site_public"),
    path("media/<uuid:pk>/", public_media, name="site_media"),
]
