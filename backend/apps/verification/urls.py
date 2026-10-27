from django.urls import path
from . import views as v

urlpatterns = [
    path("evidence/<marketplace:context>/<uuid:pk>/", v.EvidenceDownloadView.as_view()),
    path("<marketplace:context>/profiles/<uuid:pk>/application/", v.ApplicationView.as_view()),
    path("<marketplace:context>/profiles/<uuid:pk>/evidence/", v.EvidenceView.as_view()),
]
