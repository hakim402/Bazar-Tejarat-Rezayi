from django.urls import path
from . import views as v

urlpatterns = [
    path("queue/", v.QueueView.as_view()),
    path("cases/<uuid:pk>/", v.CaseView.as_view()),
    path("evidence/<str:context>/<uuid:pk>/", v.EvidenceDownloadView.as_view()),
    path("transfers/", v.TransferQueueView.as_view()),
    path("transfers/<uuid:pk>/", v.TransferReviewView.as_view()),
    path("<str:context>/profiles/<uuid:pk>/application/", v.ApplicationView.as_view()),
    path("<str:context>/profiles/<uuid:pk>/evidence/", v.EvidenceView.as_view()),
]
