"""Private whole-order physical facts, separate provider money and immutable completion."""

import uuid
from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils import timezone
from .managers import PublishedEventManager, PublishedFactManager

PROTECT = models.PROTECT
PERMISSIONS = [
    ("read_fulfilment", "Inspect assigned fulfilment metadata"),
    ("assign_fulfilment", "Assign fulfilment operations and independent review"),
    ("manage_logistics", "Prepare and dispatch assigned logistics"),
    ("read_recipients", "Inspect assigned private recipients"),
    ("print_handover", "Generate assigned recipient handover documents"),
    ("finalize_delivery_charge", "Independently finalize assigned delivery charges"),
    ("confirm_delivery_payment", "Independently confirm provider receipt claims"),
    ("correct_delivery_payment", "Decide independent delivery receipt corrections"),
    ("read_delivery_evidence", "Inspect assigned private delivery evidence"),
    ("manage_delivery_holds", "Record and independently resolve operational holds"),
    ("confirm_delivery", "Confirm actual whole delivery of assigned shipments"),
    ("record_delivery_refund", "Record provider-issued delivery refunds"),
    ("confirm_delivery_refund", "Independently confirm provider delivery refunds"),
]


class State(models.Model):
    order = models.OneToOneField("orders.SellerOrder", primary_key=True, on_delete=PROTECT, related_name="fulfilment")
    version = models.PositiveBigIntegerField(default=0)
    next_check_at = models.DateTimeField(default=timezone.now, db_index=True)
    checked_at = models.DateTimeField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        permissions = PERMISSIONS


class Event(models.Model):
    objects = PublishedEventManager()
    construction = models.Manager()
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.ForeignKey("orders.SellerOrder", on_delete=PROTECT, related_name="fulfilment_events")
    version = models.PositiveBigIntegerField()
    action = models.CharField(max_length=32)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=PROTECT, related_name="+")
    account = models.ForeignKey("accounts.Account", null=True, on_delete=PROTECT, related_name="+")
    context = models.CharField(max_length=6)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["order", "version"], name="fulfilment_event_version")]
        indexes = [models.Index(fields=["order", "-created_at", "id"], name="fulfilment_event_history")]


class Publication(models.Model):
    event = models.OneToOneField(Event, primary_key=True, on_delete=PROTECT, related_name="publication")
    created_at = models.DateTimeField(auto_now_add=True)


class Fact(models.Model):
    objects = PublishedFactManager()
    construction = models.Manager()
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.ForeignKey("orders.SellerOrder", on_delete=PROTECT, related_name="+")
    event = models.OneToOneField(Event, on_delete=PROTECT, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        abstract = True


class Command(models.Model):
    id = models.UUIDField(primary_key=True, editable=False)
    order = models.ForeignKey("orders.SellerOrder", on_delete=PROTECT, related_name="+")
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=PROTECT, related_name="+")
    account = models.ForeignKey("accounts.Account", null=True, on_delete=PROTECT, related_name="+")
    context = models.CharField(max_length=6)
    event = models.OneToOneField(Event, null=True, on_delete=PROTECT, related_name="+")
    action = models.CharField(max_length=32)
    digest = models.CharField(max_length=64)
    result = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)


class Provider(Fact):
    name = models.CharField(max_length=160)
    business = models.ForeignKey("organizations.BusinessProfile", null=True, on_delete=PROTECT, related_name="+")


class Arrangement(Fact):
    provider = models.ForeignKey(Provider, on_delete=PROTECT, related_name="+")
    arranger = models.CharField(max_length=6, choices=[("seller", "Seller"), ("rezayi", "Rezayi")])
    instructions = models.CharField(max_length=1000, blank=True)

    class Meta:
        constraints = [
            models.CheckConstraint(condition=Q(arranger__in=["seller", "rezayi"]), name="fulfilment_arranger")
        ]


class Recipient(Fact):
    revision = models.PositiveBigIntegerField()
    name = models.CharField(max_length=120)
    phone = models.CharField(max_length=40)
    address = models.CharField(max_length=1500)
    instructions = models.CharField(max_length=1000, blank=True)
    reason = models.CharField(max_length=1000)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["order", "revision"], name="fulfilment_recipient_revision")]


class Preparation(Fact):
    arrangement = models.ForeignKey(Arrangement, on_delete=PROTECT, related_name="+")
    recipient = models.ForeignKey(Recipient, on_delete=PROTECT, related_name="+")
    allocation = models.ForeignKey("inventory.Allocation", null=True, on_delete=PROTECT, related_name="+")
    reason = models.CharField(max_length=1000)


