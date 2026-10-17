from rest_framework import serializers

LOCALES = ["fa-AF", "en", "ps", "ar"]
BRAND_NAMES = {"fa-AF": "بازار رضایی", "en": "Bazar Rezayi", "ps": "رضايي بازار", "ar": "سوق رضائي"}


class BootstrapSerializer(serializers.Serializer):
    default_locale = serializers.ChoiceField(choices=LOCALES)
    supported_locales = serializers.ListField(child=serializers.ChoiceField(choices=LOCALES))
    brand_names = serializers.DictField(child=serializers.CharField())
    currencies = serializers.ListField(child=serializers.ChoiceField(choices=["AFN", "USD"]))


class StatusSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=["alive", "ready", "not_ready"])


class ErrorBodySerializer(serializers.Serializer):
    code = serializers.CharField()
    message = serializers.CharField()
    request_id = serializers.UUIDField()
    fields = serializers.JSONField(required=False)


class ErrorSerializer(serializers.Serializer):
    error = ErrorBodySerializer()
