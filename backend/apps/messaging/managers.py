from django.db import connection, models


class MessageManager(models.Manager):
    def get_queryset(self):
        qs = super().get_queryset()
        return qs.filter(published=True) if connection.vendor == "mysql" else qs

    def create(self, **kwargs):
        if connection.vendor == "mysql":
            kwargs["published"] = False
        return super().create(**kwargs)
