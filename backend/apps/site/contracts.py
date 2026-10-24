from rest_framework import serializers as s
from .models import PAGES
from apps.foundation.contracts import LOCALES


class Media(s.Serializer):
    url = s.CharField()
    width = s.IntegerField()
    height = s.IntegerField()
    content_type = s.CharField()


class Identity(s.Serializer):
    name = s.CharField()
    tagline = s.CharField()
    title_template = s.CharField()
    description = s.CharField()
    address = s.CharField()
    hours = s.CharField()
    logo_light = Media(allow_null=True)
    logo_dark = Media(allow_null=True)
    content_locale = s.ChoiceField(choices=LOCALES)
    fallback = s.BooleanField()


class Notice(s.Serializer):
    enabled = s.BooleanField()
    text = s.CharField()
    title = s.CharField()
    label = s.CharField()
    url = s.CharField()
    content_locale = s.ChoiceField(choices=LOCALES)
    fallback = s.BooleanField()


class Slide(s.Serializer):
    id = s.UUIDField()
    kind = s.ChoiceField(choices=["image", "video"])
    image = Media(allow_null=True)
    video = Media(allow_null=True)
    poster = Media(allow_null=True)
    title = s.CharField()
    description = s.CharField()
    alt = s.CharField()
    cta_label = s.CharField()
    cta_url = s.CharField()
    transcript = s.CharField()
    source_url = s.CharField()
    content_locale = s.ChoiceField(choices=LOCALES)
    fallback = s.BooleanField()


class PromotionalCard(Slide):
    kind = s.CharField()
    slot = s.ChoiceField(choices=["promo_1", "promo_2"])


class Hero(s.Serializer):
    mode = s.ChoiceField(choices=["image_carousel", "video_carousel"])
    autoplay = s.BooleanField()
    rotate = s.BooleanField()
    interval = s.IntegerField(min_value=5, max_value=60)
    slides = Slide(many=True)
    cards = PromotionalCard(many=True)


class Contacts(s.Serializer):
    email = s.CharField()
    phone = s.CharField()
    website = s.CharField()
    facebook = s.CharField()
    instagram = s.CharField()
    linkedin = s.CharField()
    youtube = s.CharField()


class SEO(s.Serializer):
    page = s.ChoiceField(choices=PAGES)
    title = s.CharField()
    description = s.CharField()
    image = Media(allow_null=True)


class PublicSite(s.Serializer):
    default_locale = s.ChoiceField(choices=LOCALES)
    default_theme = s.ChoiceField(choices=["system", "light", "dark"])
    indexing = s.BooleanField()
    identity = Identity()
    contacts = Contacts()
    favicon = Media(allow_null=True)
    og_image = Media(allow_null=True)
    announcement = Notice()
    maintenance = Notice()
    hero = Hero()
    seo = SEO(many=True)
    media_hosts = s.ListField(child=s.CharField())
