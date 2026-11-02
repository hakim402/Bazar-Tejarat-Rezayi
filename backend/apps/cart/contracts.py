import json
from rest_framework import serializers as s
from rest_framework.parsers import JSONParser
from rest_framework.exceptions import ParseError
from apps.messaging.contracts import Strict
from apps.catalogue.contracts import DecimalString


class BoundedJSONParser(JSONParser):
    def parse(self, stream, media_type=None, parser_context=None):
        body = stream.read(65537)
        if len(body) > 65536:
            raise ParseError("request_size")

        def pairs(items):
            result = {}
            for key, value in items:
                if key in result:
                    raise ValueError("duplicate")
                result[key] = value
            return result

        try:
            return json.loads(body, object_pairs_hook=pairs)
        except (ValueError, UnicodeDecodeError):
            raise ParseError("invalid_json") from None


class CartMutation(Strict):
    guest_scope = s.RegexField(r"^[0-9a-f]{64}$", required=False)
    command_id = s.UUIDField()
    version = s.IntegerField(min_value=0)
    action = s.ChoiceField(choices=["set", "remove"])
    variant = s.UUIDField(required=False)
    tier = s.ChoiceField(choices=["retail", "wholesale"], required=False)
    quantity = DecimalString(max_length=20, required=False)
    line = s.UUIDField(required=False)

    def validate(self, data):
        required = {"line"} if data.get("action") == "remove" else {"variant", "tier", "quantity"}
        if set(data) - {"guest_scope"} != {"command_id", "version", "action"} | required:
            raise s.ValidationError("selection_fields")
        return data


class MergeCommand(Strict):
    command_id = s.UUIDField()
    version = s.IntegerField(min_value=0)
    guest_version = s.IntegerField(min_value=0)


class CartLine(s.Serializer):
    id = s.UUIDField()
    version = s.IntegerField()
    variant = s.UUIDField()
    product = s.UUIDField()
    seller = s.UUIDField()
    seller_name = s.CharField(allow_blank=True)
    sku = s.CharField()
    tier = s.CharField()
    quantity = s.CharField()
    increment = s.CharField()
    minimum = s.CharField()
    unit = s.CharField()
    unit_label = s.CharField()
    title = s.CharField(allow_blank=True)
    currency = s.CharField()
    mode = s.CharField()
    price = s.CharField(allow_null=True)
    available = s.BooleanField()


class CartResult(s.Serializer):
    guest_scope = s.CharField(allow_null=True, default=None)
    initialized = s.BooleanField(default=True)
    id = s.UUIDField(allow_null=True)
    version = s.IntegerField()
    guest_version = s.IntegerField()
    lines = CartLine(many=True)


class MutationResult(s.Serializer):
    version = s.IntegerField()


class MergeResult(s.Serializer):
    merged = s.BooleanField()
    version = s.IntegerField()
    lines = s.IntegerField()


class CartQuery(Strict):
    locale = s.ChoiceField(choices=["fa-AF", "ps", "ar", "en"], default="fa-AF")


class InitializeCommand(Strict):
    pass


class Initialization(s.Serializer):
    initialized = s.BooleanField()


class Reconciliation(s.Serializer):
    state = s.ChoiceField(choices=["applied", "rejected"])
    version = s.IntegerField()


class ReconcileCommand(CartMutation):
    version = s.IntegerField(min_value=0, required=False)
    action = s.ChoiceField(choices=["set", "remove"], required=False)

    def validate(self, data):
        if set(data) - {"guest_scope"} == {"command_id"}:
            return data
        return super().validate(data)
