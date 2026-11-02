import uuid
from django.db import models
from django.db.models import Q
from .managers import AgreementManager, AgreementChildManager, RequestManager, AgreementEventManager, RequestChildManager


class SellerCheckoutTerms(models.Model):
    seller = models.OneToOneField("organizations.BusinessProfile", primary_key=True, on_delete=models.PROTECT)
    version = models.PositiveBigIntegerField(default=1)
    enabled = models.BooleanField(default=False)
    destinations = models.JSONField(default=list)
    methods = models.JSONField(default=list)
    updated_at = models.DateTimeField(auto_now=True)


class OrderPolicy(models.Model):
    id = models.PositiveSmallIntegerField(primary_key=True, default=1, editable=False)
    advance_hours = models.PositiveSmallIntegerField(default=72)
    version = models.PositiveBigIntegerField(default=1)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(id=1, advance_hours__gte=1, advance_hours__lte=720), name="orders_policy_bounds"
            )
        ]


class CheckoutSubmission(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    buyer = models.ForeignKey("accounts.Account", on_delete=models.PROTECT)
    cart = models.ForeignKey("cart.Cart", on_delete=models.PROTECT)
    key = models.UUIDField()
    digest = models.CharField(max_length=64)
    payload = models.JSONField()
    selections = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["buyer", "key"], name="orders_submission_command")]
        indexes = [models.Index(fields=["buyer", "-created_at", "id"], name="orders_buyer_submissions")]


class CheckoutOutcome(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    submission = models.ForeignKey(CheckoutSubmission, on_delete=models.PROTECT, related_name="outcomes")
    seller = models.ForeignKey("organizations.BusinessProfile", on_delete=models.PROTECT)
    state = models.CharField(
        max_length=8,
        default="pending",
        choices=[("pending", "Pending"), ("accepted", "Accepted"), ("failed", "Failed")],
    )
    code = models.CharField(max_length=40, blank=True)
    version = models.PositiveBigIntegerField(default=0)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["submission", "seller"], name="orders_seller_outcome"),
            models.CheckConstraint(
                condition=Q(state__in=["pending", "accepted", "failed"]), name="orders_outcome_state"
            ),
        ]


class SellerOrder(models.Model):
    objects = AgreementManager()
    construction = models.Manager()
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    outcome = models.OneToOneField(CheckoutOutcome, null=True, on_delete=models.PROTECT, related_name="order")
    negotiation = models.OneToOneField("Negotiation", null=True, on_delete=models.PROTECT, related_name="order")
    buyer = models.ForeignKey("accounts.Account", on_delete=models.PROTECT)
    seller = models.ForeignKey("organizations.BusinessProfile", on_delete=models.PROTECT)
    currency = models.CharField(max_length=3, choices=[("AFN", "AFN"), ("USD", "USD")])
    goods_total = models.DecimalField(max_digits=24, decimal_places=2)
    payment_method = models.CharField(max_length=7, choices=[("advance", "Advance"), ("cod", "COD")])
    accepted_at = models.DateTimeField()
    due_at = models.DateTimeField(null=True)
    snapshot = models.JSONField()

    class Meta:
        permissions = [
            ("read_orders", "Read operational accepted orders"),
            ("read_invoices", "Read protected goods invoices"),
        ]
        indexes = [
            models.Index(fields=["buyer", "-accepted_at", "id"], name="orders_buyer_history"),
            models.Index(fields=["seller", "-accepted_at", "id"], name="orders_seller_history"),
        ]
        constraints = [
            models.CheckConstraint(
                condition=(
                    Q(outcome__isnull=False, negotiation__isnull=True)
                    | Q(outcome__isnull=True, negotiation__isnull=False)
                ),
                name="orders_exact_origin",
            ),
            models.CheckConstraint(
                condition=Q(currency__in=["AFN", "USD"], goods_total__gt=0), name="orders_goods_money"
            ),
            models.CheckConstraint(
                condition=(
                    Q(payment_method="advance", due_at__isnull=False) | Q(payment_method="cod", due_at__isnull=True)
                ),
                name="orders_due_method",
            ),
        ]


class OrderLine(models.Model):
    objects = AgreementChildManager()
    construction = models.Manager()
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.ForeignKey(SellerOrder, on_delete=models.PROTECT, related_name="lines")
    variant = models.ForeignKey("catalogue.Variant", on_delete=models.PROTECT)
    tier = models.CharField(max_length=9)
    quantity = models.DecimalField(max_digits=12, decimal_places=3)
    unit_price = models.DecimalField(max_digits=11, decimal_places=2)
    goods_amount = models.DecimalField(max_digits=24, decimal_places=2)
    snapshot = models.JSONField()

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["order", "variant", "tier"], name="orders_line_selection"),
            models.CheckConstraint(
                condition=Q(tier__in=["retail", "wholesale"], quantity__gt=0, unit_price__gt=0, goods_amount__gt=0),
                name="orders_line_amount",
            ),
        ]


