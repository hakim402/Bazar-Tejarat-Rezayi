from rest_framework import serializers as s
from apps.organizations.contracts import StrictSerializer
from .models import LOCALES, KINDS


class Link(StrictSerializer):
    id = s.SlugField(max_length=50, allow_blank=True, default="")
    label = s.CharField(max_length=120)
    target = s.CharField(max_length=180)


class Block(StrictSerializer):
    id = s.SlugField(max_length=50)
    type = s.ChoiceField(choices=["hero", "text", "steps", "guides", "callout", "catalogue", "store"])
    enabled = s.BooleanField(default=True)
    title = s.CharField(max_length=180, allow_blank=True, default="")
    text = s.CharField(max_length=6000, allow_blank=True, default="")
    items = s.ListField(child=s.CharField(max_length=1000), max_length=12, default=list)
    links = Link(many=True, default=list)
    asset = s.ChoiceField(choices=["", "welcome"], default="")
    alt = s.CharField(max_length=200, allow_blank=True, default="")


class NavGroup(StrictSerializer):
    id = s.SlugField(max_length=50, allow_blank=True, default="")
    label = s.CharField(max_length=100)
    placement = s.ChoiceField(choices=["header", "footer"])
    links = Link(many=True)


class Support(StrictSerializer):
    email = s.EmailField(allow_blank=True, default="")
    phone = s.CharField(max_length=24, allow_blank=True, default="")
    website = s.URLField(max_length=200, allow_blank=True, default="")


class Payload(StrictSerializer):
    title = s.CharField(max_length=180)
    description = s.CharField(max_length=400, allow_blank=True, default="")
    group = s.CharField(max_length=100, allow_blank=True, default="")
    blocks = Block(many=True, default=list)
    navigation = NavGroup(many=True, default=list)
    support = Support(required=False)


class Save(StrictSerializer):
    version = s.IntegerField(min_value=1)
    locale = s.ChoiceField(choices=LOCALES)
    source = s.UUIDField(required=False, allow_null=True)
    payload = Payload()


class Create(StrictSerializer):
    key = s.SlugField(max_length=80)
    kind = s.ChoiceField(choices=KINDS)


class Action(StrictSerializer):
    version = s.IntegerField(min_value=1)
    action = s.ChoiceField(choices=["submit", "return", "publish", "unpublish"])
    revision = s.UUIDField()
    reason = s.CharField(max_length=1000)
    owner_approval = s.BooleanField(default=False)
    effective_date = s.DateField(required=False)


class Operation(s.Serializer):
    id = s.UUIDField()
    version = s.IntegerField()
    revision = s.UUIDField(allow_null=True)
    state = s.CharField()


class PublicContent(s.Serializer):
    key = s.CharField()
    kind = s.CharField()
    revision = s.UUIDField()
    number = s.IntegerField()
    requested_locale = s.CharField()
    content_locale = s.CharField()
    fallback = s.BooleanField()
    available_locales = s.ListField(child=s.CharField())
    published_at = s.DateTimeField()
    effective_date = s.DateField(allow_null=True)
    payload = Payload()


class PublicShell(s.Serializer):
    navigation = PublicContent(allow_null=True)
    support = PublicContent(allow_null=True)
    announcement = PublicContent(allow_null=True)


class PublicList(s.Serializer):
    results = PublicContent(many=True)
    page = s.IntegerField()
    count = s.IntegerField()


class RevisionData(s.Serializer):
    author_name = s.CharField(source="author.display_name")
    id = s.UUIDField()
    number = s.IntegerField()
    locale = s.CharField()
    source_id = s.UUIDField(allow_null=True)
    payload = Payload()
    state = s.CharField()
    effective_date = s.DateField(allow_null=True)
    created_at = s.DateTimeField()


class EventData(s.Serializer):
    id = s.IntegerField()
    actor_name = s.CharField()
    action = s.CharField()
    reason = s.CharField()
    revision_id = s.UUIDField(allow_null=True)
    created_at = s.DateTimeField()


class EditorItem(s.Serializer):
    key = s.CharField()
    kind = s.CharField()
    id = s.UUIDField()
    version = s.IntegerField()
    revisions = RevisionData(many=True)
    publications = s.DictField(child=s.UUIDField())
    history = EventData(many=True)


class EditorSummary(s.Serializer):
    key = s.CharField()
    kind = s.CharField()
    id = s.UUIDField()
    version = s.IntegerField()
    locales = s.ListField(child=s.CharField())
    states = s.ListField(child=s.CharField())
    publications = s.DictField(child=s.UUIDField())


class EditorList(s.Serializer):
    page = s.IntegerField()
    count = s.IntegerField()
    results = EditorSummary(many=True)
    permissions = s.ListField(child=s.CharField())
