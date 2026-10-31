from django.urls import path
from . import views as v

urlpatterns = [
    path("seller/profiles/", v.Profiles.as_view()),
    path("<marketplace:context>/", v.Notices.as_view()),
    path("<marketplace:context>/unread/", v.Counts.as_view()),
    path("<marketplace:context>/preferences/", v.Preferences.as_view()),
    path("<marketplace:context>/<uuid:pk>/read/", v.Read.as_view()),
]
