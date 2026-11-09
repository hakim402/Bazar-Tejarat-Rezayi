from rest_framework import serializers as s


class Strict(s.Serializer):
    def to_internal_value(self, data):
        if not hasattr(data, "keys") or set(data.keys()) - set(self.fields):
            raise s.ValidationError({"fields": ["unknown"]})
        if any(len(data.getlist(k)) != 1 for k in data if hasattr(data, "getlist")):
            raise s.ValidationError({"fields": ["duplicate"]})
        return super().to_internal_value(data)


def safe_text(value):
    if any(
        ord(char) in {*range(0x202A, 0x202F), *range(0x2066, 0x206A)} or ord(char) < 32 and char not in "\n\r\t"
        for char in value
    ):
        raise s.ValidationError("unsafe_controls", code="unsafe_controls")
    return value


class MessageCommand(Strict):
    command_id = s.UUIDField()
    body = s.CharField(max_length=6000, allow_blank=True, trim_whitespace=False, default="")
    images = s.ListField(child=s.UUIDField(), max_length=3, default=list)

    def validate_body(self, value):
        return safe_text(value)

    def validate(self, data):
        if not data["body"].strip() and not data["images"]:
            raise s.ValidationError({"body": ["message_required"]})
        return data


class EnquiryCommand(MessageCommand):
    product = s.UUIDField()
    locale = s.ChoiceField(choices=["fa-AF", "ps", "ar", "en"], default="fa-AF")


class UploadCommand(Strict):
    command_id = s.UUIDField()
    file = s.FileField()


class ReadCommand(Strict):
    sequence = s.IntegerField(min_value=0)
    receipt = s.CharField(max_length=2000)


class ReportCommand(Strict):
    command_id = s.UUIDField()
    category = s.ChoiceField(choices=["abuse", "fraud", "spam", "privacy", "other"])
    reason = s.CharField(min_length=3, max_length=1000)

    def validate_reason(self, value):
        return safe_text(value)


class TargetReportCommand(Strict):
    command_id = s.UUIDField()
    category = s.ChoiceField(choices=["abuse", "fraud", "spam", "privacy", "other"])
    reason = s.CharField(min_length=3, max_length=1000)

    def validate_reason(self, value):
        return safe_text(value)


class ListQuery(Strict):
    page = s.IntegerField(min_value=1, max_value=10000, default=1)
    seller = s.UUIDField(required=False)
    unread = s.BooleanField(default=False)


class HistoryQuery(Strict):
    before = s.IntegerField(min_value=1, required=False)
    after = s.IntegerField(min_value=0, required=False)
    limit = s.IntegerField(min_value=1, max_value=50, default=50)

    def validate(self, data):
        if "before" in data and "after" in data:
            raise s.ValidationError({"cursor": ["conflict"]})
        return data


class Snapshot(s.Serializer):
    product = s.UUIDField()
    revision = s.UUIDField()
    title = s.CharField()
    currency = s.CharField()
    seller = s.CharField()


class ConversationRow(s.Serializer):
    id = s.UUIDField()
    snapshot = Snapshot()
    updated_at = s.DateTimeField()
    unread = s.BooleanField()
    sequence = s.IntegerField()
    seller = s.UUIDField()


class ConversationPage(s.Serializer):
    results = ConversationRow(many=True)
    page = s.IntegerField()
    count = s.IntegerField()


class ConversationDetail(s.Serializer):
    id = s.UUIDField()
    snapshot = Snapshot()
    seller = s.UUIDField()
    sequence = s.IntegerField()
    can_send = s.BooleanField()
    last_read = s.IntegerField()
    unread = s.BooleanField()


class ImageResult(s.Serializer):
    id = s.UUIDField()
    width = s.IntegerField()
    height = s.IntegerField()
    size = s.IntegerField()


class MessageRow(s.Serializer):
    id = s.UUIDField()
    sequence = s.IntegerField()
    body = s.CharField(allow_blank=True)
    author = s.CharField()
    context = s.CharField()
    own = s.BooleanField()
    created_at = s.DateTimeField()
    images = ImageResult(many=True)


class MessagingHistory(s.Serializer):
    results = MessageRow(many=True)
    has_more = s.BooleanField()
    oldest = s.IntegerField(allow_null=True)
    latest = s.IntegerField()
    receipt = s.CharField()


class Sent(s.Serializer):
    conversation = s.UUIDField()
    message = s.UUIDField()
    sequence = s.IntegerField()


class ReportResult(s.Serializer):
    id = s.UUIDField()
    status = s.CharField()
    version = s.IntegerField()
    created_at = s.DateTimeField(required=False)


class ReportPage(s.Serializer):
    results = ReportResult(many=True)


class ReportPageQuery(Strict):
    page = s.IntegerField(min_value=1, max_value=10000, default=1)


class OwnReportResult(s.Serializer):
    id = s.UUIDField()
    status = s.CharField()
    version = s.IntegerField()
    created_at = s.DateTimeField(required=False)
    target_kind = s.ChoiceField(choices=["message", "product", "store", "order"])
    target = s.UUIDField()


class OwnReportPage(s.Serializer):
    results = OwnReportResult(many=True)
    page = s.IntegerField()
    count = s.IntegerField()


class ReadResult(s.Serializer):
    last_read = s.IntegerField()


class MessagingProfile(s.Serializer):
    id = s.UUIDField()
    name = s.CharField()
    kind = s.CharField()
    messaging = s.BooleanField()


class MessagingProfiles(s.Serializer):
    results = MessagingProfile(many=True)
    page = s.IntegerField()
    count = s.IntegerField()


class ExistingConversation(s.Serializer):
    code = s.ChoiceField(choices=["conversation_exists"])
    conversation = s.UUIDField()
