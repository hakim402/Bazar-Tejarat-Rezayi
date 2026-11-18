from django.urls import path
from .views import PublicSettings, PublicPageDetail
from .media import public_media
from .contact import ContactView

urlpatterns = [
    path("contact/<str:locale>/", ContactView.as_view(), name="site_contact"),
    path("public/<str:locale>/", PublicSettings.as_view(), name="site_public"),
    path("pages/<str:locale>/<slug:slug>/", PublicPageDetail.as_view(), name="site_page"),
    path("media/<uuid:pk>/", public_media, name="site_media"),
]
