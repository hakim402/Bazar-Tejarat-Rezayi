"""Strict, bounded private payment packets and paired API projections."""

from rest_framework import serializers as s
from drf_spectacular.utils import extend_schema_serializer
from apps.foundation.contracts import AwareDateTime
from apps.messaging.contracts import Strict
from . import validation as v


class Money(s.CharField):
    def __init__(self, *args, zero=False, **kwargs):
        self.zero = zero
        super().__init__(*args, **kwargs)

    def to_internal_value(self, value):
        v.money(value, zero=self.zero)
        return value


class Command(Strict):
    command_id = s.UUIDField()
    version = s.IntegerField(min_value=0)


class Facts(Command):
    amount = Money()
    currency = s.ChoiceField(choices=["AFN", "USD"])
    paid_at = s.DateTimeField()
    description = s.CharField(min_length=1, max_length=500)
    evidence = s.ListField(child=s.UUIDField(), max_length=3, default=list)


class ClaimCommand(Facts):
    previous = s.UUIDField(required=False)


class ReceiptCommand(Facts):
    plan = s.UUIDField(required=False)


class DecisionCommand(Command):
    claim_version = s.IntegerField(min_value=1)
    reason = s.CharField(min_length=3, max_length=1000)


class ConfirmCommand(DecisionCommand):
    plan = s.UUIDField(required=False)


class CorrectionCommand(Facts):
    amount = Money(zero=True)
    receipt_version = s.IntegerField(min_value=1)
    reason = s.CharField(min_length=3, max_length=1000)


class ExtensionCommand(Command):
    deadline_generation = s.IntegerField(min_value=1)
    due_at = s.DateTimeField()
    reason = s.CharField(min_length=3, max_length=1000)


class PlanLine(Strict):
    variant = s.UUIDField()
    batch = s.UUIDField(allow_null=True, default=None)
    quantity = s.CharField(max_length=20)


class PlanCommand(Command):
    intent_version = s.IntegerField(min_value=0)
    replaces = s.UUIDField(required=False)
    reason = s.CharField(min_length=3, max_length=1000)
    lines = PlanLine(many=True, min_length=1, max_length=100)


class Query(Strict):
    seller = s.UUIDField(required=False)
    page = s.IntegerField(min_value=1, max_value=10000, default=1)
    state = s.ChoiceField(choices=["", "unpaid", "partial", "paid", "overpaid", "overdue"], default="")
    q = s.CharField(max_length=100, allow_blank=True, default="")


@extend_schema_serializer(component_name="PaymentUploadCommand")
class UploadCommand(Strict):
    command_id = s.UUIDField()
    file = s.FileField()


class Empty(Strict):
    pass


class Summary(s.Serializer):
    id = s.UUIDField()
    seller = s.UUIDField()
    buyer = s.UUIDField()
    invoice = s.UUIDField()
    number = s.CharField()
    currency = s.CharField()
    goods_total = s.CharField()
    accepted_total = s.CharField()
    payment_method = s.CharField()
    seller_name = s.CharField(allow_blank=True)
    buyer_name = s.CharField(allow_blank=True)
    confirmed_total = s.CharField()
    received = s.CharField()
    refunded = s.CharField()
    refund_due = s.CharField()
    refundable_excess = s.CharField()
    remaining = s.CharField()
    overpayment = s.CharField()
    financial = s.CharField()
    allocation = s.CharField()
    original_due_at = s.DateTimeField(allow_null=True)
    effective_due_at = s.DateTimeField(allow_null=True)
    deadline_generation = s.IntegerField()
    version = s.IntegerField()
    overdue = s.BooleanField()
    pending_claims = s.IntegerField()
    review_pending = s.IntegerField()
    capabilities = s.DictField(child=s.BooleanField())


class Detail(Summary):
    claims = s.ListField(child=s.JSONField())
    receipts = s.ListField(child=s.JSONField())
    corrections = s.ListField(child=s.JSONField())
    cases = s.ListField(child=s.JSONField())
    extensions = s.ListField(child=s.JSONField())
    plans = s.ListField(child=s.JSONField())
    refund_dues = s.ListField(child=s.JSONField())
    refund_reports = s.ListField(child=s.JSONField())
    history = s.ListField(child=s.JSONField())
    history_count = s.IntegerField()
    history_page = s.IntegerField()
    selection = s.JSONField(allow_null=True)


class RefundDueCommand(Command):
    amount = Money()
    reason = s.CharField(min_length=3, max_length=1000)


class RefundReportCommand(Command):
    due = s.UUIDField()
    previous = s.UUIDField(required=False)
    amount = Money()
    sent_at = AwareDateTime()
    reference = s.CharField(min_length=1, max_length=160)
    description = s.CharField(min_length=1, max_length=500)
    evidence = s.ListField(child=s.UUIDField(), max_length=3, default=list)


class RefundWithdrawCommand(Command):
    report = s.UUIDField()
    reason = s.CharField(min_length=3, max_length=1000)


class Page(s.Serializer):
    count = s.IntegerField()
    page = s.IntegerField()
    results = Summary(many=True)


@extend_schema_serializer(component_name="PaymentOutcome")
class Outcome(s.Serializer):
    outcome = s.JSONField()
    current = Detail()


@extend_schema_serializer(component_name="PaymentSettlement")
class Settled(Outcome):
    state = s.CharField()


class Image(s.Serializer):
    id = s.UUIDField()
    width = s.IntegerField()
    height = s.IntegerField()
    size = s.IntegerField()
