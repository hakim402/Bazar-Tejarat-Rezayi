"""Manual goods-payment facts. Claims/review, money, stock and deadlines are separate."""

import uuid
from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils import timezone
from .managers import ReceiptManager, PlanManager, EventManager

PROTECT = models.PROTECT
PERMISSIONS = [
    ("read_payments", "Inspect assigned payment metadata"),
    ("read_payment_evidence", "Inspect assigned private payment evidence"),
    ("assign_payment_case", "Assign independent payment reviewers"),
    ("review_payment", "Review seller-confirmed receipt evidence"),
    ("decide_payment_correction", "Decide independent receipt corrections"),
    ("decide_payment_shortage", "Decide shortage replacement/review referrals"),
    ("review_overdue", "Review assigned overdue and zero-balance cases"),
    ("read_payment_delivery", "Inspect payment delivery diagnostics"),
]


class Finance(models.Model):
    order = models.OneToOneField("orders.SellerOrder", primary_key=True, on_delete=PROTECT, related_name="finance")
    version = models.PositiveBigIntegerField(default=0)
    next_check_at = models.DateTimeField(default=timezone.now, db_index=True)
    checked_at = models.DateTimeField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        permissions = PERMISSIONS


class Event(models.Model):
    objects = EventManager()
    construction = models.Manager()
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.ForeignKey("orders.SellerOrder", on_delete=PROTECT, related_name="payment_events")
    version = models.PositiveBigIntegerField()
    action = models.CharField(max_length=32)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=PROTECT)
    account = models.ForeignKey("accounts.Account", null=True, on_delete=PROTECT)
    context = models.CharField(max_length=6)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["order", "version"], name="payments_event_version")]
        indexes = [models.Index(fields=["order", "-created_at", "id"], name="payments_event_history")]


class Command(models.Model):
    id = models.UUIDField(primary_key=True, editable=False)
    event = models.OneToOneField(Event, null=True, on_delete=PROTECT)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=PROTECT)
    account = models.ForeignKey("accounts.Account", null=True, on_delete=PROTECT, related_name="payment_commands")
    context = models.CharField(max_length=6)
    order = models.ForeignKey("orders.SellerOrder", on_delete=PROTECT)
    action = models.CharField(max_length=32)
    digest = models.CharField(max_length=64)
    result = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)


class Claim(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.ForeignKey("orders.SellerOrder", on_delete=PROTECT, related_name="payment_claims")
    actor = models.ForeignKey("accounts.Account", on_delete=PROTECT)
    event = models.OneToOneField(Event, on_delete=PROTECT)
    previous = models.OneToOneField("self", null=True, on_delete=PROTECT, related_name="replacement")
    amount = models.DecimalField(max_digits=24, decimal_places=2)
    currency = models.CharField(max_length=3)
    paid_at = models.DateTimeField()
    description = models.CharField(max_length=500)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.CheckConstraint(condition=Q(amount__gt=0, currency__in=["AFN", "USD"]), name="payments_claim_values")
        ]
        indexes = [models.Index(fields=["order", "-created_at"], name="payments_claim_queue")]


class ClaimDecision(models.Model):
    claim = models.OneToOneField(Claim, primary_key=True, on_delete=PROTECT, related_name="decision")
    event = models.OneToOneField(Event, on_delete=PROTECT)
    actor = models.ForeignKey("accounts.Account", on_delete=PROTECT)
    action = models.CharField(max_length=10)
    reason = models.CharField(max_length=1000)
    version = models.PositiveBigIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)


class Receipt(models.Model):
    objects = ReceiptManager()
    construction = models.Manager()
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.ForeignKey("orders.SellerOrder", on_delete=PROTECT, related_name="goods_receipts")
    claim = models.OneToOneField(Claim, null=True, on_delete=PROTECT, related_name="receipt")
    actor = models.ForeignKey("accounts.Account", on_delete=PROTECT)
    event = models.OneToOneField(Event, on_delete=PROTECT)
    amount = models.DecimalField(max_digits=24, decimal_places=2)
    currency = models.CharField(max_length=3)
    paid_at = models.DateTimeField()
    description = models.CharField(max_length=500)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(amount__gt=0, currency__in=["AFN", "USD"]), name="payments_receipt_values"
            )
        ]
        indexes = [models.Index(fields=["order", "-created_at", "id"], name="payments_receipt_history")]


class ReceiptSeal(models.Model):
    receipt = models.OneToOneField(Receipt, primary_key=True, on_delete=PROTECT, related_name="seal")
    created_at = models.DateTimeField(auto_now_add=True)


