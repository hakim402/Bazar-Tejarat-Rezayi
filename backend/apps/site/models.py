"""Fixed site settings and owner-managed homepage media; no page CMS."""
import uuid
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

LOCALES = [("fa-AF", "Dari"), ("en", "English"), ("ps", "Pashto"), ("ar", "Arabic")]
PAGES = ["home", "how-it-works", "wholesale", "sell", "about", "contact", "terms", "privacy", "help", "payment-and-delivery", "cancellations-and-disputes", "verification"]


class SiteMedia(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    kind = models.CharField(max_length=8, choices=[("image", "Image"), ("video", "Video")])
    key = models.CharField(max_length=100, unique=True)
    content_type = models.CharField(max_length=40)
    size = models.PositiveIntegerField()
    width = models.PositiveIntegerField()
    height = models.PositiveIntegerField()
    duration = models.FloatField(default=0)
    has_audio = models.BooleanField(default=False)
    pending_delete = models.BooleanField(default=False, editable=False)


class SiteSettings(models.Model):
    id = models.PositiveSmallIntegerField(primary_key=True, default=1, editable=False, validators=[MinValueValidator(1), MaxValueValidator(1)])
    version = models.PositiveIntegerField(default=1, editable=False)
    default_locale = models.CharField(max_length=5, choices=LOCALES, default="fa-AF")
    default_theme = models.CharField(max_length=6, choices=[(v, v.title()) for v in ["system", "light", "dark"]], default="system")
    indexing = models.BooleanField(default=False, verbose_name="Allow search indexing on an approved production deployment")
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=24, blank=True)
    website = models.URLField(blank=True)
    facebook = models.URLField(blank=True)
    instagram = models.URLField(blank=True)
    linkedin = models.URLField(blank=True)
    youtube = models.URLField(blank=True)
    favicon = models.ForeignKey(SiteMedia, null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    og_image = models.ForeignKey(SiteMedia, null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    announcement_enabled = models.BooleanField(default=False)
    announcement_url = models.CharField(max_length=500, blank=True)
    maintenance_enabled = models.BooleanField(default=False)
    hero_mode = models.CharField(max_length=16, choices=[(v, v.replace("_", " ").title()) for v in ["image_carousel", "video_carousel"]], default="image_carousel")
    hero_autoplay = models.BooleanField(default=False, verbose_name="Muted video autoplay")
    hero_rotate = models.BooleanField(default=False, verbose_name="Automatically rotate carousel")
    hero_interval = models.PositiveSmallIntegerField(default=8, validators=[MinValueValidator(5), MaxValueValidator(60)])
    promotion_one = models.ForeignKey("HeroSlide", null=True, blank=True, on_delete=models.SET_NULL, related_name="selected_first")
    promotion_two = models.ForeignKey("HeroSlide", null=True, blank=True, on_delete=models.SET_NULL, related_name="selected_second")

    class Meta:
        verbose_name_plural = "Site settings"
        constraints = [models.CheckConstraint(condition=models.Q(id=1), name="site_singleton")]

    def __str__(self):
        return "Site settings"


class SiteLocale(models.Model):
    settings = models.ForeignKey(SiteSettings, on_delete=models.CASCADE, related_name="locales")
    locale = models.CharField(max_length=5, choices=LOCALES, unique=True)
    name = models.CharField(max_length=120)
    tagline = models.CharField(max_length=200, blank=True)
    title_template = models.CharField(max_length=180, default="{page} | {site}")
    description = models.CharField(max_length=400, blank=True)
    address = models.CharField(max_length=400, blank=True)
    hours = models.CharField(max_length=200, blank=True)
    announcement = models.CharField(max_length=300, blank=True)
    announcement_label = models.CharField(max_length=80, blank=True)
    maintenance_title = models.CharField(max_length=180, blank=True)
    maintenance_message = models.CharField(max_length=600, blank=True)
    logo_light = models.ForeignKey(SiteMedia, null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    logo_dark = models.ForeignKey(SiteMedia, null=True, blank=True, on_delete=models.PROTECT, related_name="+")


class PageSEO(models.Model):
    settings = models.ForeignKey(SiteSettings, on_delete=models.CASCADE, related_name="seo")
    page = models.CharField(max_length=40, choices=[(v, v) for v in PAGES])
    locale = models.CharField(max_length=5, choices=LOCALES)
    title = models.CharField(max_length=180, blank=True)
    description = models.CharField(max_length=400, blank=True)
    image = models.ForeignKey(SiteMedia, null=True, blank=True, on_delete=models.PROTECT, related_name="+")

    class Meta:
        constraints = [models.UniqueConstraint(fields=["page", "locale"], name="site_page_locale")]


class HeroSlide(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    settings = models.ForeignKey(SiteSettings, on_delete=models.CASCADE, related_name="slides")
    placement = models.CharField(max_length=9, choices=[("main", "Main hero"), ("promotion", "Promotional post")], default="main")
    is_draft = models.BooleanField(default=False)
    draft_of = models.OneToOneField("self", null=True, blank=True, on_delete=models.CASCADE, related_name="pending_draft")
    updated_at = models.DateTimeField(auto_now=True)
    source_url = models.CharField(max_length=500, blank=True, verbose_name="Video source destination")
    label = models.CharField(max_length=80, default="New slide", help_text="Private owner label")
    enabled = models.BooleanField(default=False)
    position = models.PositiveSmallIntegerField(default=0)
    kind = models.CharField(max_length=5, choices=[("image", "Image"), ("video", "Video")], default="image")
    image = models.ForeignKey(SiteMedia, null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    video = models.ForeignKey(SiteMedia, null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    poster = models.ForeignKey(SiteMedia, null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    bundled_image = models.BooleanField(default=False, verbose_name="Use the approved bundled hero image")
    image_url = models.URLField(max_length=500, blank=True)
    video_url = models.URLField(max_length=500, blank=True)
    silent = models.BooleanField(default=True, verbose_name="Video contains no informative audio")

    class Meta:
        ordering = ["position", "id"]
        constraints = [models.CheckConstraint(condition=models.Q(draft_of__isnull=True) | models.Q(is_draft=True), name="site_draft_child_private")]

    def __str__(self):
        return self.label


class HeroLocale(models.Model):
    slide = models.ForeignKey(HeroSlide, on_delete=models.CASCADE, related_name="locales")
    locale = models.CharField(max_length=5, choices=LOCALES)
    title = models.CharField(max_length=180, blank=True)
    description = models.CharField(max_length=600, blank=True)
    alt = models.CharField(max_length=250, blank=True)
    cta_label = models.CharField(max_length=80, blank=True)
    cta_url = models.CharField(max_length=500, blank=True)
    transcript = models.TextField(max_length=6000, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["slide", "locale"], name="site_slide_locale")]


class SiteDraft(models.Model):
    """One working draft per fixed settings section, without revision history."""
    settings = models.ForeignKey(SiteSettings, on_delete=models.CASCADE, related_name="section_drafts")
    section = models.CharField(max_length=20)
    form_data = models.JSONField(default=dict)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["settings", "section"], name="site_one_section_draft")]


class SiteDraftUpload(models.Model):
    draft = models.ForeignKey(SiteDraft, on_delete=models.CASCADE, related_name="uploads")
    field = models.CharField(max_length=100)
    asset = models.ForeignKey(SiteMedia, on_delete=models.PROTECT)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["draft", "field"], name="site_one_draft_upload")]
