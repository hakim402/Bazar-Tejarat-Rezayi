from rest_framework import serializers as s
from apps.foundation.contracts import LOCALES
from .models import BUNDLES, BusinessProfile


class StrictSerializer(s.Serializer):
    def to_internal_value(self, data):
        unknown = set(data) - set(self.fields)
        if unknown:
            raise s.ValidationError({key: ["Unknown field."] for key in unknown})
        return super().to_internal_value(data)


class ProfileFields(StrictSerializer):
    display_name = s.CharField(max_length=150)
    legal_name = s.CharField(max_length=200, allow_blank=True, required=False)
    business_type = s.CharField(max_length=150, allow_blank=True, required=False)
    contact_phone = s.CharField(max_length=40, allow_blank=True, required=False)
    location = s.CharField(max_length=500, allow_blank=True, required=False)
    representative = s.CharField(max_length=200, allow_blank=True, required=False)


class ProfileCreate(ProfileFields):
    kind = s.ChoiceField(choices=BusinessProfile.Kind.values)


class BusinessProfileUpdate(ProfileFields):
    version = s.IntegerField(min_value=1)


class InvitationCreate(StrictSerializer):
    email = s.EmailField()
    bundles = s.ListField(child=s.ChoiceField(choices=BUNDLES), max_length=5)
    locale = s.ChoiceField(choices=LOCALES, default="fa-AF")


class VersionAction(StrictSerializer):
    version = s.IntegerField(min_value=1)
    action = s.ChoiceField(choices=["resend", "cancel"])


class MemberAction(StrictSerializer):
    version = s.IntegerField(min_value=1)
    action = s.ChoiceField(choices=["permissions", "revoke", "leave"])
    bundles = s.ListField(child=s.ChoiceField(choices=BUNDLES), max_length=5, default=list)


class TokenInput(StrictSerializer):
    token = s.RegexField(r"^[A-Za-z0-9_-]{40,100}$", write_only=True)


class TransferCreate(StrictSerializer):
    recipient = s.UUIDField()
    retained_bundles = s.ListField(child=s.ChoiceField(choices=BUNDLES), max_length=5)


class TransferAction(StrictSerializer):
    version = s.IntegerField(min_value=1)
    action = s.ChoiceField(choices=["accept", "cancel", "approve", "reject"])
    reason = s.CharField(max_length=1000, required=False, default="", allow_blank=True)

    def validate(self, values):
        if values["action"] in {"approve", "reject"} and not values["reason"].strip():
            raise s.ValidationError({"reason": ["A decision reason is required."]})
        return values


class MemberData(s.Serializer):
    id = s.UUIDField()
    account_id = s.UUIDField()
    name = s.CharField()
    is_owner = s.BooleanField()
    active = s.BooleanField()
    eligible = s.BooleanField()
    bundles = s.ListField(child=s.CharField())


class InvitationData(s.Serializer):
    id = s.UUIDField()
    email = s.EmailField()
    bundles = s.ListField(child=s.CharField())
    status = s.CharField()
    expires_at = s.DateTimeField()
    version = s.IntegerField()
    delivery_status = s.CharField()


class TransferData(s.Serializer):
    company_identity = s.DictField(child=s.CharField(), required=False)
    company_revision = s.IntegerField()
    id = s.UUIDField()
    company_id = s.UUIDField()
    company_name = s.CharField()
    requester_id = s.UUIDField()
    recipient_id = s.UUIDField()
    recipient_account_id = s.UUIDField()
    recipient_name = s.CharField()
    retained_bundles = s.ListField(child=s.CharField())
    status = s.CharField()
    version = s.IntegerField()
    reason = s.CharField()
    created_at = s.DateTimeField()


class ProfileData(ProfileFields):
    id = s.UUIDField()
    kind = s.CharField()
    version = s.IntegerField()
    revision = s.IntegerField()
    review_status = s.CharField()
    entitlement = s.BooleanField()
    can_manage = s.BooleanField()
    my_membership_id = s.UUIDField(allow_null=True)
    bundles = s.ListField(child=s.CharField())


class ProfilesResult(s.Serializer):
    profiles = ProfileData(many=True)


class TeamData(s.Serializer):
    members = MemberData(many=True)
    invitations = InvitationData(many=True)
    transfers = TransferData(many=True)


class InvitationPreview(s.Serializer):
    status = s.CharField()
    company_name = s.CharField(required=False)
    invited_hint = s.CharField(required=False)
    bundles = s.ListField(child=s.CharField(), required=False)


class TransferQueue(s.Serializer):
    results = TransferData(many=True)
    count = s.IntegerField()
    page = s.IntegerField()


class OperationResult(s.Serializer):
    status = s.CharField()
