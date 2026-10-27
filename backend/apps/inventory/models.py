"""Stock identities, bounded balances and an append-only authoritative movement ledger."""

import uuid
from django.conf import settings
from django.db import models
from django.db.models import Q, F
from django.core.exceptions import ValidationError


class AppendOnlyQuerySet(models.QuerySet):
    def update(self, **kwargs):
        raise ValidationError("Use a compensating inventory operation.")

    def delete(self):
        raise ValidationError("Inventory history cannot be deleted.")

    def bulk_update(self, *args, **kwargs):
        raise ValidationError("Inventory history cannot be rewritten.")


class ImmutableRecord(models.Model):
    objects = AppendOnlyQuerySet.as_manager()

    class Meta:
        abstract = True

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise ValidationError("Inventory history is immutable.")
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError("Inventory history cannot be deleted.")


class Position(models.Model):
    variant = models.OneToOneField(
        "catalogue.Variant", primary_key=True, on_delete=models.PROTECT, related_name="stock_position"
    )
    tracking = models.CharField(max_length=8, choices=[("plain", "Non-batch"), ("batch", "Batch")])
    expiry_required = models.BooleanField(default=False)
    threshold = models.DecimalField(max_digits=12, decimal_places=3, null=True, blank=True)
    version = models.PositiveIntegerField(default=1)

    class Meta:
        permissions = [("read_inventory", "Read inventory"), ("read_shortages", "Read inventory shortages")]
        constraints = [
            models.CheckConstraint(condition=Q(tracking__in=["plain", "batch"]), name="inventory_tracking"),
            models.CheckConstraint(
                condition=Q(expiry_required=False) | Q(tracking="batch"), name="inventory_batch_expiry"
            ),
            models.CheckConstraint(
                condition=Q(threshold__isnull=True) | Q(threshold__gte=0), name="inventory_threshold"
            ),
        ]


class Batch(ImmutableRecord):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    position = models.ForeignKey(Position, on_delete=models.PROTECT, related_name="batches")
    code = models.CharField(max_length=80)
    expires_on = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["position", "code"], name="inventory_batch_code")]
        indexes = [models.Index(fields=["expires_on"])]


class Bucket(models.Model):
    position = models.ForeignKey(Position, on_delete=models.PROTECT, related_name="buckets")
    batch = models.OneToOneField(Batch, null=True, on_delete=models.PROTECT, related_name="bucket")
    physical = models.DecimalField(max_digits=12, decimal_places=3, default=0)
    held = models.DecimalField(max_digits=12, decimal_places=3, default=0)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["position"], condition=Q(batch__isnull=True), name="inventory_plain_bucket"
            ),
            models.CheckConstraint(
                condition=Q(physical__gte=0) & Q(held__gte=0) & Q(held__lte=F("physical")), name="inventory_balance"
            ),
        ]


class Operation(ImmutableRecord):
    id = models.UUIDField(primary_key=True, editable=False)
    seller = models.ForeignKey("organizations.BusinessProfile", on_delete=models.PROTECT)
    action = models.CharField(max_length=12)
    reference = models.CharField(max_length=120, blank=True)
    fingerprint = models.CharField(max_length=64)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    account = models.ForeignKey("accounts.Account", on_delete=models.PROTECT)
    context = models.CharField(max_length=8)
    reason = models.CharField(max_length=1000)
    result = models.JSONField()
    parameters = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["seller", "action", "reference"], condition=~Q(reference=""), name="inventory_logical_operation"
            )
        ]
        indexes = [models.Index(fields=["seller", "-created_at"])]


class Movement(ImmutableRecord):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    operation = models.ForeignKey(Operation, on_delete=models.PROTECT, related_name="movements")
    bucket = models.ForeignKey(Bucket, on_delete=models.PROTECT, related_name="movements")
    physical_delta = models.DecimalField(max_digits=12, decimal_places=3)
    held_delta = models.DecimalField(max_digits=12, decimal_places=3)
    physical_after = models.DecimalField(max_digits=12, decimal_places=3)
    held_after = models.DecimalField(max_digits=12, decimal_places=3)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.CheckConstraint(condition=~Q(physical_delta=0, held_delta=0), name="inventory_movement_effect")
        ]
        indexes = [models.Index(fields=["bucket", "-created_at"])]


class Allocation(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    operation = models.OneToOneField(Operation, on_delete=models.PROTECT, related_name="allocation")
    state = models.CharField(
        max_length=8, default="held", choices=[("held", "Held"), ("released", "Released"), ("consumed", "Consumed")]
    )


class AllocationLine(ImmutableRecord):
    allocation = models.ForeignKey(Allocation, on_delete=models.PROTECT, related_name="lines")
    bucket = models.ForeignKey(Bucket, on_delete=models.PROTECT)
    quantity = models.DecimalField(max_digits=12, decimal_places=3)

    class Meta:
        constraints = [
            models.CheckConstraint(condition=Q(quantity__gt=0), name="inventory_allocation_positive"),
            models.UniqueConstraint(fields=["allocation", "bucket"], name="inventory_allocation_bucket"),
        ]


class Shortage(ImmutableRecord):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    operation = models.OneToOneField(Operation, on_delete=models.PROTECT, related_name="shortage")
    lines = models.JSONField()
    recovery_of = models.ForeignKey("self", null=True, on_delete=models.PROTECT)


class Recovery(ImmutableRecord):
    shortage = models.OneToOneField(Shortage, primary_key=True, on_delete=models.PROTECT)
    operation = models.OneToOneField(Operation, on_delete=models.PROTECT)
