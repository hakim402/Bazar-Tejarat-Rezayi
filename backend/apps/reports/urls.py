from django.urls import path

from . import views as v

urlpatterns = [
    path("seller/profiles/", v.Profiles.as_view()),
    path("seller/summary/", v.SellerSummary.as_view()),
    path("seller/export/", v.SellerExport.as_view()),
    path("buyer/summary/", v.BuyerSummary.as_view()),
]
