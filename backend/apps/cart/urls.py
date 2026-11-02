from django.urls import path, re_path
from .views import CartView, Merge, Initialize, Reconcile

urlpatterns = [
    path("guest/initialize/", Initialize.as_view()),
    re_path(r"^(?P<context>guest|buyer)/commands/reconcile/$", Reconcile.as_view()),
    path("merge/", Merge.as_view()),
    re_path(r"^(?P<context>guest|buyer)/$", CartView.as_view()),
]
