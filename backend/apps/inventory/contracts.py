from rest_framework import serializers as s


class DecimalString(s.CharField):
    def to_internal_value(self, value):
        if not isinstance(value, str):
            raise s.ValidationError("Use an exact decimal string.", code="decimal")
        return value


class StrictVersion(s.IntegerField):
    def to_internal_value(self, value):
        if type(value) is not int:
            raise s.ValidationError("Use the current integer version.", code="invalid")
        return super().to_internal_value(value)


class Capabilities(s.Serializer):
    read = s.BooleanField()
    write = s.BooleanField()


class Profile(s.Serializer):
    id = s.UUIDField()
    name = s.CharField()
    kind = s.CharField()
    verification = s.CharField()
    capabilities = Capabilities()


class Profiles(s.Serializer):
    profiles = Profile(many=True)


class Command(s.Serializer):
    token = s.UUIDField()
    version = StrictVersion(min_value=0)
    reason = s.CharField(max_length=1000)
    reference = s.CharField(max_length=120, required=False, allow_blank=True)


class Configure(Command):
    tracking = s.ChoiceField(choices=["plain", "batch"])
    expiry_required = s.BooleanField()
    threshold = DecimalString(max_length=20, allow_blank=True, allow_null=True, required=False)


class Receipt(Command):
    quantity = DecimalString(max_length=20)
    batch = s.UUIDField(required=False, allow_null=True)
    batch_code = s.CharField(max_length=80, required=False, allow_blank=True)
    expires_on = s.DateField(required=False, allow_null=True)


class Operation(s.Serializer):
    operation = s.UUIDField()
    status = s.CharField()
    version = s.IntegerField()


class Batch(s.Serializer):
    id = s.UUIDField()
    code = s.CharField()
    expires_on = s.DateField(allow_null=True)
    physical = s.CharField()
    held = s.CharField()
    available = s.CharField()
    expired = s.BooleanField()
    expiring = s.BooleanField()


class Movement(s.Serializer):
    id = s.UUIDField()
    variant = s.UUIDField()
    batch = s.UUIDField(allow_null=True)
    sku = s.CharField()
    unit = s.CharField()
    unit_labels = s.DictField(child=s.CharField())
    action = s.CharField()
    physical_delta = s.CharField()
    held_delta = s.CharField()
    physical_after = s.CharField()
    held_after = s.CharField()
    actor = s.CharField()
    reason = s.CharField()
    reference = s.CharField()
    operation = s.UUIDField()
    at = s.DateTimeField()


class Position(s.Serializer):
    id = s.UUIDField()
    product = s.UUIDField()
    title = s.CharField()
    sku = s.CharField()
    unit = s.CharField()
    unit_labels = s.DictField(child=s.CharField())
    increment = s.CharField()
    eligible = s.BooleanField()
    configured = s.BooleanField()
    tracking = s.CharField(allow_null=True)
    expiry_required = s.BooleanField()
    version = s.IntegerField()
    threshold = s.CharField(allow_null=True)
    physical = s.CharField()
    held = s.CharField()
    available = s.CharField(allow_null=True)
    expired = s.CharField()
    expiring = s.CharField()
    state = s.CharField()
    capabilities = Capabilities()
    batches = Batch(many=True, required=False)
    movements = Movement(many=True, required=False)


class Overview(s.Serializer):
    results = Position(many=True)
    count = s.IntegerField()
    page = s.IntegerField()
    page_size = s.IntegerField()
    counts = s.DictField(child=s.IntegerField())
    catalogue_count = s.IntegerField()
    capabilities = Capabilities()
    recent = Movement(many=True)


class History(s.Serializer):
    results = Movement(many=True)
    count = s.IntegerField()
    page = s.IntegerField()
    page_size = s.IntegerField()


class ShortageLine(s.Serializer):
    sku = s.CharField()
    unit = s.CharField()
    unit_labels = s.DictField(child=s.CharField())
    variant = s.UUIDField()
    batch = s.UUIDField(allow_null=True)
    requested = s.CharField()
    available = s.CharField()


class Shortage(s.Serializer):
    id = s.UUIDField()
    seller = s.CharField()
    reference = s.CharField()
    at = s.DateTimeField()
    lines = ShortageLine(many=True)
    recovery_of = s.UUIDField(allow_null=True)
