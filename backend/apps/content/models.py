import uuid
from django.conf import settings
from django.db import models

LOCALES = ["fa-AF", "en", "ps", "ar"]
KINDS = ["page", "article", "home", "shell", "support", "announcement", "legal"]
FIXED = {
    "home": "home",
    "navigation": "shell",
    "support": "support",
    "announcement": "announcement",
    "how-it-works": "page",
    "wholesale": "page",
    "sell": "page",
    "about": "page",
    "contact": "page",
    "terms": "legal",
    "privacy": "legal",
}


class ContentItem(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    key = models.SlugField(max_length=80, unique=True)
    kind = models.CharField(max_length=16, choices=[(v, v) for v in KINDS])
    version = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        permissions = [
            (v, v.replace("_", " ")) for v in ["read_drafts", "edit_content", "publish_content", "manage_settings"]
        ]

    def __str__(self):
        return self.key


class ContentRevision(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    item = models.ForeignKey(ContentItem, on_delete=models.PROTECT, related_name="revisions")
    number = models.PositiveIntegerField()
    locale = models.CharField(max_length=5, choices=[(v, v) for v in LOCALES])
    source = models.ForeignKey("self", null=True, blank=True, on_delete=models.PROTECT)
    payload = models.JSONField()
    state = models.CharField(
        max_length=12, default="draft", choices=[(v, v) for v in ["draft", "submitted", "returned", "published"]]
    )
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)
    effective_date = models.DateField(null=True, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["item", "number"], name="content_revision_number")]

    def __str__(self):
        return f"{self.item.key} / {self.locale} / {self.number}"


class Publication(models.Model):
    item = models.ForeignKey(ContentItem, on_delete=models.PROTECT, related_name="publications")
    locale = models.CharField(max_length=5)
    revision = models.OneToOneField(ContentRevision, on_delete=models.PROTECT, related_name="selection")
    publisher = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    published_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["item", "locale"], name="content_publication_locale")]


class ContentEvent(models.Model):
    item = models.ForeignKey(ContentItem, on_delete=models.PROTECT, related_name="events")
    revision = models.ForeignKey(ContentRevision, null=True, on_delete=models.PROTECT)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    context = models.CharField(max_length=8)
    action = models.CharField(max_length=16)
    reason = models.CharField(max_length=1000)
    created_at = models.DateTimeField(auto_now_add=True)
