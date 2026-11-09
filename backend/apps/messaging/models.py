"""Retained communication identities. Database triggers protect immutable content."""

import uuid
from django.db import models
from django.db.models import Q
from .managers import MessageManager

PERMISSIONS = ("read_message_case", "assign_message_case", "resolve_message_case", "reopen_message_case")


class Conversation(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    buyer = models.ForeignKey("accounts.Account", on_delete=models.PROTECT, related_name="enquiries")
    seller = models.ForeignKey("organizations.BusinessProfile", on_delete=models.PROTECT, related_name="conversations")
    product = models.ForeignKey("catalogue.Product", on_delete=models.PROTECT, related_name="conversations")
    snapshot = models.JSONField()
    sequence = models.PositiveBigIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["buyer", "seller", "product"], name="messaging_unique_product_thread")
        ]
        indexes = [
            models.Index(fields=["buyer", "-updated_at", "id"], name="messaging_buyer_inbox"),
            models.Index(fields=["seller", "-updated_at", "id"], name="messaging_seller_inbox"),
        ]

    def __str__(self):
        return str(self.pk)


class Message(models.Model):
    objects = MessageManager()
    construction = models.Manager()
    published = models.BooleanField(default=True)
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    conversation = models.ForeignKey(Conversation, on_delete=models.PROTECT, related_name="messages")
    sequence = models.PositiveBigIntegerField()
    author = models.ForeignKey("accounts.Account", on_delete=models.PROTECT, related_name="messages")
    context = models.CharField(max_length=6, choices=[("buyer", "Buyer"), ("seller", "Seller")])
    author_label = models.CharField(max_length=150)
    body = models.TextField(blank=True, max_length=6000)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["conversation", "sequence"], name="messaging_message_sequence"),
            models.CheckConstraint(condition=Q(sequence__gte=1), name="messaging_positive_sequence"),
            models.CheckConstraint(condition=Q(context__in=["buyer", "seller"]), name="messaging_author_context"),
        ]
        indexes = [models.Index(fields=["conversation", "-sequence"], name="messaging_history")]

    def __str__(self):
        return str(self.pk)


class Attachment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    product = models.ForeignKey("catalogue.Product", on_delete=models.PROTECT)
    conversation = models.ForeignKey(Conversation, on_delete=models.PROTECT, null=True, related_name="attachments")
    creator = models.ForeignKey("accounts.Account", on_delete=models.PROTECT)
    message = models.ForeignKey(Message, on_delete=models.PROTECT, null=True, related_name="attachments")
    storage_alias = models.CharField(max_length=32, default="private_local")
    key = models.CharField(max_length=500, unique=True)
    content_type = models.CharField(max_length=32, default="image/jpeg")
    size = models.PositiveIntegerField()
    sha256 = models.CharField(max_length=64)
    width = models.PositiveIntegerField()
    height = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(null=True)

    class Meta:
        indexes = [
            models.Index(fields=["expires_at"], condition=Q(message__isnull=True), name="messaging_unbound_expiry")
        ]

    def __str__(self):
        return str(self.pk)


class Command(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    account = models.ForeignKey("accounts.Account", on_delete=models.PROTECT)
    action = models.CharField(max_length=80)
    key = models.UUIDField()
    digest = models.CharField(max_length=64)
    outcome = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["account", "action", "key"], name="messaging_unique_command")]


class ReadState(models.Model):
    conversation = models.ForeignKey(Conversation, on_delete=models.PROTECT, related_name="read_states")
    account = models.ForeignKey("accounts.Account", on_delete=models.PROTECT)
    last_read = models.PositiveBigIntegerField(default=0)
    latest_incoming = models.PositiveBigIntegerField(default=0)
    episode = models.PositiveBigIntegerField(default=0)
    last_emailed_at = models.DateTimeField(null=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["conversation", "account"], name="messaging_personal_read")]
        indexes = [models.Index(fields=["account", "conversation"], name="messaging_personal_inbox")]


class Report(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    message = models.ForeignKey(Message, null=True, blank=True, on_delete=models.PROTECT, related_name="reports")
    product = models.ForeignKey("catalogue.Product", null=True, blank=True, on_delete=models.PROTECT, related_name="reports")
    store = models.ForeignKey("marketplace.Store", null=True, blank=True, on_delete=models.PROTECT, related_name="reports")
    order = models.ForeignKey("orders.SellerOrder", null=True, blank=True, on_delete=models.PROTECT, related_name="reports")
    reporter = models.ForeignKey("accounts.Account", on_delete=models.PROTECT, related_name="message_reports")
    category = models.CharField(
        max_length=16,
        choices=[("abuse", "Abuse"), ("fraud", "Fraud"), ("spam", "Spam"), ("privacy", "Privacy"), ("other", "Other")],
    )
    reason = models.CharField(max_length=1000)
    status = models.CharField(max_length=10, default="open", choices=[("open", "Open"), ("resolved", "Resolved")])
    assigned_to = models.ForeignKey(
        "accounts.Account", null=True, blank=True, on_delete=models.PROTECT, related_name="assigned_message_reports"
    )
    version = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        permissions = [(p, p.replace("_", " ").capitalize()) for p in PERMISSIONS]
        indexes = [models.Index(fields=["assigned_to", "status", "-created_at"], name="messaging_assigned_cases")]
        constraints = [
            models.CheckConstraint(
                condition=(
                    Q(message__isnull=False, product__isnull=True, store__isnull=True, order__isnull=True)
                    | Q(message__isnull=True, product__isnull=False, store__isnull=True, order__isnull=True)
                    | Q(message__isnull=True, product__isnull=True, store__isnull=False, order__isnull=True)
                    | Q(message__isnull=True, product__isnull=True, store__isnull=True, order__isnull=False)
                ),
                name="messaging_report_target",
            )
        ]

    @property
    def target_kind(self):
        if self.message_id is not None:
            return "message"
        if self.product_id is not None:
            return "product"
        if self.store_id is not None:
            return "store"
        return "order"

    def __str__(self):
        return str(self.pk)


class CaseEvent(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    report = models.ForeignKey(Report, on_delete=models.PROTECT, related_name="events")
    actor = models.ForeignKey("accounts.User", on_delete=models.PROTECT)
    action = models.CharField(max_length=16)
    reason = models.CharField(max_length=1000)
    version = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)


class CaseAccess(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    report = models.ForeignKey(Report, on_delete=models.PROTECT, related_name="accesses")
    conversation = models.ForeignKey(Conversation, on_delete=models.PROTECT)
    actor = models.ForeignKey("accounts.User", on_delete=models.PROTECT)
    context = models.CharField(max_length=5)
    action = models.CharField(max_length=16)
    target = models.UUIDField()
    created_at = models.DateTimeField(auto_now_add=True)
