"""Optional reviewed store content. Business and catalogue authority stay in their domains."""

import uuid
from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q

PERMISSIONS = ("view_store_queue", "read_store_submission", "assign_store_review", "review_store", "moderate_store")
STATES = ("draft", "submitted", "approved", "rejected", "withdrawn")


class ProtectedQuerySet(models.QuerySet):
    def bulk_create(self, *args, **kwargs):
        raise ValidationError("Use the guarded storefront service.")

    def update(self, **kwargs):
        raise ValidationError("Use the guarded storefront service.")

    def delete(self):
        raise ValidationError("Storefront history is retained.")

    def bulk_update(self, *args, **kwargs):
        raise ValidationError("Use the guarded storefront service.")


class GuardedRecord(models.Model):
    objects = ProtectedQuerySet.as_manager()

    class Meta:
        abstract = True

    def save(self, *args, **kwargs):
        if not getattr(self, "_store_transition", False):
            raise ValidationError("Use the guarded storefront service.")
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError("Storefront history is retained.")


class Store(GuardedRecord):
    profile = models.OneToOneField("organizations.BusinessProfile", primary_key=True, on_delete=models.PROTECT, related_name="public_store")
    version = models.PositiveIntegerField(default=0)
    published = models.ForeignKey("StoreRevision", null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    def save(self, *args, **kwargs):
        if self.published_id and not StoreRevision.objects.filter(pk=self.published_id, store_id=self.pk, state="approved").exists():
            raise ValidationError("Publication requires this store's approved revision.")
        return super().save(*args, **kwargs)

    class Meta:
        permissions = [(code, code.replace("_", " ")) for code in PERMISSIONS]

    def __str__(self):
        return str(self.profile_id)


class StoreRevision(GuardedRecord):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    store = models.ForeignKey(Store, on_delete=models.PROTECT, related_name="revisions")
    number = models.PositiveIntegerField()
    business_case = models.ForeignKey("verification.ReviewCase", on_delete=models.PROTECT)
    body = models.JSONField()
    state = models.CharField(max_length=12, default="draft", choices=[(state, state) for state in STATES])
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    assigned_to = models.ForeignKey("accounts.Account", null=True, blank=True, on_delete=models.PROTECT)
    reason = models.CharField(max_length=1000, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def save(self, *args, **kwargs):
        if not self._state.adding:
            old = type(self).objects.get(pk=self.pk)
            if any(getattr(old, key) != getattr(self, key) for key in ("store_id", "number", "business_case_id", "body", "author_id")):
                raise ValidationError("Submitted store content is immutable; save a new revision.")
        return super().save(*args, **kwargs)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["store", "number"], name="marketplace_revision_number"),
            models.UniqueConstraint(fields=["store"], condition=Q(state="submitted"), name="marketplace_one_submission"),
            models.CheckConstraint(condition=Q(state__in=STATES), name="marketplace_revision_state"),
        ]
        indexes = [models.Index(fields=["state", "-created_at"])]

    def __str__(self):
        return f"{self.store_id} / {self.number} / {self.state}"


class StoreMedia(GuardedRecord):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    store = models.ForeignKey(Store, on_delete=models.PROTECT, related_name="media")
    storage_alias = models.CharField(max_length=32)
    key = models.CharField(max_length=200)
    content_type = models.CharField(max_length=32)
    width = models.PositiveIntegerField()
    height = models.PositiveIntegerField()
    size = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise ValidationError("Store uploads are immutable.")
        return super().save(*args, **kwargs)


class StoreEvent(GuardedRecord):
    store = models.ForeignKey(Store, on_delete=models.PROTECT, related_name="events")
    revision = models.ForeignKey(StoreRevision, null=True, on_delete=models.PROTECT)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    account = models.ForeignKey("accounts.Account", null=True, on_delete=models.PROTECT)
    context = models.CharField(max_length=8)
    action = models.CharField(max_length=32)
    version = models.PositiveIntegerField()
    reason = models.CharField(max_length=1000, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise ValidationError("Store audit events are immutable.")
        return super().save(*args, **kwargs)


class FeaturedStore(GuardedRecord):
    id = models.PositiveSmallIntegerField(primary_key=True, default=1, editable=False)
    profile = models.ForeignKey("organizations.BusinessProfile", null=True, blank=True, on_delete=models.PROTECT)
    version = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = [models.CheckConstraint(condition=Q(id=1), name="marketplace_feature_singleton")]
