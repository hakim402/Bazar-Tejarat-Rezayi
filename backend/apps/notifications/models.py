"""Durable personal notices and optional unread-email intents; no message previews."""

import uuid
from django.db import models
from django.utils import timezone
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
    aftercare_email = models.BooleanField(default=True)
    locale = models.CharField(max_length=5, default="fa-AF")
    version = models.PositiveIntegerField(default=1)


AFTER = dict(
    aftercare_event__isnull=True,
    payment_event__isnull=True,
    fulfilment_event__isnull=True,
    negotiation_event__isnull=True,
    order__isnull=True,
    message__isnull=True,
    report__isnull=True,
    report_version__isnull=True,
)


def EXCEPT(*keys):
    return {k: v for k, v in AFTER.items() if k not in keys}


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
            ("fulfilment", "Delivery and fulfilment activity"),
            ("aftercare", "Cancellation, amendment and refund activity"),
        ],
    )
    order = models.OneToOneField("orders.SellerOrder", null=True, on_delete=models.PROTECT, related_name="notice_event")
    fulfilment_event = models.OneToOneField("fulfilment.Event", null=True, on_delete=models.PROTECT)
    payment_event = models.OneToOneField("payments.Event", null=True, on_delete=models.PROTECT)
    aftercare_event = models.OneToOneField("orders.AftercareEvent", null=True, on_delete=models.PROTECT)
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
                    models.Q(kind="fulfilment", fulfilment_event__isnull=False, **EXCEPT("fulfilment_event__isnull"))
                    | models.Q(kind="payment", payment_event__isnull=False, **EXCEPT("payment_event__isnull"))
                    | models.Q(kind="negotiation", negotiation_event__isnull=False, **EXCEPT("negotiation_event__isnull"))
                    | models.Q(kind="order_accepted", order__isnull=False, **EXCEPT("order__isnull"))
                    | models.Q(kind="message", message__isnull=False, **EXCEPT("message__isnull"))
                    | models.Q(
                        kind="report_status", report__isnull=False, report_version__isnull=False, **EXCEPT("report__isnull", "report_version__isnull")
                    )
                    | models.Q(kind="aftercare", aftercare_event__isnull=False, **EXCEPT("aftercare_event__isnull"))
                    | models.Q(kind="aftercare", payment_event__isnull=False, **EXCEPT("payment_event__isnull"))
                    | models.Q(kind="aftercare", fulfilment_event__isnull=False, **EXCEPT("fulfilment_event__isnull"))
                ),
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
    fulfilment_order = models.ForeignKey(
        "orders.SellerOrder", null=True, on_delete=models.PROTECT, related_name="fulfilment_notices"
    )
    payment_order = models.ForeignKey(
        "orders.SellerOrder", null=True, on_delete=models.PROTECT, related_name="payment_notices"
    )
    aftercare_order = models.ForeignKey(
        "orders.SellerOrder", null=True, on_delete=models.PROTECT, related_name="aftercare_notices"
    )
    negotiation = models.ForeignKey("orders.Negotiation", null=True, on_delete=models.PROTECT)
    read_at = models.DateTimeField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["event", "account"], name="notifications_unique_recipient"),
            models.CheckConstraint(
                condition=(
                    models.Q(
                        fulfilment_order__isnull=False,
                        conversation__isnull=True,
                        order__isnull=True,
                        negotiation__isnull=True,
                        payment_order__isnull=True,
                        aftercare_order__isnull=True,
                    )
                    | models.Q(
                        payment_order__isnull=False,
                        conversation__isnull=True,
                        order__isnull=True,
                        negotiation__isnull=True,
                        fulfilment_order__isnull=True,
                        aftercare_order__isnull=True,
                    )
                    | models.Q(
                        aftercare_order__isnull=False,
                        conversation__isnull=True,
                        order__isnull=True,
                        negotiation__isnull=True,
                        fulfilment_order__isnull=True,
                        payment_order__isnull=True,
                    )
                    | models.Q(
                        negotiation__isnull=True,
                        order__isnull=True,
                        conversation__isnull=False,
                        fulfilment_order__isnull=True,
                        payment_order__isnull=True,
                        aftercare_order__isnull=True,
                    )
                    | models.Q(
                        negotiation__isnull=True,
                        order__isnull=False,
                        conversation__isnull=True,
                        fulfilment_order__isnull=True,
                        payment_order__isnull=True,
                        aftercare_order__isnull=True,
                    )
                    | models.Q(
                        negotiation__isnull=False,
                        order__isnull=True,
                        conversation__isnull=True,
                        fulfilment_order__isnull=True,
                        payment_order__isnull=True,
                        aftercare_order__isnull=True,
                    )
                ),
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


class AftercareNoticeCursor(models.Model):
    """Bounded durable aftercare fan-out; at most ten incomplete cursors per sweep."""

    event = models.OneToOneField(Event, primary_key=True, on_delete=models.PROTECT)
    sender = models.ForeignKey("accounts.User", null=True, on_delete=models.PROTECT)
    after_account = models.UUIDField(null=True)
    complete = models.BooleanField(default=False, db_index=True)
    version = models.PositiveBigIntegerField(default=0)


class AftercareEmail(models.Model):
    """Optional unread-aftercare email intent; no amounts or references are stored."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.ForeignKey("orders.SellerOrder", on_delete=models.PROTECT)
    account = models.ForeignKey("accounts.Account", on_delete=models.PROTECT)
    episode = models.UUIDField()
    identity_digest = models.CharField(max_length=64)
    status = models.CharField(max_length=18, choices=[(s, s.replace("_", " ")) for s in STATUSES], default="queued")
    attempts = models.PositiveSmallIntegerField(default=0)
    due_at = models.DateTimeField(default=timezone.now)
    lease_until = models.DateTimeField(null=True)
    lease = models.UUIDField(null=True)
    accepted_at = models.DateTimeField(null=True)
    version = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["order", "account", "episode"], name="notifications_aftercare_email")
        ]
        indexes = [models.Index(fields=["status", "due_at"], name="notifications_aftercare_due")]


class AftercareEmailAttempt(models.Model):
    email = models.ForeignKey(AftercareEmail, on_delete=models.PROTECT, related_name="delivery_attempts")
    status = models.CharField(max_length=18)
    code = models.CharField(max_length=32)
    created_at = models.DateTimeField(auto_now_add=True)
