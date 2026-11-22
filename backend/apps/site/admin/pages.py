"""Content pages: pure Unfold CRUD with per-language drafts and rich-text media."""
from django.contrib import admin, messages
from django.core.exceptions import ValidationError
from django.db import DatabaseError
from django.db.models import F
from django.http import JsonResponse
from django.urls import path, reverse
from django.utils.decorators import method_decorator
from django.utils.html import format_html, format_html_join
from django.utils.translation import gettext_lazy as _
from django.views.decorators.http import require_POST
from unfold.admin import ModelAdmin
from unfold.contrib.filters.admin import ChoicesDropdownFilter
from ..forms import ContentPageForm
from ..media import store_upload, discard_created
from apps.accounts.admin.theme import SITE_THEME
from .helpers import asset_img, require_owner, state_badge
from .inlines import ContentPageLocaleInline


class ContentPageAdmin(ModelAdmin):
    """Pure Unfold CRUD for owner-managed content pages; guarded by owner_site."""

    form = ContentPageForm
    list_display = ["page_title", "slug", "group_display", "kind_display", "status_badge", "language_chips", "position", "updated_at"]
    list_filter = [("group", ChoicesDropdownFilter), ("kind", ChoicesDropdownFilter), ("status", ChoicesDropdownFilter), "show_in_footer"]
    search_fields = ["slug", "locales__title"]
    ordering = ["group", "position", "slug"]
    list_per_page = 30
    readonly_fields = ["cover_preview", "is_system", "version", "created_at", "updated_at"]
    inlines = [ContentPageLocaleInline]
    actions = ["publish_pages", "unpublish_pages"]
    fieldsets = [
        (_("Page"), {
            "fields": [("slug", "kind"), ("group", "position")],
            "classes": ["tab"],
        }),
        (_("Visibility"), {
            "fields": ["status", "show_in_footer"],
            "classes": ["tab"],
            "description": _("A page is public only in languages whose translation is published."),
        }),
        (_("Media & record"), {
            "fields": ["cover_file", "cover", "cover_preview", "is_system", "version", "created_at", "updated_at"],
            "classes": ["tab"],
            "description": _("Body images are added with the image button inside each language's rich text editor."),
        }),
    ]

    def get_urls(self):
        return [
            path("media-upload/", self.admin_site.admin_view(self.media_upload), name="site_contentpage_media_upload"),
            *super().get_urls(),
        ]

    @method_decorator(require_POST)
    def media_upload(self, request):
        """Rich-text image upload: stores into the shared SiteMedia library."""
        require_owner(request)
        upload = request.FILES.get("file")
        if not upload:
            return JsonResponse({"error": "No file received."}, status=400)
        created = []
        try:
            asset = store_upload(upload, "image", created)
        except ValidationError as error:
            discard_created(created)
            return JsonResponse({"error": " ".join(error.messages)}, status=400)
        except (OSError, DatabaseError):
            discard_created(created)
            return JsonResponse({"error": "The image could not be stored. Try again."}, status=500)
        return JsonResponse({"id": str(asset.pk), "url": reverse("site_media", kwargs={"pk": asset.pk}), "width": asset.width, "height": asset.height})

    @admin.display(description=_("Current cover"))
    def cover_preview(self, obj):
        if obj and obj.pk and obj.cover_id:
            return asset_img(obj.cover_id, SITE_THEME["cover"], _("Current cover image"))
        return _("No cover image yet.")

    def get_queryset(self, request):
        return super().get_queryset(request).prefetch_related("locales")

    @admin.display(description=_("Title"))
    def page_title(self, obj):
        rows = list(obj.locales.all())
        for code in ("fa-AF", "en"):
            for row in rows:
                if row.locale == code and row.title:
                    return row.title
        return rows[0].title if rows else obj.slug

    @admin.display(description=_("Group"), ordering="group")
    def group_display(self, obj):
        return obj.get_group_display()

    @admin.display(description=_("Kind"), ordering="kind")
    def kind_display(self, obj):
        return obj.get_kind_display()

    @admin.display(description=_("Status"), ordering="status")
    def status_badge(self, obj):
        return state_badge(_("Published"), "published") if obj.status == "published" else state_badge(_("Draft"), "hidden")

    @admin.display(description=_("Languages"))
    def language_chips(self, obj):
        rows = {row.locale: row for row in obj.locales.all()}
        labels = {"fa-AF": "دری", "en": "EN", "ps": "پښتو", "ar": "عربي"}
        tones = SITE_THEME["chip_tones"]
        chips = []
        for code, label in labels.items():
            row = rows.get(code)
            if row is None:
                tone, state = tones["missing"], _("Missing")
            elif row.is_draft:
                tone, state = tones["draft"], _("Draft")
            else:
                tone, state = tones["published"], _("Published")
            chips.append(format_html(
                f'<span class="{SITE_THEME["chip"]} {{}}" title="{{}}"><bdi>{{}}</bdi></span>',
                tone, state, label,
            ))
        return format_html(f'<span class="{SITE_THEME["chips"]}">{{}}</span>', format_html_join("", "{}", ((chip,) for chip in chips)))

    def save_model(self, request, obj, form, change):
        upload = form.cleaned_data.get("cover_file")
        if upload:
            created = []
            try:
                obj.cover = store_upload(upload, "image", created)
            except (ValidationError, OSError, DatabaseError):
                discard_created(created)
                self.message_user(request, _("The cover image could not be stored. Other changes were saved; re-select the file and save again."), messages.ERROR)
        if change:
            obj.version += 1
        super().save_model(request, obj, form, change)

    def has_delete_permission(self, request, obj=None):
        if obj is not None and obj.is_system:
            return False
        return super().has_delete_permission(request, obj)

    def delete_queryset(self, request, queryset):
        protected = queryset.filter(is_system=True).count()
        queryset.filter(is_system=False).delete()
        if protected:
            self.message_user(request, _("Core pages were kept — they can be unpublished but not deleted."), messages.WARNING)

    @admin.action(description=_("Publish selected pages"))
    def publish_pages(self, request, queryset):
        require_owner(request)
        count = queryset.update(status="published", version=F("version") + 1)
        self.message_user(request, _("%d page(s) published.") % count, messages.SUCCESS)

    @admin.action(description=_("Unpublish selected pages"))
    def unpublish_pages(self, request, queryset):
        require_owner(request)
        count = queryset.update(status="draft", version=F("version") + 1)
        self.message_user(request, _("%d page(s) unpublished.") % count, messages.SUCCESS)