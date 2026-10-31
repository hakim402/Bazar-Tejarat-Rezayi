from rest_framework import serializers as s
from apps.messaging.contracts import Strict, safe_text
from .validation import COUNTRIES, city


class Destination(Strict):
    country = s.ChoiceField(choices=sorted(COUNTRIES))
    all_cities = s.BooleanField()
    cities = s.ListField(child=s.CharField(max_length=100), max_length=20)


class TermsCommand(Strict):
    version = s.IntegerField(min_value=0)
    enabled = s.BooleanField()
    destinations = Destination(many=True, max_length=20)
    methods = s.ListField(child=s.ChoiceField(choices=["advance", "cod"]), max_length=2)
    reason = s.CharField(min_length=3, max_length=1000)

    def validate_reason(self, value):
        return safe_text(value)


class TermsResult(s.Serializer):
    seller = s.UUIDField()
    version = s.IntegerField()
    enabled = s.BooleanField()
    destinations = Destination(many=True)
    methods = s.ListField(child=s.CharField())


class Choice(Strict):
    seller = s.UUIDField()
    country = s.ChoiceField(choices=sorted(COUNTRIES))
    city = s.CharField(max_length=100)
    method = s.ChoiceField(choices=["advance", "cod"])

    def validate_city(self, value):
        return city(value)


class ShownPrice(Strict):
    line = s.UUIDField()
    price = s.RegexField(r"^\d{1,9}\.\d{2}$")


class CheckoutCommand(Strict):
    command_id = s.UUIDField()
    version = s.IntegerField(min_value=0)
    currency = s.ChoiceField(choices=["AFN", "USD"])
    lines = s.ListField(child=s.UUIDField(), min_length=1, max_length=100)
    choices = Choice(many=True, min_length=1, max_length=20)
    shown_prices = ShownPrice(many=True, max_length=100, default=list)
    locale = s.ChoiceField(choices=["fa-AF", "ps", "ar", "en"], default="fa-AF")


class Query(Strict):
    page = s.IntegerField(min_value=1, max_value=10000, default=1)
    seller = s.UUIDField(required=False)
    locale = s.ChoiceField(choices=["fa-AF", "ps", "ar", "en"], default="fa-AF")


class Outcome(s.Serializer):
    seller = s.UUIDField()
    state = s.CharField()
    code = s.CharField(allow_blank=True)
    order = s.UUIDField(allow_null=True)
    invoice = s.UUIDField(allow_null=True)
    number = s.CharField(allow_null=True)
    goods_total = s.CharField(allow_null=True)
    accepted_at = s.DateTimeField(allow_null=True)
    price_changed = s.BooleanField()


class Submission(s.Serializer):
    id = s.UUIDField()
    pending = s.BooleanField()
    currency = s.CharField()
    created_at = s.DateTimeField()
    outcomes = Outcome(many=True)


class SubmissionPage(s.Serializer):
    results = Submission(many=True)
    page = s.IntegerField()
    count = s.IntegerField()


class OrderRow(s.Serializer):
    id = s.UUIDField()
    seller = s.UUIDField()
    currency = s.CharField()
    goods_total = s.CharField()
    payment_method = s.CharField()
    accepted_at = s.DateTimeField()
    issued_at = s.DateTimeField()
    due_at = s.DateTimeField(allow_null=True)
    invoice = s.UUIDField()
    number = s.CharField()
    snapshot = s.JSONField()
    dimensions = s.DictField(child=s.CharField())
    capabilities = s.DictField(child=s.BooleanField())
    lines = s.ListField(child=s.JSONField())


class OrderPage(s.Serializer):
    results = OrderRow(many=True)
    count = s.IntegerField()
    page = s.IntegerField()


class OrderProfile(s.Serializer):
    id = s.UUIDField()
    name = s.CharField()
    orders = s.BooleanField()
    invoices = s.BooleanField()
    terms = s.BooleanField()


class OrderProfiles(s.Serializer):
    results = OrderProfile(many=True)


class ReviewResult(s.Serializer):
    results = s.ListField(child=s.JSONField())
    binding = s.BooleanField()


class TermsQuery(Strict):
    context = s.ChoiceField(choices=["buyer", "seller"], default="seller")


class EmptyCommand(Strict):
    pass


class DocumentQuery(Strict):
    locale = s.ChoiceField(choices=["fa-AF", "ps", "ar", "en"], default="fa-AF")
