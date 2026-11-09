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
    reminder_hours = models.PositiveSmallIntegerField(default=24)
    version = models.PositiveBigIntegerField(default=1)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(id=1, advance_hours__gte=1, advance_hours__lte=720, reminder_hours__lte=720), name="orders_policy_bounds"
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
            models.Index(fields=["due_at", "id"], name="payments_order_due"),
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


AFTERCARE_PERMISSIONS = [
    ("read_aftercare", "Inspect assigned aftercare metadata"),
    ("assign_aftercare", "Assign independent aftercare reviewers and open case cancellations"),
    ("decide_cancellation", "Decide independent order cancellations"),
    ("decide_amendment", "Decide independent order amendments"),
    ("read_dispute", "Inspect assigned post-delivery disputes"),
    ("assign_dispute", "Assign independent dispute reviewers"),
    ("decide_dispute", "Decide independent post-delivery disputes"),
    ("read_dispute_evidence", "Read private dispute evidence"),
    ("read_review", "Inspect the buyer review moderation queue"),
    ("moderate_review", "Moderate buyer reviews of completed orders"),
]


class Aftercare(models.Model):
    order = models.OneToOneField(SellerOrder, primary_key=True, on_delete=models.PROTECT, related_name="aftercare")
    version = models.PositiveBigIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        permissions = AFTERCARE_PERMISSIONS


class AftercareEvent(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.ForeignKey(SellerOrder, on_delete=models.PROTECT, related_name="aftercare_events")
    version = models.PositiveBigIntegerField()
    action = models.CharField(max_length=32)
    actor = models.ForeignKey("accounts.User", null=True, on_delete=models.PROTECT)
    account = models.ForeignKey("accounts.Account", null=True, on_delete=models.PROTECT)
    context = models.CharField(max_length=8)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["order", "version"], name="orders_aftercare_event_version")]
        indexes = [models.Index(fields=["order", "-created_at", "id"], name="orders_aftercare_history")]


class AftercareCommand(models.Model):
    id = models.UUIDField(primary_key=True, editable=False)
    order = models.ForeignKey(SellerOrder, on_delete=models.PROTECT, related_name="aftercare_commands")
    actor = models.ForeignKey("accounts.User", on_delete=models.PROTECT)
    account = models.ForeignKey("accounts.Account", null=True, on_delete=models.PROTECT)
    context = models.CharField(max_length=8)
    event = models.OneToOneField(AftercareEvent, null=True, on_delete=models.PROTECT)
    action = models.CharField(max_length=32)
    digest = models.CharField(max_length=64)
    result = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)


class CancellationRequest(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.ForeignKey(SellerOrder, on_delete=models.PROTECT, related_name="cancellation_requests")
    state = models.CharField(
        max_length=9,
        default="pending",
        choices=[("pending", "Pending"), ("withdrawn", "Withdrawn"), ("approved", "Approved"), ("rejected", "Rejected")],
    )
    requester_account = models.ForeignKey("accounts.Account", null=True, on_delete=models.PROTECT, related_name="+")
    requester_user = models.ForeignKey("accounts.User", null=True, on_delete=models.PROTECT, related_name="+")
    requester_context = models.CharField(max_length=8, choices=[("buyer", "Buyer"), ("seller", "Seller"), ("staff", "Staff")])
    payment_case = models.ForeignKey("payments.ReviewCase", null=True, on_delete=models.PROTECT, related_name="+")
    blocker = models.ForeignKey("fulfilment.Blocker", null=True, on_delete=models.PROTECT, related_name="+")
    reason = models.CharField(max_length=1000)
    assigned_to = models.ForeignKey("accounts.User", null=True, on_delete=models.PROTECT, related_name="cancellation_assignments")
    version = models.PositiveBigIntegerField(default=1)
    event = models.OneToOneField(AftercareEvent, on_delete=models.PROTECT, related_name="cancellation")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            # One pending request per order is trigger-enforced natively;
            # MariaDB has no partial unique index.
            models.CheckConstraint(
                condition=Q(state__in=["pending", "withdrawn", "approved", "rejected"]),
                name="orders_cancellation_state",
            ),
            models.CheckConstraint(
                condition=(
                    Q(requester_account__isnull=False, requester_user__isnull=True, requester_context__in=["buyer", "seller"])
                    | Q(requester_account__isnull=True, requester_user__isnull=False, requester_context="staff")
                ),
                name="orders_cancellation_requester",
            ),
        ]
        indexes = [
            models.Index(fields=["assigned_to", "state"], name="orders_cancellation_queue"),
            models.Index(fields=["order", "-created_at", "id"], name="orders_cancellation_history"),
        ]


