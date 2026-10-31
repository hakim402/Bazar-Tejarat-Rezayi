from django.urls import path
from . import views as v

urlpatterns = [
    path("seller/profiles/", v.Profiles.as_view()),
    path("seller/checkout-terms/<uuid:pk>/", v.Terms.as_view()),
    path("buyer/review/", v.Review.as_view()),
    path("buyer/checkouts/", v.Checkouts.as_view()),
    path("buyer/checkouts/by-command/<uuid:pk>/", v.ByCommand.as_view()),
    path("buyer/checkouts/<uuid:pk>/", v.CheckoutDetail.as_view()),
    path("buyer/checkouts/<uuid:pk>/resume/", v.Resume.as_view()),
    path("<marketplace:context>/orders/", v.Orders.as_view()),
    path("<marketplace:context>/orders/<uuid:pk>/", v.OrderDetail.as_view()),
    path("<marketplace:context>/invoices/", v.Invoices.as_view()),
    path("<marketplace:context>/invoices/<uuid:pk>/", v.InvoiceDetail.as_view()),
    path("<marketplace:context>/invoices/<uuid:pk>/pdf/", v.PDF.as_view()),
    path("<marketplace:context>/invoices/<uuid:pk>/print/", v.Print.as_view()),
]