class Correction(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    receipt = models.ForeignKey(Receipt, on_delete=PROTECT, related_name="corrections")
    target_version = models.PositiveBigIntegerField()
    actor = models.ForeignKey("accounts.Account", on_delete=PROTECT)
    event = models.OneToOneField(Event, on_delete=PROTECT)
    amount = models.DecimalField(max_digits=24, decimal_places=2)
    paid_at = models.DateTimeField()
    description = models.CharField(max_length=500)
    reason = models.CharField(max_length=1000)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.CheckConstraint(condition=Q(amount__gte=0, target_version__gte=1), name="payments_correction_values")
        ]
        indexes = [models.Index(fields=["receipt", "target_version"], name="payments_correction_target")]


class Extension(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.ForeignKey("orders.SellerOrder", on_delete=PROTECT, related_name="due_extensions")
    generation = models.PositiveBigIntegerField()
    before_at = models.DateTimeField()
    due_at = models.DateTimeField()
    actor = models.ForeignKey("accounts.Account", on_delete=PROTECT)
    event = models.OneToOneField(Event, on_delete=PROTECT)
    reason = models.CharField(max_length=1000)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["order", "generation"], name="payments_due_generation"),
            models.CheckConstraint(
                condition=Q(generation__gte=2, due_at__gt=models.F("before_at")), name="payments_later_due"
            ),
        ]


class StockPlan(models.Model):
    objects = PlanManager()
    construction = models.Manager()
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.ForeignKey("orders.SellerOrder", on_delete=PROTECT, related_name="payment_plans")
    actor = models.ForeignKey("accounts.Account", on_delete=PROTECT)
    event = models.OneToOneField(Event, on_delete=PROTECT)
    replaces = models.ForeignKey("inventory.Shortage", null=True, on_delete=PROTECT)
    intent_version = models.PositiveBigIntegerField(default=0)
    reason = models.CharField(max_length=1000)
    created_at = models.DateTimeField(auto_now_add=True)


class StockPlanLine(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    plan = models.ForeignKey(StockPlan, on_delete=PROTECT, related_name="lines")
    variant = models.ForeignKey("catalogue.Variant", on_delete=PROTECT)
    batch = models.ForeignKey("inventory.Batch", null=True, on_delete=PROTECT)
    quantity = models.DecimalField(max_digits=12, decimal_places=3)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["plan", "variant", "batch"], name="payments_plan_bucket"),
            models.CheckConstraint(condition=Q(quantity__gt=0), name="payments_plan_positive"),
        ]


class StockPlanSeal(models.Model):
    plan = models.OneToOneField(StockPlan, primary_key=True, on_delete=PROTECT, related_name="seal")
    created_at = models.DateTimeField(auto_now_add=True)


class AllocationIntent(models.Model):
    order = models.OneToOneField(
        "orders.SellerOrder", primary_key=True, on_delete=PROTECT, related_name="payment_allocation"
    )
    id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    first_receipt = models.OneToOneField(Receipt, on_delete=PROTECT)
    plan = models.ForeignKey(StockPlan, null=True, on_delete=PROTECT)
    allocation = models.OneToOneField("inventory.Allocation", null=True, on_delete=PROTECT)
    state = models.CharField(max_length=18, default="awaiting_selection")
    version = models.PositiveBigIntegerField(default=1)
    checked_at = models.DateTimeField(default=timezone.now)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(
                    state__in=[
                        "awaiting_selection",
                        "pending",
                        "shortage",
                        "reserved",
                        "blocked_zero",
                        "review_required",
                    ]
                ),
                name="payments_intent_state",
            )
        ]
        indexes = [models.Index(fields=["state", "checked_at"], name="payments_allocation_work")]


class AllocationAttempt(models.Model):
    event = models.OneToOneField(Event, on_delete=PROTECT)
    id = models.UUIDField(primary_key=True, editable=False)
    intent = models.ForeignKey(AllocationIntent, on_delete=PROTECT, related_name="attempts")
    number = models.PositiveBigIntegerField()
    plan = models.ForeignKey(StockPlan, on_delete=PROTECT)
    operation = models.OneToOneField("inventory.Operation", on_delete=PROTECT)
    shortage = models.OneToOneField("inventory.Shortage", null=True, on_delete=PROTECT)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["intent", "number"], name="payments_allocation_attempt")]


