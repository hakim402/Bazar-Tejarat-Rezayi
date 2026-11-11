from rest_framework import serializers as s
from apps.messaging.contracts import Strict, safe_text
from apps.payments.contracts import Money
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
    q = s.CharField(max_length=100, allow_blank=True, default="")
    state = s.ChoiceField(choices=["", "unpaid", "partial", "paid", "overpaid", "overdue"], default="")


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


class OrderCustomer(s.Serializer):
    name = s.CharField()
    email = s.EmailField()


class OrderRow(s.Serializer):
    customer = OrderCustomer(required=False)
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
    payment = s.JSONField()
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


class CancellationCommand(Strict):
    command_id = s.UUIDField()
    version = s.IntegerField(min_value=0)
    reason = s.CharField(min_length=3, max_length=1000)

    def validate_reason(self, value):
        return safe_text(value)


class CancellationWithdrawCommand(Strict):
    command_id = s.UUIDField()
    version = s.IntegerField(min_value=0)
    request = s.UUIDField()
    reason = s.CharField(min_length=3, max_length=1000)

    def validate_reason(self, value):
        return safe_text(value)


class AmendmentLineCommand(Strict):
    line = s.UUIDField()
    quantity = s.RegexField(r"^\d{1,9}\.\d{3}$")
    unit_price = s.RegexField(r"^\d{1,9}\.\d{2}$")


class AmendmentCommand(Strict):
    command_id = s.UUIDField()
    version = s.IntegerField(min_value=0)
    lines = s.ListField(child=AmendmentLineCommand(), min_length=1, max_length=100)
    reason = s.CharField(min_length=3, max_length=1000)

    def validate_reason(self, value):
        return safe_text(value)


class AmendmentWithdrawCommand(Strict):
    command_id = s.UUIDField()
    version = s.IntegerField(min_value=0)
    amendment = s.UUIDField()
    reason = s.CharField(min_length=3, max_length=1000)

    def validate_reason(self, value):
        return safe_text(value)


class AftercareOutcome(s.Serializer):
    outcome = s.JSONField()
    current = s.JSONField()


class Settled(s.Serializer):
    state = s.ChoiceField(choices=["applied", "rejected", "unknown"])
    result = s.JSONField(allow_null=True)


class AftercarePage(s.Serializer):
    results = s.ListField(child=s.JSONField())
    page = s.IntegerField()
    count = s.IntegerField()


class AftercareDetail(s.Serializer):
    id = s.UUIDField()
    version = s.IntegerField(min_value=0)
    capabilities = s.ListField(child=s.CharField())
    effective_lines = s.ListField(child=s.JSONField())
    number = s.CharField()
    invoice = s.UUIDField()
    currency = s.CharField()
    goods_total = s.CharField()
    accepted_total = s.CharField()
    payment_method = s.CharField()
    seller = s.UUIDField()
    seller_name = s.CharField()
    buyer_name = s.CharField()
    payment = s.JSONField()
    aftercare = s.DictField(child=s.BooleanField())
    cancellations = s.ListField(child=s.JSONField())
    amendments = s.ListField(child=s.JSONField())
    adjustments = s.ListField(child=s.JSONField())
    disputes = s.ListField(child=s.JSONField())
    review = s.JSONField(allow_null=True)


class CancellationDetail(s.Serializer):
    id = s.UUIDField()
    order = s.UUIDField()
    number = s.CharField()
    invoice = s.UUIDField()
    currency = s.CharField()
    state = s.ChoiceField(choices=["pending", "withdrawn", "approved", "rejected"])
    can_withdraw = s.BooleanField()
    requester_context = s.CharField()
    requester = s.UUIDField(allow_null=True)
    initiator = s.UUIDField(allow_null=True)
    payment_case = s.UUIDField(allow_null=True)
    reason = s.CharField()
    assigned = s.BooleanField()
    version = s.IntegerField()
    created_at = s.DateTimeField()
    decided_at = s.DateTimeField(allow_null=True)
    decision = s.CharField(allow_null=True)
    decision_reason = s.CharField(allow_blank=True)
    order_detail = AftercareDetail()


class DisputeOpenCommand(Strict):
    command_id = s.UUIDField()
    version = s.IntegerField(min_value=0)
    reason = s.CharField(min_length=3, max_length=1000)
    evidence = s.ListField(child=s.UUIDField(), max_length=3, default=list)

    def validate_reason(self, value):
        return safe_text(value)


class DisputeWithdrawCommand(Strict):
    command_id = s.UUIDField()
    version = s.IntegerField(min_value=0)
    dispute = s.UUIDField()
    reason = s.CharField(min_length=3, max_length=1000)

    def validate_reason(self, value):
        return safe_text(value)


