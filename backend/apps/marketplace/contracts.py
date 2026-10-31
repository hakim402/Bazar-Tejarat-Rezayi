from rest_framework import serializers as s
from apps.accounts.contracts import StrictSerializer


class MarketplaceAsset(s.Serializer):
    id = s.UUIDField()
    url = s.CharField()
    width = s.IntegerField()
    height = s.IntegerField()
    alt = s.CharField()
    variant = s.UUIDField(allow_null=True, required=False)


class MarketplaceStore(s.Serializer):
    id = s.UUIDField()
    name = s.CharField()
    kind = s.ChoiceField(choices=["individual", "company"])
    country = s.CharField()
    city = s.CharField()
    description = s.CharField()
    requested_locale = s.CharField()
    resolved_locale = s.CharField()
    source_fallback = s.BooleanField()
    product_count = s.IntegerField()
    featured = s.BooleanField()
    logo = MarketplaceAsset(allow_null=True)
    banner = MarketplaceAsset(allow_null=True)


class MarketplaceVariant(s.Serializer):
    id = s.UUIDField()
    sku = s.CharField()
    active = s.BooleanField()
    attributes = s.JSONField()
    unit = s.CharField()
    increment = s.CharField()
    minimum = s.CharField()
    contents = s.CharField()
    unit_labels = s.DictField(child=s.CharField())
    attribute_labels = s.JSONField()
    retail = s.CharField(allow_null=True)
    wholesale = s.CharField(allow_null=True)
    availability = s.ChoiceField(choices=["available", "unavailable", "unknown"])


class MarketplaceBody(s.Serializer):
    title = s.CharField()
    description = s.CharField()
    brand = s.CharField()
    category = s.CharField()
    category_labels = s.DictField(child=s.CharField())
    attributes = s.JSONField()
    attribute_labels = s.JSONField()


class MarketplaceProduct(s.Serializer):
    id = s.UUIDField()
    revision = s.UUIDField()
    currency = s.ChoiceField(choices=["AFN", "USD"])
    pricing_mode = s.ChoiceField(choices=["fixed", "negotiable"])
    requested_locale = s.CharField()
    resolved_locale = s.CharField()
    source_fallback = s.BooleanField()
    body = MarketplaceBody()
    variants = MarketplaceVariant(many=True)
    images = MarketplaceAsset(many=True)
    store = MarketplaceStore()


class MarketplaceCategory(s.Serializer):
    code = s.CharField()
    name = s.CharField()
    labels = s.DictField(child=s.CharField())
    count = s.IntegerField()


class MarketplacePage(s.Serializer):
    count = s.IntegerField()
    page = s.IntegerField()
    page_size = s.IntegerField()
    facets = s.JSONField()


class MarketplaceProducts(MarketplacePage):
    results = MarketplaceProduct(many=True)
    category = MarketplaceCategory(required=False)


class MarketplaceStores(MarketplacePage):
    results = MarketplaceStore(many=True)


class MarketplaceCategories(MarketplacePage):
    results = MarketplaceCategory(many=True)


class MarketplaceHome(s.Serializer):
    categories = MarketplaceCategory(many=True)
    products = MarketplaceProduct(many=True)
    stores = MarketplaceStore(many=True)
    featured_store = MarketplaceStore(allow_null=True)


class MarketplaceSitemap(s.Serializer):
    categories = s.ListField(child=s.CharField())
    products = s.ListField(child=s.UUIDField())
    stores = s.ListField(child=s.UUIDField())
    page = s.IntegerField()
    pages = s.IntegerField()
    page_size = s.IntegerField()


class StoreSave(StrictSerializer):
    version = s.IntegerField(min_value=0)
    body = s.JSONField()


class StoreAction(StrictSerializer):
    version = s.IntegerField(min_value=0)
    revision = s.UUIDField()
    action = s.ChoiceField(choices=["submit", "withdraw"])


class StoreUpload(StrictSerializer):
    version = s.IntegerField(min_value=0)
    file = s.FileField()


class StorePrivateRevision(s.Serializer):
    id = s.UUIDField()
    number = s.IntegerField()
    body = s.JSONField()
    state = s.CharField()
    reason = s.CharField()


class StorePrivateMedia(s.Serializer):
    id = s.UUIDField()
    url = s.CharField()
    width = s.IntegerField()
    height = s.IntegerField()


class StorePrivate(s.Serializer):
    id = s.UUIDField()
    name = s.CharField()
    version = s.IntegerField()
    can_edit = s.BooleanField()
    published = s.UUIDField(allow_null=True)
    revisions = StorePrivateRevision(many=True)
    media = StorePrivateMedia(many=True)


class StoreProfile(s.Serializer):
    id = s.UUIDField()
    name = s.CharField()
    kind = s.CharField()
    can_edit = s.BooleanField()


class StoreProfiles(s.Serializer):
    results = StoreProfile(many=True)


class StoreUploadResult(StorePrivateMedia):
    version = s.IntegerField()