class ReviewCase(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    key = models.CharField(max_length=64, unique=True)
    order = models.ForeignKey("orders.SellerOrder", on_delete=PROTECT, related_name="payment_cases")
    kind = models.CharField(max_length=16)
    receipt = models.ForeignKey(Receipt, null=True, on_delete=PROTECT)
    correction = models.OneToOneField(Correction, null=True, on_delete=PROTECT, related_name="case")
    plan = models.OneToOneField(StockPlan, null=True, on_delete=PROTECT, related_name="case")
    shortage = models.OneToOneField("inventory.Shortage", null=True, on_delete=PROTECT)
    generation = models.PositiveBigIntegerField(default=1)
    overdue_active = models.BooleanField(default=True)
    assigned_to = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=PROTECT, related_name="payment_assignments"
    )
    state = models.CharField(max_length=12, default="open")
    version = models.PositiveBigIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(
                    kind__in=["receipt", "correction", "shortage", "replacement", "zero_balance", "overdue"],
                    state__in=["open", "approved", "rejected", "resolved", "referred"],
                ),
                name="payments_case_state",
            )
        ]
        indexes = [
            models.Index(fields=["assigned_to", "state", "kind"], name="payments_staff_queue"),
            models.Index(fields=["order", "kind", "generation"], name="payments_case_order"),
        ]


class CaseEvent(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    case = models.ForeignKey(ReviewCase, on_delete=PROTECT, related_name="events")
    event = models.OneToOneField(Event, on_delete=PROTECT)
    version = models.PositiveBigIntegerField()
    action = models.CharField(max_length=16)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=PROTECT, related_name="payment_decisions")
    account = models.ForeignKey("accounts.Account", null=True, on_delete=PROTECT)
    context = models.CharField(max_length=6)
    assigned_to = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=PROTECT, related_name="payment_assignment_events"
    )
    reason = models.CharField(max_length=1000)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["case", "version"], name="payments_case_version")]


class Evidence(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.ForeignKey("orders.SellerOrder", on_delete=PROTECT)
    creator = models.ForeignKey("accounts.Account", on_delete=PROTECT)
    storage_alias = models.CharField(max_length=32, default="private_local")
    key = models.CharField(max_length=500)
    sha256 = models.CharField(max_length=64)
    size = models.PositiveIntegerField()
    width = models.PositiveIntegerField()
    height = models.PositiveIntegerField()
    expires_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=["expires_at"], name="payments_staged_expiry")]


class EvidenceBinding(models.Model):
    evidence = models.OneToOneField(Evidence, primary_key=True, on_delete=PROTECT, related_name="binding")
    claim = models.ForeignKey(Claim, null=True, on_delete=PROTECT, related_name="evidence_bindings")
    receipt = models.ForeignKey(Receipt, null=True, on_delete=PROTECT, related_name="evidence_bindings")
    correction = models.ForeignKey(Correction, null=True, on_delete=PROTECT, related_name="evidence_bindings")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(claim__isnull=False, receipt__isnull=True, correction__isnull=True)
                | Q(claim__isnull=True, receipt__isnull=False, correction__isnull=True)
                | Q(claim__isnull=True, receipt__isnull=True, correction__isnull=False),
                name="payments_evidence_target",
            )
        ]


class NoticeCursor(models.Model):
    event = models.OneToOneField(Event, primary_key=True, on_delete=PROTECT)
    sender = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=PROTECT)
    after_account = models.UUIDField(null=True)
    complete = models.BooleanField(default=False)
    version = models.PositiveBigIntegerField(default=1)
    generation = models.PositiveBigIntegerField(null=True)
    slot = models.PositiveBigIntegerField(null=True)


class Email(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.ForeignKey("orders.SellerOrder", on_delete=PROTECT)
    account = models.ForeignKey("accounts.Account", on_delete=PROTECT)
    generation = models.PositiveBigIntegerField()
    slot = models.PositiveBigIntegerField()
    identity_digest = models.CharField(max_length=64)
    status = models.CharField(max_length=18, default="queued")
    attempts = models.PositiveSmallIntegerField(default=0)
    due_at = models.DateTimeField(default=timezone.now)
    lease_until = models.DateTimeField(null=True)
    lease = models.UUIDField(null=True)
    version = models.PositiveBigIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["order", "generation", "slot", "account"], name="payments_reminder_recipient"
            )
        ]
        indexes = [models.Index(fields=["status", "due_at"], name="payments_email_work")]


class EmailAttempt(models.Model):
    email = models.ForeignKey(Email, on_delete=PROTECT, related_name="history")
    status = models.CharField(max_length=18)
    code = models.CharField(max_length=32)
    created_at = models.DateTimeField(auto_now_add=True)


class SweepCursor(models.Model):
    sector = models.PositiveSmallIntegerField(default=0)
    name = models.CharField(max_length=20, primary_key=True)
    after_id = models.UUIDField(null=True)
    updated_at = models.DateTimeField(default=timezone.now)


class Reminder(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.ForeignKey("orders.SellerOrder", on_delete=PROTECT)
    generation = models.PositiveBigIntegerField()
    slot = models.PositiveBigIntegerField()
    event = models.OneToOneField(Event, on_delete=PROTECT)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["order", "generation", "slot"], name="payments_reminder_slot")]
