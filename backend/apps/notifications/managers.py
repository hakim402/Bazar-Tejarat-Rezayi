from django.db import connection, models
from django.db.models import Q
from apps.orders.managers import accepted


class NoticeManager(models.Manager):
    def get_queryset(self):
        qs = super().get_queryset()
        if connection.vendor == "mysql":
            qs = (
                qs.filter(Q(payment_order__isnull=True) | accepted("payment_order__"))
                .filter(Q(order__isnull=True) | accepted("order__"))
                .filter(Q(negotiation__isnull=True) | Q(negotiation__outcome__state="submitted"))
            )
        return qs.filter(
            Q(event__fulfilment_event__isnull=True) | Q(event__fulfilment_event__publication__isnull=False)
        )


class EventManager(models.Manager):
    def get_queryset(self):
        qs = super().get_queryset()
        if connection.vendor == "mysql":
            qs = (
                qs.filter(Q(payment_event__isnull=True) | accepted("payment_event__order__"))
                .filter(Q(order__isnull=True) | accepted("order__"))
                .filter(Q(negotiation_event__isnull=True) | Q(negotiation_event__request__outcome__state="submitted"))
            )
        return qs.filter(Q(fulfilment_event__isnull=True) | Q(fulfilment_event__publication__isnull=False))
