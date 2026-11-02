from django.db import connection, models
from django.db.models import Q
from apps.orders.managers import accepted


class NoticeManager(models.Manager):
    def get_queryset(self):
        qs = super().get_queryset()
        if connection.vendor == "mysql":
            qs = qs.filter(Q(order__isnull=True) | accepted("order__")).filter(
                Q(negotiation__isnull=True) | Q(negotiation__outcome__state="submitted"))
        return qs


class EventManager(models.Manager):
    def get_queryset(self):
        qs = super().get_queryset()
        if connection.vendor == "mysql":
            qs = qs.filter(Q(order__isnull=True) | accepted("order__")).filter(
                Q(negotiation_event__isnull=True) | Q(negotiation_event__request__outcome__state="submitted"))
        return qs
