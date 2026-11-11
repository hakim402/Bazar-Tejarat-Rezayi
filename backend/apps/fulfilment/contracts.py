"""Strict bounded typed private packets; no JSON authority for financial input."""

from rest_framework import serializers as s
from drf_spectacular.utils import extend_schema_serializer
from apps.foundation.contracts import AwareDateTime
from apps.messaging.contracts import Strict
from apps.payments.contracts import Money

class Query(Strict):
    seller = s.UUIDField(required=False)
    page = s.IntegerField(min_value=1, max_value=10000, default=1)
    state = s.ChoiceField(choices=["", "not_dispatched", "dispatched", "delivered", "blocked"], default="")
    q = s.CharField(max_length=100, allow_blank=True, default="")


class Command(Strict):
    command_id = s.UUIDField()
    version = s.IntegerField(min_value=0)
    goods_version = s.IntegerField(min_value=0)


class Reason(Command):
    reason = s.CharField(min_length=3, max_length=1000)


class RecipientCommand(Reason):
    recipient_revision = s.IntegerField(min_value=0)
    name = s.CharField(min_length=1, max_length=120)
    phone = s.CharField(min_length=1, max_length=40)
    address = s.CharField(min_length=1, max_length=1500)
    instructions = s.CharField(max_length=1000, allow_blank=True, default="")


class ArrangementCommand(Command):
    arranger = s.ChoiceField(choices=["seller", "rezayi"])
    provider = s.CharField(min_length=1, max_length=160)
    self_delivery = s.BooleanField(default=False)
    instructions = s.CharField(max_length=1000, allow_blank=True, default="")


class Selection(Strict):
    variant = s.UUIDField()
    batch = s.UUIDField(allow_null=True, default=None)
    quantity = s.RegexField(r"^[0-9]{1,9}\.[0-9]{3}$", max_length=13)


class PrepareCommand(Reason):
    arrangement = s.UUIDField()
    recipient = s.UUIDField()
    lines = s.ListField(child=Selection(), min_length=1, max_length=100, required=False)


class ChargeCommand(Reason):
    provider = s.UUIDField()
    amount = Money(zero=True)
    currency = s.ChoiceField(choices=["AFN", "USD"])


@extend_schema_serializer(component_name="FulfilmentClaimCommand")
class ClaimCommand(Command):
    charge = s.UUIDField()
    amount = Money()
    currency = s.ChoiceField(choices=["AFN", "USD"])
    paid_at = AwareDateTime()
    description = s.CharField(min_length=1, max_length=500)
    evidence = s.ListField(child=s.UUIDField(), max_length=3, default=list)


class WithdrawCommand(Reason):
    claim = s.UUIDField()


@extend_schema_serializer(component_name="FulfilmentRefundCommand")
class RefundCommand(Command):
    provider = s.UUIDField()
    amount = Money()
    currency = s.ChoiceField(choices=["AFN", "USD"])
    sent_at = AwareDateTime()
    reference = s.CharField(min_length=1, max_length=160)
    description = s.CharField(min_length=1, max_length=500)
    evidence = s.ListField(child=s.UUIDField(), max_length=3, default=list)


@extend_schema_serializer(component_name="FulfilmentCorrectionCommand")
class CorrectionCommand(Reason):
    receipt = s.UUIDField()
    receipt_version = s.IntegerField(min_value=1)
    amount = Money(zero=True)
    paid_at = AwareDateTime()
    description = s.CharField(min_length=1, max_length=500)
    evidence = s.ListField(child=s.UUIDField(), max_length=3, default=list)


class TrackingCommand(Reason):
    reference = s.CharField(min_length=1, max_length=160)
    occurred_at = AwareDateTime()


class DeliveryCommand(Reason):
    occurred_at = AwareDateTime()


class DispatchReviewCommand(Reason):
    preparation = s.UUIDField()


class DisplayLine(Strict):
    variant = s.UUIDField()
    bucket = s.CharField(max_length=20)
    batch = s.UUIDField(allow_null=True)
    batch_code = s.CharField(max_length=80, allow_blank=True)
    expires_on = s.DateField(allow_null=True)
    quantity = s.CharField(max_length=13)
    sku = s.CharField(max_length=100, allow_blank=True)
    unit = s.CharField(max_length=100, allow_blank=True)
    unit_labels = s.DictField(child=s.CharField(max_length=500))


