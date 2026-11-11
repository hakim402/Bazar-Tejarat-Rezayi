"""Strict request packets: binding caps are always buyer-authored."""

from rest_framework import serializers as s
from apps.messaging.contracts import Strict, safe_text
from .contracts import Choice, DocumentQuery


class ProposalLine(Strict):
    variant = s.UUIDField()
    tier = s.ChoiceField(choices=["retail", "wholesale"])
    quantity = s.RegexField(r"^\d{1,9}(\.\d{1,3})?$")
    unit_price = s.RegexField(r"^\d{1,9}\.\d{2}$")
    max_quantity = s.RegexField(r"^\d{1,9}(\.\d{1,3})?$")
    max_unit_price = s.RegexField(r"^\d{1,9}\.\d{2}$")


class FinalLine(Strict):
    variant = s.UUIDField()
    tier = s.ChoiceField(choices=["retail", "wholesale"])
    quantity = s.RegexField(r"^\d{1,9}(\.\d{1,3})?$")
    unit_price = s.RegexField(r"^\d{1,9}\.\d{2}$")


class Proposal(Strict):
    lines = ProposalLine(many=True, min_length=1, max_length=100)
    choice = Choice()
    explanation = s.ChoiceField(choices=["seller-finalizes-v1"])
    note = s.CharField(max_length=1000, allow_blank=True, default="")

    def validate_note(self, value):
        return safe_text(value)


class SubmissionCommand(Strict):
    command_id = s.UUIDField()
    version = s.IntegerField(min_value=0)
    currency = s.ChoiceField(choices=["AFN", "USD"])
    lines = s.ListField(child=s.UUIDField(), min_length=1, max_length=100)
    proposals = Proposal(many=True, min_length=1, max_length=20)


class ActionCommand(Strict):
    command_id = s.UUIDField()
    version = s.IntegerField(min_value=1)
    reason = s.CharField(min_length=3, max_length=1000)

    def validate_reason(self, value):
        return safe_text(value)


class ResubmitCommand(ActionCommand):
    proposal = Proposal()


class FinalizeCommand(ActionCommand):
    lines = FinalLine(many=True, min_length=1, max_length=100)
    choice = Choice()


class RequestQuery(DocumentQuery):
    history_page = s.IntegerField(min_value=1, max_value=10000, default=1)
    seller = s.UUIDField(required=False)
    page = s.IntegerField(min_value=1, max_value=10000, default=1)
    state = s.ChoiceField(
        choices=["", "submitted", "correction_requested", "accepted", "withdrawn", "rejected"], default=""
    )
    q = s.CharField(max_length=100, allow_blank=True, default="")


class RequestResult(s.Serializer):
    id = s.UUIDField()
    seller = s.UUIDField()
    buyer = s.CharField()
    seller_name = s.CharField()
    currency = s.CharField()
    state = s.CharField()
    version = s.IntegerField()
    revision = s.IntegerField()
    created_at = s.DateTimeField()
    proposal = s.JSONField()
    history_count = s.IntegerField()
    history_page = s.IntegerField()
    history = s.ListField(child=s.JSONField())
    actions = s.ListField(child=s.CharField())
    order = s.UUIDField(allow_null=True)
    invoice = s.UUIDField(allow_null=True)
    can_message = s.BooleanField(required=False)
    conversation = s.UUIDField(required=False, allow_null=True)


class RequestPage(s.Serializer):
    results = RequestResult(many=True)
    count = s.IntegerField()
    page = s.IntegerField()


class SubmissionResult(s.Serializer):
    id = s.UUIDField()
    currency = s.CharField()
    pending = s.BooleanField()
    outcomes = s.ListField(child=s.JSONField())


class ConversationCommand(Strict):
    command_id = s.UUIDField()
