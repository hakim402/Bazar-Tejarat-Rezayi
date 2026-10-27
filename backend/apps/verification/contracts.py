from rest_framework import serializers as s
from .models import CATEGORIES
from apps.organizations.contracts import StrictSerializer


class ApplicationAction(StrictSerializer):
    version = s.IntegerField(min_value=1)
    action = s.ChoiceField(choices=["save", "submit", "revise"])
    alternative_requests = s.DictField(child=s.CharField(max_length=1000), required=False, default=dict)


class EvidenceUpload(StrictSerializer):
    version = s.IntegerField(min_value=1)
    category = s.ChoiceField(choices=CATEGORIES)
    file = s.FileField(max_length=150)
    replace_id = s.UUIDField(required=False)




class EvidenceData(s.Serializer):
    id = s.UUIDField()
    category = s.CharField()
    content_type = s.CharField()
    size = s.IntegerField()


class ReviewEventData(s.Serializer):
    id = s.UUIDField()
    action = s.CharField()
    reason = s.CharField()
    created_at = s.DateTimeField()
    context = s.CharField()




class CaseData(s.Serializer):
    id = s.UUIDField()
    profile_id = s.UUIDField()
    display_name = s.CharField()
    kind = s.CharField()
    revision = s.IntegerField()
    version = s.IntegerField()
    status = s.CharField()
    reason = s.CharField()
    assigned_to = s.UUIDField(allow_null=True)
    snapshot = s.DictField(child=s.CharField())
    categories = s.ListField(child=s.CharField())
    alternative_requests = s.DictField(child=s.CharField())
    accepted_alternatives = s.DictField(child=s.CharField())
    evidence = EvidenceData(many=True)
    history = ReviewEventData(many=True)


class ApplicationData(s.Serializer):
    current = CaseData()
    revisions = CaseData(many=True)