class DisputeResponseCommand(Strict):
    command_id = s.UUIDField()
    version = s.IntegerField(min_value=0)
    dispute = s.UUIDField()
    text = s.CharField(min_length=3, max_length=2000)

    def validate_text(self, value):
        return safe_text(value)


class DisputeDecisionCommand(Strict):
    command_id = s.UUIDField()
    version = s.IntegerField(min_value=0)
    dispute_version = s.IntegerField(min_value=0)
    action = s.ChoiceField(choices=["assign", "dismiss", "resolve", "refund"])
    reason = s.CharField(min_length=3, max_length=1000)
    assigned_to = s.UUIDField(required=False)
    amount = Money(required=False)

    def validate_reason(self, value):
        return safe_text(value)


class ReviewSubmitCommand(Strict):
    command_id = s.UUIDField()
    version = s.IntegerField(min_value=0)
    rating = s.IntegerField(min_value=1, max_value=5)
    text = s.CharField(max_length=2000)
    language = s.ChoiceField(choices=["fa-AF", "en", "ps", "ar"])

    def validate_text(self, value):
        return safe_text(value)


class ReviewWithdrawCommand(Strict):
    command_id = s.UUIDField()
    version = s.IntegerField(min_value=0)
    reason = s.CharField(min_length=3, max_length=1000)

    def validate_reason(self, value):
        return safe_text(value)


class ReviewModerationCommand(Strict):
    command_id = s.UUIDField()
    version = s.IntegerField(min_value=0)
    review_version = s.IntegerField(min_value=0)
    action = s.ChoiceField(choices=["approve", "reject", "withdraw"])
    reason = s.CharField(min_length=3, max_length=1000)

    def validate_reason(self, value):
        return safe_text(value)


class DisputeResponseRow(s.Serializer):
    actor = s.UUIDField()
    text = s.CharField()
    created_at = s.DateTimeField()


class DisputeDecisionRow(s.Serializer):
    action = s.CharField()
    amount = s.CharField(allow_null=True)
    refund_due = s.UUIDField(allow_null=True)
    reason = s.CharField()
    created_at = s.DateTimeField()


class DisputeRow(s.Serializer):
    id = s.UUIDField()
    order = s.UUIDField()
    number = s.CharField()
    invoice = s.UUIDField()
    currency = s.CharField()
    state = s.CharField()
    can_withdraw = s.BooleanField()
    can_respond = s.BooleanField()
    evidence = s.ListField(child=s.UUIDField(), max_length=3)
    requester = s.UUIDField()
    reason = s.CharField()
    assigned = s.BooleanField()
    version = s.IntegerField()
    created_at = s.DateTimeField()
    response = DisputeResponseRow(allow_null=True)
    decision = DisputeDecisionRow(allow_null=True)


class DisputeDetail(DisputeRow):
    order_detail = AftercareDetail()


class DisputePage(s.Serializer):
    results = s.ListField(child=DisputeRow())
    page = s.IntegerField()
    count = s.IntegerField()


class ReviewStatus(s.Serializer):
    can_withdraw = s.BooleanField()
    id = s.UUIDField()
    order = s.UUIDField()
    rating = s.IntegerField()
    text = s.CharField()
    language = s.CharField()
    state = s.CharField()
    version = s.IntegerField()
    created_at = s.DateTimeField()
    decisions = s.ListField(child=s.JSONField())


class ReviewPage(s.Serializer):
    results = s.ListField(child=ReviewStatus())
    page = s.IntegerField()
    count = s.IntegerField()


class SellerIssueQuery(Strict):
    seller = s.UUIDField(required=False)
    page = s.IntegerField(min_value=1, max_value=10000, default=1)
    q = s.CharField(max_length=100, allow_blank=True, default="")
    tab = s.ChoiceField(choices=["attention", "cancellations", "corrections", "refunds", "disputes"], default="attention")


class SellerIssueOrder(s.Serializer):
    id = s.UUIDField()
    seller = s.UUIDField()
    number = s.CharField()
    buyer_name = s.CharField(allow_blank=True)
    currency = s.CharField()


class SellerIssueRow(s.Serializer):
    key = s.CharField()
    kind = s.ChoiceField(choices=["cancellation", "correction", "refund_due", "refund_report", "delivery_refund", "dispute"])
    order = SellerIssueOrder()
    amount = s.CharField(allow_null=True)
    state = s.CharField()
    date = s.DateTimeField()
    actionable = s.BooleanField()
    dispute_id = s.UUIDField(allow_null=True)


class SellerIssuePage(s.Serializer):
    count = s.IntegerField()
    page = s.IntegerField()
    results = SellerIssueRow(many=True)
