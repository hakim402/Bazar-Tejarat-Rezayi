from rest_framework import serializers


class StrictSerializer(serializers.Serializer):
    def to_internal_value(self, data):
        if not isinstance(data, dict) or set(data) - set(self.fields):
            raise serializers.ValidationError({"non_field_errors": ["Unsupported fields."]})
        return super().to_internal_value(data)


class Registration(StrictSerializer):
    email = serializers.EmailField(max_length=254)
    password = serializers.CharField(min_length=12, max_length=128, write_only=True, trim_whitespace=False)
    display_name = serializers.CharField(max_length=150)
    intent = serializers.ChoiceField(choices=["individual", "business", "company"])
    consent = serializers.BooleanField()
    locale = serializers.ChoiceField(choices=["fa-AF", "en", "ps", "ar"], default="fa-AF")

    def validate_consent(self, value):
        if not value:
            raise serializers.ValidationError("Development policy acknowledgement is required.")
        return value


class Signin(StrictSerializer):
    email = serializers.EmailField(max_length=254)
    password = serializers.CharField(max_length=128, trim_whitespace=False, write_only=True)


class MailRequest(StrictSerializer):
    email = serializers.EmailField(max_length=254)
    locale = serializers.ChoiceField(choices=["fa-AF", "en", "ps", "ar"], default="fa-AF")


class TokenRequest(StrictSerializer):
    token = serializers.CharField(min_length=32, max_length=100, write_only=True)


class ResetRequest(TokenRequest):
    password = serializers.CharField(min_length=12, max_length=128, write_only=True, trim_whitespace=False)


class PasswordChange(StrictSerializer):
    current_password = serializers.CharField(max_length=128, write_only=True, trim_whitespace=False)
    password = serializers.CharField(min_length=12, max_length=128, write_only=True, trim_whitespace=False)


class LinkRequest(StrictSerializer):
    password = serializers.CharField(max_length=128, write_only=True, trim_whitespace=False)
    intent = serializers.ChoiceField(choices=["individual", "business", "company"])


class ProfileUpdate(StrictSerializer):
    display_name = serializers.CharField(max_length=150)


class Challenge(StrictSerializer):
    code = serializers.CharField(min_length=6, max_length=32, write_only=True, trim_whitespace=False)
    recovery = serializers.BooleanField(default=False)


class FactorReset(Challenge):
    password = serializers.CharField(max_length=128, write_only=True, trim_whitespace=False)


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


class AuthResult(serializers.Serializer):
    status = serializers.CharField()
    csrf_token = serializers.CharField(required=False)
    identity = IdentityData(required=False)
    account = AccountData(required=False)
    recovery_codes = serializers.ListField(child=serializers.CharField(), required=False)
    secret = serializers.CharField(required=False)
    uri = serializers.CharField(required=False)
    authorization_url = serializers.URLField(required=False)
    attempt_id = serializers.UUIDField(required=False)
    return_path = serializers.CharField(required=False)


class SessionData(serializers.Serializer):
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
    intent = serializers.ChoiceField(choices=["individual", "business", "company"])
    display_name = serializers.CharField(max_length=150)
