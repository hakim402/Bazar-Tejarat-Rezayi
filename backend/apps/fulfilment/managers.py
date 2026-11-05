from django.db import models


class PublishedEventManager(models.Manager):
    def get_queryset(self):
        return super().get_queryset().filter(publication__isnull=False)


class PublishedFactManager(models.Manager):
    def get_queryset(self):
        return super().get_queryset().filter(event__publication__isnull=False)
