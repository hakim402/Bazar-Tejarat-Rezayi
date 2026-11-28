from rest_framework import serializers

from apps.foundation.contracts import LOCALES
from apps.site.contracts import Media


class StrictSerializer(serializers.Serializer):
    def to_internal_value(self, data):
        if not isinstance(data, dict) or set(data) - set(self.fields):
            raise serializers.ValidationError({"non_field_errors": ["Unsupported fields."]})
        return super().to_internal_value(data)


class Registration(StrictSerializer):
    email = serializers.EmailField(max_length=254)
    password = serializers.CharField(min_length=12, max_length=128, write_only=True, trim_whitespace=False)
    display_name = serializers.CharField(max_length=150)
    intent = serializers.ChoiceField(choices=["individual"], default="individual")
    consent = serializers.BooleanField()
    locale = serializers.ChoiceField(choices=["fa-AF", "en", "ps", "ar"], default="fa-AF")

    def validate_consent(self, value):
        if not value:
            raise serializers.ValidationError("Terms acknowledgement is required.")
        return value


class Signin(StrictSerializer):
    email = serializers.EmailField(max_length=254)
    password = serializers.CharField(max_length=128, trim_whitespace=False, write_only=True)


class MailRequest(StrictSerializer):
    context = serializers.ChoiceField(choices=["buyer", "seller"], required=False)
    email = serializers.EmailField(max_length=254)
    locale = serializers.ChoiceField(choices=["fa-AF", "en", "ps", "ar"], default="fa-AF")


class TokenRequest(StrictSerializer):
    token = serializers.CharField(min_length=32, max_length=100, write_only=True)


class VerificationRequest(StrictSerializer):
    token = serializers.CharField(min_length=32, max_length=100, write_only=True, required=False)
    email = serializers.EmailField(max_length=254, required=False)
    code = serializers.RegexField(r"^[0-9]{6}$", write_only=True, required=False)

    def validate(self, data):
        if set(data) not in ({"token"}, {"email", "code"}):
            raise serializers.ValidationError("Supply a verification link or email and code.")
        return data


class ResetRequest(TokenRequest):
    password = serializers.CharField(min_length=12, max_length=128, write_only=True, trim_whitespace=False)


class PasswordChange(StrictSerializer):
    current_password = serializers.CharField(max_length=128, write_only=True, trim_whitespace=False)
    password = serializers.CharField(min_length=12, max_length=128, write_only=True, trim_whitespace=False)


class LinkRequest(StrictSerializer):
    password = serializers.CharField(max_length=128, write_only=True, trim_whitespace=False)
    intent = serializers.ChoiceField(choices=["individual"], default="individual")


class ProfileUpdate(StrictSerializer):
    display_name = serializers.CharField(max_length=150, required=False)
    first_name = serializers.CharField(max_length=150, required=False, allow_blank=True)
    last_name = serializers.CharField(max_length=150, required=False, allow_blank=True)
    phone = serializers.CharField(max_length=40, required=False, allow_blank=True)
    bio = serializers.CharField(max_length=2000, required=False, allow_blank=True)
    gender = serializers.ChoiceField(choices=["", "male", "female", "other", "prefer_not_to_say"], required=False, allow_blank=True)
    date_of_birth = serializers.DateField(required=False, allow_null=True)
    preferred_locale = serializers.ChoiceField(choices=["", *LOCALES], required=False, allow_blank=True)


class AvatarUpload(serializers.Serializer):
    file = serializers.FileField()


class AddressPayload(StrictSerializer):
    label = serializers.CharField(max_length=80, required=False, allow_blank=True)
    recipient_name = serializers.CharField(max_length=150, required=False, allow_blank=True)
    phone = serializers.CharField(max_length=40, required=False, allow_blank=True)
    province = serializers.CharField(max_length=120, required=False, allow_blank=True)
    city = serializers.CharField(max_length=120, required=False, allow_blank=True)
    area = serializers.CharField(max_length=120, required=False, allow_blank=True)
    street_address = serializers.CharField(max_length=400, required=False, allow_blank=True)
    landmark = serializers.CharField(max_length=200, required=False, allow_blank=True)
    is_default = serializers.BooleanField(required=False)


