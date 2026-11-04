"""Durable personal notices and optional unread-email intents; no message previews."""

import uuid
from django.db import models
from .managers import NoticeManager, EventManager

STATUSES = (
    "queued",
    "claimed",
    "dispatching",
    "captured",
    "smtp_accepted",
    "retry_due",
    "cancelled",
    "exhausted",
    "delivery_unknown",
)


class Preference(models.Model):
    account = models.OneToOneField("accounts.Account", primary_key=True, on_delete=models.PROTECT)
    message_email = models.BooleanField(default=True)
    payment_email = models.BooleanField(default=True)
    locale = models.CharField(max_length=5, default="fa-AF")
    version = models.PositiveIntegerField(default=1)


class Event(models.Model):
    objects = EventManager()
    construction = models.Manager()
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    kind = models.CharField(
        max_length=16,
        choices=[
            ("message", "New message"),
            ("report_status", "Report status"),
            ("order_accepted", "Order and invoice available"),
            ("negotiation", "Formal request activity"),
            ("payment", "Goods payment activity"),
        ],
    )
    order = models.OneToOneField("orders.SellerOrder", null=True, on_delete=models.PROTECT, related_name="notice_event")
    payment_event = models.OneToOneField("payments.Event", null=True, on_delete=models.PROTECT)
    negotiation_event = models.OneToOneField("orders.NegotiationEvent", null=True, on_delete=models.PROTECT)
    message = models.OneToOneField("messaging.Message", null=True, on_delete=models.PROTECT)
    report = models.ForeignKey("messaging.Report", null=True, on_delete=models.PROTECT)
    report_version = models.PositiveIntegerField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["report", "report_version"], name="notifications_report_version"),
            models.CheckConstraint(
                condition=(
                    models.Q(kind="payment", payment_event__isnull=False, negotiation_event__isnull=True, order__isnull=True, message__isnull=True, report__isnull=True, report_version__isnull=True) | models.Q(payment_event__isnull=True) & (
                    models.Q(kind="negotiation", negotiation_event__isnull=False, order__isnull=True, message__isnull=True, report__isnull=True, report_version__isnull=True) |
                    models.Q(
                        negotiation_event__isnull=True, kind="order_accepted",
                        order__isnull=False,
                        message__isnull=True,
                        report__isnull=True,
                        report_version__isnull=True,
                    )
                    | models.Q(
                        negotiation_event__isnull=True, kind="message",
                        order__isnull=True,
                        message__isnull=False,
                        report__isnull=True,
                        report_version__isnull=True,
                    )
                    | models.Q(
                        negotiation_event__isnull=True, kind="report_status",
                        order__isnull=True,
                        message__isnull=True,
                        report__isnull=False,
                        report_version__isnull=False,
                    )
                )),
                name="notifications_typed_event",
            ),
        ]


class Notice(models.Model):
    objects = NoticeManager()
    construction = models.Manager()
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey(Event, on_delete=models.PROTECT)
    account = models.ForeignKey("accounts.Account", on_delete=models.PROTECT)
    conversation = models.ForeignKey("messaging.Conversation", null=True, on_delete=models.PROTECT)
    order = models.ForeignKey("orders.SellerOrder", null=True, on_delete=models.PROTECT)
    payment_order = models.ForeignKey("orders.SellerOrder", null=True, on_delete=models.PROTECT, related_name="payment_notices")
    negotiation = models.ForeignKey("orders.Negotiation", null=True, on_delete=models.PROTECT)
    read_at = models.DateTimeField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["event", "account"], name="notifications_unique_recipient"),
            models.CheckConstraint(
                condition=(
                    models.Q(payment_order__isnull=False,negotiation__isnull=True,order__isnull=True,conversation__isnull=True) | models.Q(payment_order__isnull=True) & (
                    models.Q(negotiation__isnull=True, order__isnull=True, conversation__isnull=False)
                    | models.Q(negotiation__isnull=True, order__isnull=False, conversation__isnull=True) | models.Q(negotiation__isnull=False, order__isnull=True, conversation__isnull=True)
                )),
                name="notifications_typed_resource",
            ),
        ]
        indexes = [models.Index(fields=["account", "-created_at", "id"], name="notifications_personal_list")]


class Outbox(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    conversation = models.ForeignKey("messaging.Conversation", on_delete=models.PROTECT)
    account = models.ForeignKey("accounts.Account", on_delete=models.PROTECT)
    episode = models.PositiveBigIntegerField()
    identity_digest = models.CharField(max_length=64)
    status = models.CharField(max_length=18, choices=[(s, s.replace("_", " ")) for s in STATUSES], default="queued")
    attempts = models.PositiveSmallIntegerField(default=0)
    due_at = models.DateTimeField()
    lease_until = models.DateTimeField(null=True)
    claim = models.UUIDField(null=True)
    accepted_at = models.DateTimeField(null=True)
    version = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        permissions = [
            ("view_delivery", "View communication delivery diagnostics"),
            ("retry_delivery", "Retry uncertain communication delivery"),
        ]
        constraints = [
            models.UniqueConstraint(fields=["conversation", "account", "episode"], name="notifications_unique_episode")
        ]
        indexes = [
            models.Index(fields=["status", "due_at"], name="notifications_due_work"),
            models.Index(fields=["status", "lease_until"], name="notifications_leases"),
        ]


class Attempt(models.Model):
    outbox = models.ForeignKey(Outbox, on_delete=models.PROTECT, related_name="delivery_attempts")
    status = models.CharField(max_length=18)
    code = models.CharField(max_length=32)
    created_at = models.DateTimeField(auto_now_add=True)


class OrderNoticeCursor(models.Model):
    """Bounded durable in-app fan-out, unrelated to optional message email."""

    event = models.OneToOneField(Event, primary_key=True, on_delete=models.PROTECT)
    sender = models.ForeignKey("accounts.User", on_delete=models.PROTECT)
    after_account = models.UUIDField(null=True)
    complete = models.BooleanField(default=False, db_index=True)
    version = models.PositiveBigIntegerField(default=0)
