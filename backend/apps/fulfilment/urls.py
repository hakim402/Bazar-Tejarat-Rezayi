from django.urls import path
from . import views as v

urlpatterns = [
    path("seller/profiles/", v.Profiles.as_view()),
    path("<marketplace:context>/orders/", v.Orders.as_view()),
    path("<marketplace:context>/orders/<uuid:pk>/", v.Detail.as_view()),
    path("<marketplace:context>/orders/<uuid:pk>/history/", v.History.as_view()),
    path("<marketplace:context>/orders/<uuid:pk>/recipient/", v.Recipient.as_view()),
    path("<marketplace:context>/orders/<uuid:pk>/arrangement/", v.Arrangement.as_view()),
    path("<marketplace:context>/orders/<uuid:pk>/prepare/", v.Prepare.as_view()),
    path("<marketplace:context>/orders/<uuid:pk>/partial-authorization/", v.Partial.as_view()),
    path("<marketplace:context>/orders/<uuid:pk>/charges/", v.Charge.as_view()),
    path("<marketplace:context>/orders/<uuid:pk>/claims/", v.Claim.as_view()),
    path("<marketplace:context>/orders/<uuid:pk>/claims/withdraw/", v.Withdraw.as_view()),
    path("<marketplace:context>/orders/<uuid:pk>/corrections/", v.Correction.as_view()),
    path("<marketplace:context>/orders/<uuid:pk>/delivery-refunds/", v.DeliveryRefund.as_view()),
    path("<marketplace:context>/orders/<uuid:pk>/dispatch/review/", v.Preview.as_view()),
    path("<marketplace:context>/orders/<uuid:pk>/dispatch/", v.Dispatch.as_view()),
    path("<marketplace:context>/orders/<uuid:pk>/tracking/", v.Tracking.as_view()),
    path("<marketplace:context>/orders/<uuid:pk>/deliver/", v.Deliver.as_view()),
    path("<marketplace:context>/orders/<uuid:pk>/stock-options/", v.StockOptions.as_view()),
    path("<marketplace:context>/orders/<uuid:pk>/lines/<uuid:line_id>/image/", v.LineImage.as_view()),
    path("<marketplace:context>/orders/<uuid:pk>/handover/", v.Handover.as_view()),
    path("<marketplace:context>/orders/<uuid:pk>/uploads/", v.Upload.as_view()),
    path("<marketplace:context>/orders/<uuid:pk>/commands/<uuid:key>/", v.Command.as_view()),
    path("<marketplace:context>/orders/<uuid:pk>/commands/<uuid:key>/reconcile/", v.Reconcile.as_view()),
    path("<marketplace:context>/evidence/<uuid:pk>/", v.Evidence.as_view()),
]