class PreparationLine(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    preparation = models.ForeignKey(Preparation, on_delete=PROTECT, related_name="lines")
    variant = models.ForeignKey("catalogue.Variant", on_delete=PROTECT, related_name="+")
    bucket = models.ForeignKey("inventory.Bucket", on_delete=PROTECT, related_name="+")
    quantity = models.DecimalField(max_digits=12, decimal_places=3)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["preparation", "bucket"], name="fulfilment_selection_bucket"),
            models.CheckConstraint(condition=Q(quantity__gt=0), name="fulfilment_selection_positive"),
        ]


class PartialPermission(Fact):
    goods_version = models.PositiveBigIntegerField()
    reason = models.CharField(max_length=1000)


class ChargeProposal(Fact):
    provider = models.ForeignKey(Provider, on_delete=PROTECT, related_name="+")
    amount = models.DecimalField(max_digits=24, decimal_places=2)
    currency = models.CharField(max_length=3)
    reason = models.CharField(max_length=1000)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(amount__gte=0, currency__in=["AFN", "USD"]), name="fulfilment_charge_values"
            )
        ]


class ChargeDecision(Fact):
    proposal = models.OneToOneField(ChargeProposal, on_delete=PROTECT, related_name="decision")
    action = models.CharField(max_length=8, choices=[("approved", "Approved"), ("rejected", "Rejected")])
    reason = models.CharField(max_length=1000)


class Shipment(Fact):
    order = models.OneToOneField("orders.SellerOrder", on_delete=PROTECT, related_name="shipment")
    preparation = models.OneToOneField(Preparation, on_delete=PROTECT, related_name="+")
    charge = models.ForeignKey(ChargeProposal, on_delete=PROTECT, related_name="+")
    operation = models.OneToOneField("inventory.Operation", on_delete=PROTECT, related_name="+")
    goods_version = models.PositiveBigIntegerField()
    goods_confirmed = models.DecimalField(max_digits=24, decimal_places=2)
    dispatched_at = models.DateTimeField()


class Tracking(Fact):
    shipment = models.ForeignKey(Shipment, on_delete=PROTECT, related_name="tracking_events")
    reference = models.CharField(max_length=160)
    occurred_at = models.DateTimeField()
    reason = models.CharField(max_length=1000)


class Delivery(Fact):
    shipment = models.OneToOneField(Shipment, on_delete=PROTECT, related_name="delivery")
    occurred_at = models.DateTimeField()
    reason = models.CharField(max_length=1000)


class Claim(Fact):
    charge = models.ForeignKey(ChargeProposal, on_delete=PROTECT, related_name="+")
    amount = models.DecimalField(max_digits=24, decimal_places=2)
    currency = models.CharField(max_length=3)
    paid_at = models.DateTimeField()
    description = models.CharField(max_length=500)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(amount__gt=0, currency__in=["AFN", "USD"]), name="fulfilment_claim_values"
            )
        ]
        indexes = [models.Index(fields=["order", "-created_at", "id"], name="fulfilment_claim_history")]


class ClaimDecision(Fact):
    claim = models.OneToOneField(Claim, on_delete=PROTECT, related_name="decision")
    action = models.CharField(
        max_length=9, choices=[("confirmed", "Confirmed"), ("rejected", "Rejected"), ("withdrawn", "Withdrawn")]
    )
    reason = models.CharField(max_length=1000)


class Receipt(Fact):
    claim = models.OneToOneField(Claim, on_delete=PROTECT, related_name="receipt")


class Correction(Fact):
    receipt = models.ForeignKey(Receipt, on_delete=PROTECT, related_name="corrections")
    target_version = models.PositiveBigIntegerField()
    amount = models.DecimalField(max_digits=24, decimal_places=2)
    paid_at = models.DateTimeField()
    description = models.CharField(max_length=500)
    reason = models.CharField(max_length=1000)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(amount__gte=0, target_version__gte=1), name="fulfilment_correction_values"
            )
        ]


class Blocker(Fact):
    kind = models.CharField(
        max_length=12, choices=[("cancellation", "Cancellation hold"), ("dispute", "Unresolved dispute")]
    )
    reason = models.CharField(max_length=1000)

    class Meta:
        constraints = [
            models.CheckConstraint(condition=Q(kind__in=["cancellation", "dispute"]), name="fulfilment_blocker_kind")
        ]


class BlockerClosure(Fact):
    blocker = models.OneToOneField(Blocker, on_delete=PROTECT, related_name="closure")
    disposition = models.CharField(
        max_length=10,
        choices=[("erroneous", "Erroneous"), ("withdrawn", "Withdrawn"), ("decided", "Decided")],
    )
    reason = models.CharField(max_length=1000)


