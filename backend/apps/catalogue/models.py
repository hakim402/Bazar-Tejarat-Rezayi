"""Catalogue identities, immutable structural revisions and independent commercial history."""

import uuid
from django.conf import settings
from django.db import models
from django.db.models import Q
from django.core.exceptions import ValidationError

LOCALES = ("fa-AF", "en", "ps", "ar")
PERMISSIONS = ("manage_taxonomy", "review_source", "review_translation", "moderate_catalogue")


class SaleUnit(models.Model):
    version = models.PositiveIntegerField(default=1)
    code = models.SlugField(primary_key=True, max_length=16)
    labels = models.JSONField()
    fractional = models.BooleanField(default=False)
    active = models.BooleanField(default=True)

    def __str__(self):
        return self.code


class Category(models.Model):
    code = models.SlugField(primary_key=True, max_length=40)
    parent = models.ForeignKey("self", null=True, blank=True, on_delete=models.PROTECT)
    labels = models.JSONField()
    attributes = models.JSONField(default=list)
    units = models.ManyToManyField(SaleUnit)
    active = models.BooleanField(default=True)
    version = models.PositiveIntegerField(default=1)

    def __str__(self):
        return self.code


class Product(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    seller = models.ForeignKey("organizations.BusinessProfile", on_delete=models.PROTECT)
    currency = models.CharField(max_length=3, choices=[(x, x) for x in ("AFN", "USD")])
    pricing_mode = models.CharField(max_length=12, choices=[(x, x) for x in ("fixed", "negotiable")])
    version = models.PositiveIntegerField(default=1)
    published = models.ForeignKey("SourceRevision", null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        permissions = [(x, x.replace("_", " ")) for x in PERMISSIONS]
        constraints = [
            models.CheckConstraint(condition=Q(currency__in=["AFN", "USD"]), name="catalogue_currency"),
            models.CheckConstraint(condition=Q(pricing_mode__in=["fixed", "negotiable"]), name="catalogue_mode"),
        ]

    def save(self, *args, **kwargs):
        if self._state.adding and self.published_id is not None:
            raise ValidationError("Publish through the guarded transition service.")
        if not self._state.adding:
            old = type(self).objects.get(pk=self.pk)
            if old.published_id != self.published_id and not getattr(self, "_allow_catalogue_transition", False):
                raise ValidationError("Publish through the guarded transition service.")
            if any(getattr(old, key) != getattr(self, key) for key in ("seller_id", "currency", "pricing_mode")):
                raise ValidationError("Product identity and commercial grouping are immutable.")
        return super().save(*args, **kwargs)

    def __str__(self):
        return str(self.id)


class Variant(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    product = models.ForeignKey(Product, on_delete=models.PROTECT, related_name="variants")
    sku = models.CharField(max_length=64)
    definition = models.JSONField()
    unit = models.ForeignKey(SaleUnit, on_delete=models.PROTECT)
    quantity_increment = models.DecimalField(max_digits=12, decimal_places=3)
    minimum_wholesale = models.DecimalField(max_digits=12, decimal_places=3)
    retail = models.DecimalField(max_digits=11, decimal_places=2, null=True, blank=True)
    wholesale = models.DecimalField(max_digits=11, decimal_places=2, null=True, blank=True)

    def save(self, *args, **kwargs):
        if not self._state.adding:
            old = type(self).objects.get(pk=self.pk)
            if any(
                getattr(old, key) != getattr(self, key)
                for key in ("product_id", "sku", "definition", "unit_id", "quantity_increment", "minimum_wholesale")
            ):
                raise ValidationError("Create a new variant identity for structural changes.")
        return super().save(*args, **kwargs)

    class Meta:
        constraints = [
            models.CheckConstraint(condition=Q(quantity_increment__gt=0), name="catalogue_positive_increment"),
            models.CheckConstraint(condition=Q(minimum_wholesale__gt=0), name="catalogue_positive_minimum"),
            models.UniqueConstraint(fields=["product", "sku"], name="catalogue_product_sku"),
            models.CheckConstraint(
                condition=Q(retail__isnull=True) | Q(retail__gt=0), name="catalogue_positive_retail"
            ),
            models.CheckConstraint(
                condition=Q(wholesale__isnull=True) | Q(wholesale__gt=0), name="catalogue_positive_wholesale"
            ),
            models.CheckConstraint(
                condition=Q(retail__isnull=False) | Q(wholesale__isnull=False), name="catalogue_one_price"
            ),
        ]


class SourceRevision(models.Model):
    category = models.ForeignKey(Category, on_delete=models.PROTECT)
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    product = models.ForeignKey(Product, on_delete=models.PROTECT, related_name="revisions")
    number = models.PositiveIntegerField()
    body = models.JSONField()
    state = models.CharField(
        max_length=12,
        default="draft",
        choices=[(x, x) for x in ("draft", "submitted", "published", "rejected", "withdrawn")],
    )
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    reason = models.CharField(max_length=1000, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def save(self, *args, **kwargs):
        if self._state.adding and self.state != "draft":
            raise ValidationError("Create a draft before a review transition.")
        if not self._state.adding:
            old = type(self).objects.get(pk=self.pk)
            if old.state != self.state and not getattr(self, "_allow_catalogue_transition", False):
                raise ValidationError("Use the guarded source transition service.")
            if any(
                getattr(old, key) != getattr(self, key)
                for key in ("product_id", "category_id", "number", "body", "author_id")
            ):
                raise ValidationError("Source revision content is immutable.")
        return super().save(*args, **kwargs)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["product", "number"], name="catalogue_revision_number"),
            models.UniqueConstraint(
                fields=["product"], condition=Q(state="submitted"), name="catalogue_one_submission"
            ),
        ]


class ProductImage(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    product = models.ForeignKey(Product, on_delete=models.PROTECT, related_name="images")
    storage_alias = models.CharField(max_length=32)
    key = models.CharField(max_length=200)
    content_type = models.CharField(max_length=32)
    width = models.PositiveIntegerField()
    height = models.PositiveIntegerField()
    size = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    def save(self, *args, **kwargs):
        if not self._state.adding:
            old = type(self).objects.get(pk=self.pk)
            if any(
                getattr(old, k) != getattr(self, k)
                for k in ("product_id", "storage_alias", "key", "content_type", "width", "height", "size")
            ):
                raise ValidationError("Uploaded image records are immutable.")
        return super().save(*args, **kwargs)


class PriceChange(models.Model):
    product = models.ForeignKey(Product, on_delete=models.PROTECT, related_name="price_history")
    variant = models.ForeignKey(Variant, on_delete=models.PROTECT)
    retail = models.DecimalField(max_digits=11, decimal_places=2, null=True)
    wholesale = models.DecimalField(max_digits=11, decimal_places=2, null=True)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    product_version = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)


class Translation(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    revision = models.ForeignKey(SourceRevision, on_delete=models.PROTECT, related_name="translations")
    locale = models.CharField(max_length=5, choices=[(x, x) for x in LOCALES])
    title = models.CharField(max_length=200, blank=True)
    description = models.TextField(blank=True)
    image_alts = models.JSONField(default=dict)
    version = models.PositiveIntegerField(default=1)
    state = models.CharField(
        max_length=12, default="draft", choices=[(x, x) for x in ("draft", "approved", "rejected")]
    )
    human_edited = models.BooleanField(default=False)
    approved_body = models.JSONField(null=True, blank=True)
    reason = models.CharField(max_length=1000, blank=True)

    def save(self, *args, **kwargs):
        old = type(self).objects.filter(pk=self.pk).first() if not self._state.adding else None
        if old and (old.revision_id != self.revision_id or old.locale != self.locale):
            raise ValidationError("Translation source and target identities are immutable.")
        if self.approved_body != (old.approved_body if old else None) and not getattr(
            self, "_allow_catalogue_review", False
        ):
            raise ValidationError("Approve translations through the review service.")
        return super().save(*args, **kwargs)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["revision", "locale"], name="catalogue_translation_target")]


class TranslationJob(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    translation = models.OneToOneField(Translation, on_delete=models.PROTECT, related_name="job")
    expected_version = models.PositiveIntegerField()
    status = models.CharField(max_length=16, default="queued")
    attempts = models.PositiveSmallIntegerField(default=0)
    next_attempt_at = models.DateTimeField()
    error_code = models.CharField(max_length=32, blank=True)
    lease = models.UUIDField(null=True)
    input_chars = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)


class TranslationBudget(models.Model):
    day = models.DateField(primary_key=True)
    calls = models.PositiveIntegerField(default=0)
    characters = models.PositiveIntegerField(default=0)


class CatalogueEvent(models.Model):
    translation = models.ForeignKey(Translation, null=True, blank=True, on_delete=models.PROTECT)
    translation_version = models.PositiveIntegerField(default=0)
    product = models.ForeignKey(Product, null=True, on_delete=models.PROTECT, related_name="events")
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.PROTECT)
    account = models.ForeignKey("accounts.Account", null=True, on_delete=models.PROTECT)
    context = models.CharField(max_length=8)
    action = models.CharField(max_length=32)
    revision = models.ForeignKey(SourceRevision, null=True, on_delete=models.PROTECT)
    version = models.PositiveIntegerField(default=0)
    reason = models.CharField(max_length=1000, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
