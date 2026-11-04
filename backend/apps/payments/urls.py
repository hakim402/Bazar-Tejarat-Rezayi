from django.urls import path
from . import views as v

urlpatterns = [
    path("seller/profiles/", v.Profiles.as_view()),
    path("<marketplace:context>/orders/", v.Orders.as_view()),
    path("<marketplace:context>/orders/<uuid:pk>/", v.Detail.as_view()),
    path("<marketplace:context>/orders/<uuid:pk>/history/", v.History.as_view()),
    path("buyer/orders/<uuid:pk>/claims/", v.SubmitClaim.as_view()),
    path("seller/orders/<uuid:pk>/receipts/", v.DirectReceipt.as_view()),
    path("buyer/claims/<uuid:pk>/withdraw/", v.WithdrawClaim.as_view()),
    path("seller/claims/<uuid:pk>/confirm/", v.ConfirmClaim.as_view()),
    path("seller/claims/<uuid:pk>/reject/", v.RejectClaim.as_view()),
    path("seller/receipts/<uuid:pk>/corrections/", v.Correction.as_view()),
    path("seller/orders/<uuid:pk>/extensions/", v.Extension.as_view()),
    path("seller/orders/<uuid:pk>/stock-plans/", v.StockPlan.as_view()),
    path("seller/orders/<uuid:pk>/stock-selection/", v.StockSelection.as_view()),
    path("<marketplace:context>/orders/<uuid:pk>/commands/<uuid:key>/", v.Command.as_view()),
    path("<marketplace:context>/orders/<uuid:pk>/commands/<uuid:key>/reconcile/", v.Settle.as_view()),
    path("<marketplace:context>/orders/<uuid:pk>/uploads/", v.Upload.as_view()),
    path("<marketplace:context>/evidence/<uuid:pk>/", v.Evidence.as_view()),
]