class DeliveryRefund(Fact):
    """Provider-issued delivery money returned to the payer, recorded separately
    from goods refunds and bounded by confirmed provider receipts."""

    provider = models.ForeignKey(Provider, on_delete=PROTECT, related_name="+")
    amount = models.DecimalField(max_digits=24, decimal_places=2)
    currency = models.CharField(max_length=3)
    sent_at = models.DateTimeField()
    reference = models.CharField(max_length=160)
    description = models.CharField(max_length=500)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(amount__gt=0, currency__in=["AFN", "USD"]), name="fulfilment_refund_values"
            )
        ]
        indexes = [models.Index(fields=["order", "-created_at", "id"], name="fulfilment_refund_history")]


class DeliveryRefundDecision(Fact):
    refund = models.OneToOneField(DeliveryRefund, on_delete=PROTECT, related_name="decision")
    action = models.CharField(max_length=9, choices=[("confirmed", "Confirmed"), ("rejected", "Rejected")])
    reason = models.CharField(max_length=1000)


class Completion(Fact):
    order = models.OneToOneField("orders.SellerOrder", on_delete=PROTECT, related_name="completion")
    delivery = models.OneToOneField(Delivery, on_delete=PROTECT, related_name="+")
    goods_version = models.PositiveBigIntegerField()
    delivery_version = models.PositiveBigIntegerField()


class DispatchAttempt(Fact):
    code = models.CharField(max_length=40)
    shortage = models.ForeignKey("inventory.Shortage", null=True, on_delete=PROTECT, related_name="+")
    preparation = models.ForeignKey(Preparation, null=True, on_delete=PROTECT, related_name="+")


class ReviewCase(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    key = models.CharField(max_length=64, unique=True)
    order = models.ForeignKey("orders.SellerOrder", on_delete=PROTECT, related_name="fulfilment_cases")
    kind = models.CharField(
        max_length=12,
        choices=[
            (k, k.title()) for k in ["logistics", "charge", "payment", "correction", "blocker", "stock", "exception", "refund"]
        ],
    )
    proposal = models.OneToOneField(ChargeProposal, null=True, on_delete=PROTECT, related_name="case")
    claim = models.OneToOneField(Claim, null=True, on_delete=PROTECT, related_name="case")
    correction = models.OneToOneField(Correction, null=True, on_delete=PROTECT, related_name="case")
    blocker = models.OneToOneField(Blocker, null=True, on_delete=PROTECT, related_name="case")
    refund = models.OneToOneField(DeliveryRefund, null=True, on_delete=PROTECT, related_name="case")
    assigned_to = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=PROTECT, related_name="+")
    state = models.CharField(
        max_length=8,
        default="open",
        choices=[(k, k.title()) for k in ["open", "approved", "rejected", "resolved", "referred"]],
    )
    version = models.PositiveBigIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=["assigned_to", "state", "kind"], name="fulfilment_assignment_queue"),
            models.Index(fields=["order", "state"], name="fulfilment_order_cases"),
        ]


class CaseEvent(Fact):
    case = models.ForeignKey(ReviewCase, on_delete=PROTECT, related_name="events")
    case_version = models.PositiveBigIntegerField()
    action = models.CharField(max_length=12)
    assigned_to = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=PROTECT, related_name="+")
    reason = models.CharField(max_length=1000)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["case", "case_version"], name="fulfilment_case_version")]


class Evidence(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.ForeignKey("orders.SellerOrder", on_delete=PROTECT, related_name="+")
    creator = models.ForeignKey("accounts.Account", on_delete=PROTECT, related_name="+")
    purpose = models.CharField(
        max_length=10, choices=[("claim", "Claim"), ("correction", "Correction"), ("refund", "Refund")]
    )
    storage_alias = models.CharField(max_length=32, default="private_local")
    key = models.CharField(max_length=255)
    sha256 = models.CharField(max_length=64)
    size = models.PositiveIntegerField()
    width = models.PositiveIntegerField()
    height = models.PositiveIntegerField()
    expires_at = models.DateTimeField(db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)


class EvidenceBinding(models.Model):
    evidence = models.OneToOneField(Evidence, primary_key=True, on_delete=PROTECT, related_name="binding")
    claim = models.ForeignKey(Claim, null=True, on_delete=PROTECT, related_name="images")
    correction = models.ForeignKey(Correction, null=True, on_delete=PROTECT, related_name="images")
    refund = models.ForeignKey(DeliveryRefund, null=True, on_delete=PROTECT, related_name="images")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=(
                    Q(claim__isnull=False, correction__isnull=True, refund__isnull=True)
                    | Q(claim__isnull=True, correction__isnull=False, refund__isnull=True)
                    | Q(claim__isnull=True, correction__isnull=True, refund__isnull=False)
                ),
                name="fulfilment_image_target",
            )
        ]


class NoticeCursor(models.Model):
    event = models.OneToOneField(Event, primary_key=True, on_delete=PROTECT, related_name="+")
    after = models.UUIDField(null=True)
    done = models.BooleanField(default=False)
    next_check_at = models.DateTimeField(default=timezone.now, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
