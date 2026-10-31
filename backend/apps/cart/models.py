import uuid
from django.db import models
from django.db.models import Q


class Cart(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    account = models.OneToOneField("accounts.Account", null=True, on_delete=models.PROTECT)
    guest_key = models.UUIDField(null=True, unique=True, editable=False)
    consumed_by = models.ForeignKey(
        "accounts.Account", null=True, on_delete=models.PROTECT, related_name="merged_guest_carts"
    )
    version = models.PositiveBigIntegerField(default=0)
    expires_at = models.DateTimeField(null=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=(
                    Q(account__isnull=False, guest_key__isnull=True, expires_at__isnull=True, consumed_by__isnull=True)
                    | Q(account__isnull=True, guest_key__isnull=False, expires_at__isnull=False)
                ),
                name="cart_bound_identity",
            )
        ]


class CartLine(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    cart = models.ForeignKey(Cart, on_delete=models.CASCADE, related_name="lines")
    variant = models.ForeignKey("catalogue.Variant", on_delete=models.PROTECT)
    tier = models.CharField(max_length=9, choices=[("retail", "Retail"), ("wholesale", "Wholesale")])
    quantity = models.DecimalField(max_digits=12, decimal_places=3)
    version = models.PositiveBigIntegerField(default=1)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["cart", "variant", "tier"], name="cart_selection"),
            models.CheckConstraint(condition=Q(quantity__gt=0), name="cart_positive_quantity"),
            models.CheckConstraint(condition=Q(tier__in=["retail", "wholesale"]), name="cart_explicit_tier"),
        ]


class CartCommand(models.Model):
    cart = models.ForeignKey(Cart, on_delete=models.CASCADE)
    key = models.UUIDField()
    digest = models.CharField(max_length=64)
    outcome = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["cart", "key"], name="cart_command_identity")]


class MergeReceipt(models.Model):
    guest = models.OneToOneField(Cart, on_delete=models.PROTECT, related_name="merge_receipt")
    buyer = models.ForeignKey(Cart, on_delete=models.PROTECT, related_name="merges")
    key = models.UUIDField()
    outcome = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)