class CancellationDecision(models.Model):
    request = models.OneToOneField(CancellationRequest, primary_key=True, on_delete=models.PROTECT, related_name="decision")
    event = models.OneToOneField(AftercareEvent, on_delete=models.PROTECT)
    actor = models.ForeignKey("accounts.User", on_delete=models.PROTECT)
    account = models.ForeignKey("accounts.Account", null=True, on_delete=models.PROTECT)
    context = models.CharField(max_length=8)
    action = models.CharField(max_length=8, choices=[("approved", "Approved"), ("rejected", "Rejected")])
    reason = models.CharField(max_length=1000)
    created_at = models.DateTimeField(auto_now_add=True)


class Amendment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.ForeignKey(SellerOrder, on_delete=models.PROTECT, related_name="amendments")
    state = models.CharField(
        max_length=9,
        default="pending",
        choices=[("pending", "Pending"), ("withdrawn", "Withdrawn"), ("approved", "Approved"), ("rejected", "Rejected")],
    )
    actor = models.ForeignKey("accounts.Account", on_delete=models.PROTECT, related_name="+")
    assigned_to = models.ForeignKey("accounts.User", null=True, on_delete=models.PROTECT, related_name="amendment_assignments")
    after_total = models.DecimalField(max_digits=24, decimal_places=2)
    version = models.PositiveBigIntegerField(default=1)
    reason = models.CharField(max_length=1000)
    event = models.OneToOneField(AftercareEvent, on_delete=models.PROTECT, related_name="amendment")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            # One pending proposal per order is trigger-enforced natively;
            # MariaDB has no partial unique index.
            models.CheckConstraint(
                condition=Q(state__in=["pending", "withdrawn", "approved", "rejected"], after_total__gt=0),
                name="orders_amendment_state",
            ),
        ]
        indexes = [
            models.Index(fields=["assigned_to", "state"], name="orders_amendment_queue"),
            models.Index(fields=["order", "-created_at", "id"], name="orders_amendment_history"),
        ]


class AmendmentLine(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    amendment = models.ForeignKey(Amendment, on_delete=models.PROTECT, related_name="lines")
    line = models.ForeignKey(OrderLine, on_delete=models.PROTECT, related_name="amendment_lines")
    proposed_quantity = models.DecimalField(max_digits=12, decimal_places=3)
    proposed_unit_price = models.DecimalField(max_digits=11, decimal_places=2)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["amendment", "line"], name="orders_amendment_line"),
            models.CheckConstraint(
                condition=Q(proposed_quantity__gt=0, proposed_unit_price__gt=0), name="orders_amendment_line_values"
            ),
        ]


class AmendmentDecision(models.Model):
    amendment = models.OneToOneField(Amendment, primary_key=True, on_delete=models.PROTECT, related_name="decision")
    event = models.OneToOneField(AftercareEvent, on_delete=models.PROTECT)
    actor = models.ForeignKey("accounts.User", on_delete=models.PROTECT)
    account = models.ForeignKey("accounts.Account", null=True, on_delete=models.PROTECT)
    context = models.CharField(max_length=8)
    action = models.CharField(max_length=8, choices=[("approved", "Approved"), ("rejected", "Rejected")])
    reason = models.CharField(max_length=1000)
    created_at = models.DateTimeField(auto_now_add=True)


class InvoiceAdjustment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.ForeignKey(SellerOrder, on_delete=models.PROTECT, related_name="invoice_adjustments")
    invoice = models.ForeignKey(Invoice, on_delete=models.PROTECT, related_name="adjustments")
    cause = models.CharField(max_length=12, choices=[("cancellation", "Cancellation"), ("amendment", "Amendment")])
    cancellation = models.OneToOneField(CancellationRequest, null=True, on_delete=models.PROTECT, related_name="adjustment")
    amendment = models.OneToOneField(Amendment, null=True, on_delete=models.PROTECT, related_name="adjustment")
    before_lines = models.JSONField()
    after_lines = models.JSONField()
    before_total = models.DecimalField(max_digits=24, decimal_places=2)
    after_total = models.DecimalField(max_digits=24, decimal_places=2)
    reason = models.CharField(max_length=1000)
    actor = models.ForeignKey("accounts.User", on_delete=models.PROTECT)
    event = models.OneToOneField(AftercareEvent, on_delete=models.PROTECT, related_name="invoice_adjustment")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(cause__in=["cancellation", "amendment"], before_total__gt=0, after_total__gte=0),
                name="orders_adjustment_values",
            ),
            models.CheckConstraint(
                condition=(
                    Q(cause="cancellation", cancellation__isnull=False, amendment__isnull=True, after_total=0)
                    | Q(cause="amendment", cancellation__isnull=True, amendment__isnull=False, after_total__gt=0)
                ),
                name="orders_adjustment_source",
            ),
        ]
        indexes = [models.Index(fields=["invoice", "-created_at", "id"], name="orders_adjustment_history")]


DISPUTE_OUTCOMES = ["dismissed", "resolved_non_monetary", "refund_ordered"]