class DispatchCommand(DispatchReviewCommand):
    recipient = s.UUIDField()
    recipient_revision = s.IntegerField(min_value=1)
    arrangement = s.UUIDField()
    arranger = s.ChoiceField(choices=["seller", "rezayi"])
    provider = s.UUIDField()
    provider_name = s.CharField(max_length=160)
    charge = s.UUIDField()
    charge_amount = Money(zero=True)
    currency = s.ChoiceField(choices=["AFN", "USD"])
    goods_confirmed = Money(zero=True)
    goods_total = Money()
    partial_permission = s.UUIDField(allow_null=True)
    lines = s.ListField(child=DisplayLine(), min_length=1, max_length=100)
    stock_effect = s.ChoiceField(choices=["consume_hold", "deduct_cod"])
    review = s.RegexField(r"^[0-9a-f]{64}$")


@extend_schema_serializer(component_name="FulfilmentSummary")
class Summary(s.Serializer):
    buyer = s.CharField(allow_blank=True)
    id = s.UUIDField()
    seller = s.UUIDField()
    number = s.CharField()
    invoice = s.UUIDField(allow_null=True)
    currency = s.CharField()
    goods_total = s.CharField()
    payment_method = s.CharField()
    destination = s.DictField(child=s.CharField())
    version = s.IntegerField()
    goods_version = s.IntegerField()
    goods_confirmed = s.CharField()
    goods_remaining = s.CharField()
    stage = s.CharField()
    allocation = s.CharField()
    overdue = s.BooleanField()
    dispatch_problem = s.CharField(allow_null=True)
    charge = s.CharField(allow_null=True)
    charge_id = s.UUIDField(allow_null=True)
    charge_provider = s.CharField(allow_blank=True)
    delivery_confirmed = s.CharField()
    delivery_refunded = s.CharField()
    delivery_remaining = s.CharField(allow_null=True)
    delivery_excess = s.CharField(allow_null=True)
    delivery_settled = s.BooleanField()
    cancellation_hold = s.BooleanField()
    dispute_open = s.BooleanField()
    completion = s.CharField()
    completed_at = s.DateTimeField(allow_null=True)
    eligible = s.BooleanField()
    provider = s.CharField(allow_blank=True)
    capabilities = s.DictField(child=s.BooleanField())


class FulfilmentCorrectionRow(s.Serializer):
    id = s.UUIDField()
    receipt = s.UUIDField()
    amount = s.CharField()
    target_version = s.IntegerField()
    paid_at = s.DateTimeField()
    description = s.CharField()
    reason = s.CharField()
    state = s.CharField()
    evidence = s.ListField(child=s.UUIDField())


@extend_schema_serializer(component_name="FulfilmentDetail")
class Detail(Summary):
    held_lines = DisplayLine(many=True)
    recipient = s.JSONField(allow_null=True)
    recipient_revision = s.IntegerField()
    arrangement = s.JSONField(allow_null=True)
    preparation = s.JSONField(allow_null=True)
    partial_permission = s.JSONField(allow_null=True)
    goods = s.ListField(child=s.JSONField())
    claims = s.ListField(child=s.JSONField())
    receipts = s.ListField(child=s.JSONField())
    corrections = FulfilmentCorrectionRow(many=True)
    proposals = s.ListField(child=s.JSONField())
    refund_providers = s.ListField(child=s.JSONField())
    delivery_refunds = s.ListField(child=s.JSONField())
    tracking = s.ListField(child=s.JSONField())
    delivery = s.JSONField(allow_null=True)
    cases = s.ListField(child=s.JSONField())
    blockers = s.ListField(child=s.JSONField())
    history = s.ListField(child=s.JSONField())
    history_page = s.IntegerField()
    history_count = s.IntegerField()


@extend_schema_serializer(component_name="FulfilmentPage")
class Page(s.Serializer):
    count = s.IntegerField()
    page = s.IntegerField()
    results = Summary(many=True)


@extend_schema_serializer(component_name="FulfilmentOutcome")
class Outcome(s.Serializer):
    result = s.JSONField()
    current = Detail()


class Recovery(s.Serializer):
    state = s.ChoiceField(choices=["unknown", "applied", "rejected"])
    result = s.JSONField(allow_null=True)


class DispatchPreview(s.Serializer):
    packet = DispatchCommand()
    recipient = s.JSONField(allow_null=True)


class HandoverQuery(Strict):
    locale = s.ChoiceField(choices=["fa-AF", "ps", "ar", "en"], default="fa-AF")
    format = s.ChoiceField(choices=["html", "pdf"], default="html")
