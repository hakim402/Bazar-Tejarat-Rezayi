from django.urls import path
from . import views as v

urlpatterns = [
    path("seller/profiles/", v.Profiles.as_view()),
    path("seller/overview/", v.Overview.as_view()),
    path("seller/movements/", v.History.as_view()),
    path("seller/variants/<uuid:pk>/", v.Detail.as_view()),
    path("seller/variants/<uuid:pk>/settings/", v.Configure.as_view()),
    path("seller/variants/<uuid:pk>/receipts/", v.Receipt.as_view()),
    path("seller/variants/<uuid:pk>/adjustments/", v.Adjustment.as_view()),
]
