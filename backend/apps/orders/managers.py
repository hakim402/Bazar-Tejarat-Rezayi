from django.db import connection, models
from django.db.models import Q


def accepted(prefix=""):
    return Q(**{prefix + "outcome__state": "accepted"}) | Q(**{prefix + "negotiation__state": "accepted"})


class AgreementManager(models.Manager):
    def get_queryset(self):
        qs = super().get_queryset()
        return qs.filter(accepted()) if connection.vendor == "mysql" else qs


class AgreementChildManager(models.Manager):
    def get_queryset(self):
        qs = super().get_queryset()
        return qs.filter(accepted("order__")) if connection.vendor == "mysql" else qs


class RequestManager(models.Manager):
    def get_queryset(self):
        qs = super().get_queryset()
        return qs.filter(outcome__state="submitted") if connection.vendor == "mysql" else qs


class AgreementEventManager(models.Manager):
    def get_queryset(self):
        qs = super().get_queryset()
        return qs.filter(Q(order__isnull=True) | accepted("order__")) if connection.vendor == "mysql" else qs


class RequestChildManager(models.Manager):
    def get_queryset(self):
        qs = super().get_queryset()
        return qs.filter(request__outcome__state="submitted") if connection.vendor == "mysql" else qs
