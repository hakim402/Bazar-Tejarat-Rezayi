from rest_framework import serializers as s
from apps.messaging.contracts import Strict


class PreferenceCommand(Strict):
    message_email = s.BooleanField()
    locale = s.ChoiceField(choices=["fa-AF", "ps", "ar", "en"])
    version = s.IntegerField(min_value=0)


class EmailPreference(s.Serializer):
    message_email = s.BooleanField()
    locale = s.CharField()
    version = s.IntegerField()


class NoticeRow(s.Serializer):
    id = s.UUIDField()
    kind = s.ChoiceField(choices=["message", "report_status", "order_accepted"])
    conversation = s.UUIDField(allow_null=True)
    order = s.UUIDField(allow_null=True)
    invoice = s.UUIDField(allow_null=True)
    seller = s.UUIDField()
    read = s.BooleanField()
    created_at = s.DateTimeField()


class NoticePage(s.Serializer):
    results = NoticeRow(many=True)
    count = s.IntegerField()
    page = s.IntegerField()


class Counts(s.Serializer):
    unread_notices = s.IntegerField()
    unread_threads = s.IntegerField()


class NoticeRead(s.Serializer):
    read = s.BooleanField()


class EmptyCommand(Strict):
    pass
