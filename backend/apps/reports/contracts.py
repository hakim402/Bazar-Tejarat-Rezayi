from rest_framework import serializers

from .queries import MAX_DAYS

EXPORT_KINDS = ("orders", "payments", "refunds")


class Strict(serializers.Serializer):
    def to_internal_value(self, data):
        unknown = set(data) - set(self.fields)
        if unknown:
            raise serializers.ValidationError({"query": ["unknown"]})
        return super().to_internal_value(data)


class PeriodQuery(Strict):
    start = serializers.DateField(required=False)
    end = serializers.DateField(required=False)

    def validate(self, data):
        start, end = data.get("start"), data.get("end")
        if start and end:
            if start > end:
                raise serializers.ValidationError({"start": ["after_end"]})
            if (end - start).days + 1 > MAX_DAYS:
                raise serializers.ValidationError({"start": ["period_too_long"]})
        return data


class SellerQuery(PeriodQuery):
    seller = serializers.UUIDField()


class ExportQuery(SellerQuery):
    kind = serializers.ChoiceField(choices=EXPORT_KINDS)


class Sections(serializers.Serializer):
    orders = serializers.BooleanField()
    finance = serializers.BooleanField()
    logistics = serializers.BooleanField()


class ReportProfile(serializers.Serializer):
    id = serializers.UUIDField()
    name = serializers.CharField()
    kind = serializers.CharField()
    sections = Sections()


class ReportProfiles(serializers.Serializer):
    results = ReportProfile(many=True)


class Period(serializers.Serializer):
    start = serializers.DateField()
    end = serializers.DateField()


class OrderFigure(serializers.Serializer):
    currency = serializers.CharField()
    accepted = serializers.IntegerField()
    cancelled = serializers.IntegerField()
    goods_total = serializers.CharField()
    accepted_total = serializers.CharField()


class FinanceFigure(serializers.Serializer):
    currency = serializers.CharField()
    goods_received = serializers.CharField()
    goods_receipts = serializers.IntegerField()
    goods_refunded = serializers.CharField()
    goods_net = serializers.CharField()
    refund_due_created = serializers.CharField()
    delivery_received = serializers.CharField()
    delivery_refunded = serializers.CharField()


class LogisticsFigure(serializers.Serializer):
    dispatched = serializers.IntegerField()
    delivered = serializers.IntegerField()
    completed = serializers.IntegerField()


class SellerQueues(serializers.Serializer):
    awaiting_dispatch = serializers.IntegerField(required=False)
    cancellations = serializers.IntegerField(required=False)
    amendments = serializers.IntegerField(required=False)
    disputes = serializers.IntegerField(required=False)
    reviews_pending = serializers.IntegerField(required=False)
    payment_reviews = serializers.IntegerField(required=False)
    delivery_reviews = serializers.IntegerField(required=False)
    holds = serializers.IntegerField(required=False)


class BuyerQueues(serializers.Serializer):
    cancellations = serializers.IntegerField()
    disputes = serializers.IntegerField()
    in_transit = serializers.IntegerField()


class Seller(serializers.Serializer):
    id = serializers.UUIDField()
    name = serializers.CharField()


class Summary(serializers.Serializer):
    period = Period()
    sections = Sections()
    orders = OrderFigure(many=True, allow_null=True)
    finance = FinanceFigure(many=True, allow_null=True)
    logistics = LogisticsFigure(allow_null=True)
    generated_at = serializers.DateTimeField()


class SellerSummary(Summary):
    seller = Seller()
    queues = SellerQueues()


class BuyerSummary(Summary):
    queues = BuyerQueues()