class AddressData(serializers.Serializer):
    id = serializers.UUIDField()
    label = serializers.CharField()
    recipient_name = serializers.CharField()
    phone = serializers.CharField()
    province = serializers.CharField()
    city = serializers.CharField()
    area = serializers.CharField()
    street_address = serializers.CharField()
    landmark = serializers.CharField()
    is_default = serializers.BooleanField()


class Empty(StrictSerializer):
    pass


class AccountData(serializers.Serializer):
    id = serializers.UUIDField()
    context = serializers.CharField()
    status = serializers.CharField()
    intent = serializers.CharField()
    review_status = serializers.CharField()
    permissions = serializers.ListField(child=serializers.CharField())


class IdentityData(serializers.Serializer):
    id = serializers.UUIDField()
    email = serializers.EmailField()
    display_name = serializers.CharField()
    email_verified = serializers.BooleanField()
    first_name = serializers.CharField()
    last_name = serializers.CharField()
    phone = serializers.CharField()
    bio = serializers.CharField()
    gender = serializers.CharField()
    date_of_birth = serializers.DateField(allow_null=True)
    preferred_locale = serializers.CharField()
    avatar = Media(allow_null=True)
    date_joined = serializers.DateTimeField()


class AuthResult(serializers.Serializer):
    status = serializers.CharField()
    expires_in = serializers.IntegerField(required=False)
    resend_after = serializers.IntegerField(required=False)
    csrf_token = serializers.CharField(required=False)
    identity = IdentityData(required=False)
    account = AccountData(required=False)
    authorization_url = serializers.URLField(required=False)
    attempt_id = serializers.UUIDField(required=False)
    return_path = serializers.CharField(required=False)


class SessionData(serializers.Serializer):
    available_contexts = serializers.ListField(child=serializers.ChoiceField(choices=["buyer", "seller"]))
    identity = IdentityData()
    accounts = serializers.ListField(child=AccountData())


class GoogleStartRequest(StrictSerializer):
    context = serializers.ChoiceField(choices=["buyer", "seller"])
    action = serializers.ChoiceField(choices=["signin", "register", "link", "add-role"])
    locale = serializers.ChoiceField(choices=["fa-AF", "en", "ps", "ar"], default="fa-AF")
    return_path = serializers.CharField(max_length=500, required=False, allow_blank=True)
    source_context = serializers.ChoiceField(choices=["buyer", "seller"], required=False)
    password = serializers.CharField(max_length=128, required=False, trim_whitespace=False, write_only=True)

    def validate(self, data):
        if data["action"] in {"link", "add-role"} and "source_context" not in data:
            raise serializers.ValidationError("Source context required.")
        return data


class GoogleCompleteRequest(StrictSerializer):
    attempt_id = serializers.UUIDField()
    consent = serializers.BooleanField()
    intent = serializers.ChoiceField(choices=["individual"], default="individual")
    display_name = serializers.CharField(max_length=150)


class ClosureRequest(StrictSerializer):
    password = serializers.CharField(max_length=128, write_only=True, trim_whitespace=False)
    confirm = serializers.BooleanField()

    def validate_confirm(self, value):
        if not value:
            raise serializers.ValidationError("Confirmation is required.")
        return value


class ClosureStatus(serializers.Serializer):
    context = serializers.ChoiceField(choices=["buyer", "seller"])
    blockers = serializers.ListField(
        child=serializers.ChoiceField(
            choices=[
                "open_orders",
                "refunds_outstanding",
                "pending_disputes",
                "open_negotiations",
                "open_payment_reviews",
                "open_delivery_reviews",
                "sole_company_owner",
            ]
        )
    )


class ClosureResult(serializers.Serializer):
    closed = serializers.BooleanField()
    context = serializers.ChoiceField(choices=["buyer", "seller"])


class AuthPolicy(serializers.Serializer):
    title = serializers.CharField()
    path = serializers.CharField()


class AuthConfiguration(serializers.Serializer):
    development = serializers.BooleanField()
    signup_enabled = serializers.BooleanField()
    policies = AuthPolicy(many=True)