class DisputeRequest(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.ForeignKey(SellerOrder, on_delete=models.PROTECT, related_name="disputes")
    state = models.CharField(
        max_length=21,
        default="pending",
        choices=[("pending", "Pending"), ("withdrawn", "Withdrawn")]
        + [(outcome, outcome.replace("_", " ").capitalize()) for outcome in DISPUTE_OUTCOMES],
    )
    requester_account = models.ForeignKey("accounts.Account", on_delete=models.PROTECT, related_name="+")
    reason = models.CharField(max_length=1000)
    blocker = models.ForeignKey("fulfilment.Blocker", null=True, on_delete=models.PROTECT, related_name="+")
    assigned_to = models.ForeignKey("accounts.User", null=True, on_delete=models.PROTECT, related_name="dispute_assignments")
    version = models.PositiveBigIntegerField(default=1)
    event = models.OneToOneField(AftercareEvent, on_delete=models.PROTECT, related_name="dispute")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            # One open dispute per order is trigger-enforced natively; MariaDB has no
            # partial unique index. Sequential disputes after closure stay retained.
            models.UniqueConstraint(fields=["order"], condition=Q(state="pending"), name="orders_one_open_dispute"),
            models.CheckConstraint(
                condition=Q(state__in=["pending", "withdrawn"] + DISPUTE_OUTCOMES),
                name="orders_dispute_state",
            ),
        ]
        indexes = [
            models.Index(fields=["assigned_to", "state"], name="orders_dispute_queue"),
            models.Index(fields=["order", "-created_at", "id"], name="orders_dispute_history"),
        ]


class DisputeResponse(models.Model):
    dispute = models.OneToOneField(DisputeRequest, primary_key=True, on_delete=models.PROTECT, related_name="response")
    actor = models.ForeignKey("accounts.Account", on_delete=models.PROTECT, related_name="+")
    text = models.CharField(max_length=2000)
    event = models.OneToOneField(AftercareEvent, on_delete=models.PROTECT, related_name="dispute_response")
    created_at = models.DateTimeField(auto_now_add=True)


class DisputeDecision(models.Model):
    dispute = models.OneToOneField(DisputeRequest, primary_key=True, on_delete=models.PROTECT, related_name="decision")
    event = models.OneToOneField(AftercareEvent, on_delete=models.PROTECT)
    actor = models.ForeignKey("accounts.User", on_delete=models.PROTECT)
    account = models.ForeignKey("accounts.Account", null=True, on_delete=models.PROTECT)
    context = models.CharField(max_length=8)
    action = models.CharField(max_length=21, choices=[(outcome, outcome.replace("_", " ").capitalize()) for outcome in DISPUTE_OUTCOMES])
    amount = models.DecimalField(max_digits=24, decimal_places=2, null=True)
    refund_due = models.ForeignKey("payments.RefundDue", null=True, on_delete=models.PROTECT, related_name="dispute_decision")
    reason = models.CharField(max_length=1000)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=(
                    Q(action="refund_ordered", amount__isnull=False, amount__gt=0, refund_due__isnull=False)
                    | Q(action__in=["dismissed", "resolved_non_monetary"], amount__isnull=True, refund_due__isnull=True)
                ),
                name="orders_dispute_decision_values",
            )
        ]


class Review(models.Model):
    order = models.OneToOneField(SellerOrder, primary_key=True, on_delete=models.PROTECT, related_name="review")
    buyer = models.ForeignKey("accounts.Account", on_delete=models.PROTECT, related_name="+")
    rating = models.PositiveSmallIntegerField()
    text = models.CharField(max_length=2000)
    language = models.CharField(max_length=8)
    state = models.CharField(
        max_length=9,
        default="pending",
        choices=[("pending", "Pending"), ("withdrawn", "Withdrawn"), ("approved", "Approved"), ("rejected", "Rejected")],
    )
    version = models.PositiveBigIntegerField(default=1)
    event = models.OneToOneField(AftercareEvent, on_delete=models.PROTECT, related_name="review")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(rating__gte=1, rating__lte=5, state__in=["pending", "withdrawn", "approved", "rejected"]),
                name="orders_review_values",
            )
        ]
        indexes = [models.Index(fields=["state", "-created_at", "order"], name="orders_review_queue")]


class ReviewDecision(models.Model):
    """Append-only moderation history: an approved review may later be withdrawn."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    review = models.ForeignKey(Review, on_delete=models.PROTECT, related_name="decisions")
    event = models.OneToOneField(AftercareEvent, on_delete=models.PROTECT)
    actor = models.ForeignKey("accounts.User", on_delete=models.PROTECT)
    account = models.ForeignKey("accounts.Account", null=True, on_delete=models.PROTECT)
    context = models.CharField(max_length=8)
    action = models.CharField(max_length=9, choices=[("approved", "Approved"), ("rejected", "Rejected"), ("withdrawn", "Withdrawn")])
    reason = models.CharField(max_length=1000)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=["review", "-created_at", "id"], name="orders_review_history")]