class Invoice(models.Model):
    objects = AgreementChildManager()
    construction = models.Manager()
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.OneToOneField(SellerOrder, on_delete=models.PROTECT, related_name="invoice")
    number = models.CharField(max_length=32, unique=True, editable=False)
    issued_at = models.DateTimeField(auto_now_add=True)


class OrderEvent(models.Model):
    objects = AgreementEventManager()
    construction = models.Manager()
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.ForeignKey(SellerOrder, null=True, on_delete=models.PROTECT)
    seller = models.ForeignKey("organizations.BusinessProfile", null=True, on_delete=models.PROTECT)
    actor = models.ForeignKey("accounts.User", on_delete=models.PROTECT)
    account = models.ForeignKey("accounts.Account", null=True, on_delete=models.PROTECT)
    context = models.CharField(max_length=8)
    action = models.CharField(max_length=32)
    reason = models.CharField(max_length=1000, blank=True)
    state = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)


class NegotiationSubmission(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    buyer = models.ForeignKey("accounts.Account", on_delete=models.PROTECT)
    cart = models.ForeignKey("cart.Cart", on_delete=models.PROTECT)
    key = models.UUIDField()
    digest = models.CharField(max_length=64)
    payload = models.JSONField()
    selections = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["buyer", "key"], name="orders_request_submission_key")]
        indexes = [models.Index(fields=["buyer", "-created_at", "id"], name="orders_request_submissions")]


class NegotiationOutcome(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    submission = models.ForeignKey(NegotiationSubmission, on_delete=models.PROTECT, related_name="outcomes")
    seller = models.ForeignKey("organizations.BusinessProfile", on_delete=models.PROTECT)
    state = models.CharField(max_length=10, default="pending")
    code = models.CharField(max_length=40, blank=True)
    version = models.PositiveBigIntegerField(default=0)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["submission", "seller"], name="orders_request_seller_outcome"),
            models.CheckConstraint(
                condition=Q(state__in=["pending", "submitted", "failed"]), name="orders_request_outcome_state"
            ),
        ]


class Negotiation(models.Model):
    objects = RequestManager()
    construction = models.Manager()
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    outcome = models.OneToOneField(NegotiationOutcome, on_delete=models.PROTECT, related_name="request")
    buyer = models.ForeignKey("accounts.Account", on_delete=models.PROTECT)
    seller = models.ForeignKey("organizations.BusinessProfile", on_delete=models.PROTECT)
    currency = models.CharField(max_length=3)
    state = models.CharField(max_length=20, default="submitted")
    version = models.PositiveBigIntegerField(default=1)
    revision = models.PositiveBigIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        permissions = [("read_negotiations", "Inspect formal requests and retained proposal history")]
        constraints = [
            models.CheckConstraint(
                condition=Q(
                    currency__in=["AFN", "USD"],
                    state__in=["submitted", "correction_requested", "rejected", "withdrawn", "accepted"],
                ),
                name="orders_request_state",
            )
        ]
        indexes = [
            models.Index(fields=["buyer", "-created_at", "id"], name="orders_buyer_requests"),
            models.Index(fields=["seller", "state", "-created_at"], name="orders_seller_requests"),
        ]


class NegotiationRevision(models.Model):
    objects = RequestChildManager()
    construction = models.Manager()
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    request = models.ForeignKey(Negotiation, on_delete=models.PROTECT, related_name="revisions")
    number = models.PositiveBigIntegerField()
    actor = models.ForeignKey("accounts.Account", on_delete=models.PROTECT)
    body = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["request", "number"], name="orders_request_revision")]


class NegotiationEvent(models.Model):
    objects = RequestChildManager()
    construction = models.Manager()
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    request = models.ForeignKey(Negotiation, on_delete=models.PROTECT, related_name="events")
    version = models.PositiveBigIntegerField()
    revision = models.PositiveBigIntegerField()
    actor = models.ForeignKey("accounts.Account", on_delete=models.PROTECT)
    action = models.CharField(max_length=24)
    reason = models.CharField(max_length=1000, blank=True)
    state = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["request", "version"], name="orders_request_event_version")]


class NegotiationCommand(models.Model):
    objects = RequestChildManager()
    construction = models.Manager()
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    request = models.ForeignKey(Negotiation, on_delete=models.PROTECT, related_name="commands")
    actor = models.ForeignKey("accounts.Account", on_delete=models.PROTECT)
    key = models.UUIDField()
    digest = models.CharField(max_length=64)
    result = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["actor", "key"], name="orders_request_actor_command")]


class NegotiationSubmissionFence(models.Model):
    buyer = models.ForeignKey("accounts.Account", on_delete=models.PROTECT)
    key = models.UUIDField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["buyer", "key"], name="orders_submission_recovery_fence")]
