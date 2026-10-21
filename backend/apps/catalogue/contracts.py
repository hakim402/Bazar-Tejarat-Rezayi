from rest_framework import serializers as s
from .models import LOCALES


class DecimalString(s.CharField):
    def to_internal_value(self, data):
        if not isinstance(data, str):
            self.fail("invalid")
        return super().to_internal_value(data)


class CatalogueCreate(s.Serializer):
    seller = s.UUIDField()
    currency = s.ChoiceField(choices=["AFN", "USD"])
    pricing_mode = s.ChoiceField(choices=["fixed", "negotiable"])


class CatalogueImageRef(s.Serializer):
    id = s.UUIDField()
    alt = s.CharField(max_length=200)
    variant = s.UUIDField(required=False, allow_null=True)


class CatalogueVariantInput(s.Serializer):
    id = s.UUIDField(required=False, allow_null=True)
    sku = s.RegexField(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$")
    unit = s.CharField(max_length=16)
    increment = DecimalString(max_length=20)
    minimum = DecimalString(max_length=20)
    contents = s.CharField(max_length=200, required=False, allow_blank=True, default="")
    attributes = s.JSONField(default=dict)
    active = s.BooleanField(default=True)
    retail = DecimalString(required=False, allow_blank=True, allow_null=True)
    wholesale = DecimalString(required=False, allow_blank=True, allow_null=True)


class CatalogueBody(s.Serializer):
    title = s.CharField(max_length=200, allow_blank=True)
    description = s.CharField(max_length=6000, allow_blank=True)
    brand = s.CharField(max_length=100, allow_blank=True, default="")
    locale = s.ChoiceField(choices=LOCALES)
    category = s.CharField(max_length=40)
    attributes = s.JSONField(default=dict)
    variants = CatalogueVariantInput(many=True, max_length=40, allow_empty=False)
    images = CatalogueImageRef(many=True, max_length=12)


class CatalogueSave(s.Serializer):
    version = s.IntegerField(min_value=1)
    body = CatalogueBody()


class CatalogueAction(s.Serializer):
    version = s.IntegerField(min_value=1)
    revision = s.UUIDField()
    action = s.ChoiceField(choices=["submit", "withdraw", "publish", "reject", "unpublish"])
    reason = s.CharField(max_length=1000, allow_blank=True, default="")


class CataloguePriceInput(s.Serializer):
    id = s.UUIDField()
    retail = DecimalString(required=False, allow_blank=True, allow_null=True)
    wholesale = DecimalString(required=False, allow_blank=True, allow_null=True)


class CataloguePrices(s.Serializer):
    version = s.IntegerField(min_value=1)
    prices = CataloguePriceInput(many=True, max_length=40, allow_empty=False)


class CatalogueTranslationInput(s.Serializer):
    version = s.IntegerField(min_value=1)
    action = s.ChoiceField(choices=["save", "approve", "reject", "generate", "retry"])
    title = s.CharField(max_length=200, allow_blank=True, required=False)
    description = s.CharField(max_length=6000, allow_blank=True, required=False)
    image_alts = s.DictField(child=s.CharField(allow_blank=True, trim_whitespace=False), required=False)
    reason = s.CharField(max_length=1000, allow_blank=True, required=False)


class CatalogueTaxonomyInput(s.Serializer):
    version = s.IntegerField(min_value=0)
    code = s.SlugField(max_length=40)
    labels = s.DictField(child=s.CharField(max_length=100))
    parent = s.SlugField(max_length=40, allow_null=True, required=False, default=None)
    attributes = s.JSONField(default=list)
    units = s.ListField(child=s.CharField(max_length=16), max_length=9, allow_empty=False)
    active = s.BooleanField(default=True)


class CatalogueOperation(s.Serializer):
    id = s.UUIDField()
    version = s.IntegerField()
    revision = s.UUIDField(allow_null=True)


class CatalogueRevision(s.Serializer):
    id = s.UUIDField()
    number = s.IntegerField()
    state = s.CharField()
    body = s.JSONField()
    reason = s.CharField()


class CatalogueDetail(s.Serializer):
    id = s.UUIDField()
    seller = s.UUIDField()
    seller_name = s.CharField()
    currency = s.CharField()
    pricing_mode = s.CharField()
    version = s.IntegerField()
    published = s.UUIDField(allow_null=True)
    revisions = CatalogueRevision(many=True)
    images = s.ListField(child=s.JSONField())
    prices = s.ListField(child=s.JSONField())
    price_history = s.ListField(child=s.JSONField())
    translations = s.ListField(child=s.JSONField())
    permissions = s.ListField(child=s.CharField())
    provider = s.CharField()


class CatalogueList(s.Serializer):
    results = s.ListField(child=s.JSONField())
    sellers = s.ListField(child=s.JSONField())
    permissions = s.ListField(child=s.CharField())
    count = s.IntegerField()
    page = s.IntegerField()


class CatalogueTaxonomy(s.Serializer):
    categories = s.ListField(child=s.JSONField())
    units = s.ListField(child=s.JSONField())


class CatalogueImage(s.Serializer):
    version = s.IntegerField()
    id = s.UUIDField()
    width = s.IntegerField()
    height = s.IntegerField()
    url = s.CharField()


class CataloguePublic(s.Serializer):
    id = s.UUIDField()
    revision = s.UUIDField()
    seller_name = s.CharField()
    currency = s.CharField()
    pricing_mode = s.CharField()
    requested_locale = s.CharField()
    resolved_locale = s.CharField()
    source_fallback = s.BooleanField()
    body = s.JSONField()
    variants = s.ListField(child=s.JSONField())
    images = s.ListField(child=s.JSONField())


class CatalogueUnitInput(s.Serializer):
    version = s.IntegerField(min_value=0)
    code = s.SlugField(max_length=16)
    labels = s.DictField(child=s.CharField(max_length=100))
    fractional = s.BooleanField()
    active = s.BooleanField()
