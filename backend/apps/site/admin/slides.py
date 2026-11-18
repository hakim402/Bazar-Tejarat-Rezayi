"""Homepage media: a native Unfold library plus the draft/publish post editor."""
from django.conf import settings
from django.contrib import admin, messages
from django.core.exceptions import ValidationError
from django.db.models import Q
from django.http import HttpResponseRedirect
from django.urls import reverse
from django.utils.html import format_html
from django.utils.translation import gettext_lazy as _
from unfold.admin import ModelAdmin
from unfold.contrib.filters.admin import ChoicesDropdownFilter
from unfold.decorators import action
from ..forms import PostForm, HERO_TEXT
from ..models import SiteSettings, SiteMedia, LOCALES
from ..services import draft_for, save_post, delete_post
from .helpers import ServiceFormMixin, asset_img, asset_video, slide_thumbnail, slide_state, submit_pressed, with_initial


class DraftStateFilter(admin.SimpleListFilter):
    """Separate draft-only posts and published posts with pending changes."""

    title = _("Draft state")
    parameter_name = "draft_state"

    def lookups(self, request, model_admin):
        return [("draft", _("Has draft changes")), ("published", _("Published"))]

    def queryset(self, request, queryset):
        if self.value() == "draft":
            return queryset.filter(Q(is_draft=True) | Q(pending_draft__isnull=False))
        if self.value() == "published":
            return queryset.filter(is_draft=False)
        return queryset


class HeroSlideAdmin(ServiceFormMixin, ModelAdmin):
    """Public identities only; the editor transparently works on the pending draft."""

    form = PostForm
    list_display = ["thumbnail", "label", "placement", "kind", "state", "updated_at"]
    list_filter = [("placement", ChoicesDropdownFilter), ("kind", ChoicesDropdownFilter), DraftStateFilter, "enabled"]
    search_fields = ["label"]
    ordering = ["-updated_at", "id"]
    list_per_page = 24
    actions_submit_line = ["save_draft", "publish"]
    warn_unsaved_form = True
    readonly_fields = ["media_preview"]
    fieldsets = [
        (_("Post details"), {
            "fields": ["version", "label", "placement", "kind", "enabled", "position"],
            "classes": ("tab",),
            "description": _("Save draft keeps your work private. Publish updates the public version. Videos show no visible headline or button; clicking opens their source destination."),
        }),
        (_("Image or video"), {
            "fields": ["bundled_image", "image_file", "clear_image", "image_url", "video_file", "poster_file", "clear_video", "video_url", "source_url", "silent", "media_preview"],
            "classes": ("tab",),
            "description": _("Images: PNG, JPEG or WebP, up to 8 MiB. Videos: H.264 MP4, up to 50 MiB and 60 seconds. An uploaded video gets a poster automatically; you can upload your own poster instead."),
        }),
        *[(caption, {
            "fields": [f"{code}_{name}" for name in HERO_TEXT],
            "classes": ("tab",),
            "description": _("Start with Dari. Other languages are optional and fall back to Dari when blank.") if code == "fa-AF" else "",
        }) for code, caption in LOCALES],
    ]

    def get_queryset(self, request):
        return super().get_queryset(request).filter(draft_of__isnull=True).select_related("image", "poster", "pending_draft")

    def get_fieldsets(self, request, obj=None):
        fieldsets = super().get_fieldsets(request, obj)
        working = draft_for(obj) if obj is not None else None
        # Hide the preview placeholder until the working version has media.
        if working is None or not (working.image_id or working.video_id or working.bundled_image):
            fieldsets = [(name, {**opts, "fields": [f for f in opts["fields"] if f != "media_preview"]}) for name, opts in fieldsets]
        return fieldsets

    def get_form(self, request, obj=None, **kwargs):
        base = super().get_form(request, obj, **kwargs)
        data = request.POST if request.method == "POST" else None
        # Existing posts keep their placement; only add forms may choose one.
        placement = (obj.placement if obj is not None else "") or (data.get("placement") if data else "") or request.GET.get("placement") or "main"
        version = SiteSettings.objects.filter(pk=1).values_list("version", flat=True).first() or 0

        class WorkingForm(base):
            def __init__(self, *args, **kw):
                # Edit the pending draft while the URL keeps the public identity.
                instance = kw.get("instance")
                if instance is not None and instance.pk:
                    kw["instance"] = draft_for(instance)
                kw.setdefault("promotion", placement == "promotion")
                kw.setdefault("publishing", bool(data and submit_pressed(data, "publish")))
                super().__init__(*args, **kw)

        return with_initial(WorkingForm, lambda: {"version": version})

    def get_changeform_initial_data(self, request):
        initial = {"version": SiteSettings.objects.filter(pk=1).values_list("version", flat=True).first() or 0}
        if request.GET.get("placement") in {"main", "promotion"}:
            initial["placement"] = request.GET["placement"]
        return initial

    def changeform_view(self, request, object_id=None, form_url="", extra_context=None):
        # Unfold injects submit-line actions only on change forms; add needs them too.
        if object_id is None:
            extra_context = {**(extra_context or {}), "actions_submit_line": self.get_actions_submit_line(request, None)}
        return super().changeform_view(request, object_id, form_url, extra_context)

    def save_model(self, request, obj, form, change):
        # obj is the working draft; the service resolves the public root itself.
        root = (obj.draft_of or obj) if change else obj
        publish = submit_pressed(request.POST, "publish")
        result = save_post(request, form, root, root.placement, publish=publish)
        self.message_user(request, _("Published successfully.") if publish else _("Draft saved. The public version is unchanged."), messages.SUCCESS)
        request._site_slide_root = result

    def log_addition(self, request, obj, message):
        super().log_addition(request, getattr(request, "_site_slide_root", obj), message)

    def log_change(self, request, obj, message):
        super().log_change(request, getattr(request, "_site_slide_root", obj), message)

    def response_add(self, request, obj, post_url_continue=None):
        return HttpResponseRedirect(reverse("admin:site_heroslide_change", args=[request._site_slide_root.pk]))

    def response_change(self, request, obj):
        return HttpResponseRedirect(reverse("admin:site_heroslide_change", args=[request._site_slide_root.pk]))

    def delete_model(self, request, obj):
        # The confirm page carries no version; delete against the current row.
        version = SiteSettings.objects.filter(pk=1).values_list("version", flat=True).first() or 0
        retired = delete_post(request, obj, version)
        if SiteMedia.objects.filter(pk__in=retired, pending_delete=True).exists():
            self.message_user(request, _("Post deleted. Some unused files could not be removed yet; cleanup is pending."), messages.WARNING)
        else:
            self.message_user(request, _("Post permanently deleted. Exclusive uploaded files were removed; shared files remain available to other content."), messages.SUCCESS)

    def delete_queryset(self, request, queryset):
        for obj in queryset:
            try:
                self.delete_model(request, obj)
            except ValidationError as error:
                self.message_user(request, "; ".join(str(message) for message in error.messages), messages.ERROR)

    def delete_view(self, request, object_id, extra_context=None):
        try:
            return super().delete_view(request, object_id, extra_context)
        except ValidationError as error:
            self.message_user(request, "; ".join(str(message) for message in error.messages), messages.ERROR)
            return HttpResponseRedirect(reverse("admin:site_heroslide_changelist"))

    @admin.display(description=_("Preview"))
    def thumbnail(self, obj):
        return slide_thumbnail(obj)

    @admin.display(description=_("Status"), ordering="is_draft")
    def state(self, obj):
        return slide_state(obj)

    @admin.display(description=_("Current media"))
    def media_preview(self, obj):
        working = draft_for(obj)
        if working.kind == "video" and working.video_id:
            return asset_video(working.video_id, working.poster_id)
        if working.image_id:
            return asset_img(working.image_id, "max-h-64 max-w-full object-contain", _("Current image"))
        if working.bundled_image:
            return format_html('<img src="{}" alt="{}" class="max-h-64 max-w-full object-contain">', f"{settings.FRONTEND_ORIGIN}/images/marketplace/hero.webp", _("Bundled marketplace image"))
        return ""

    @action(description=_("Save draft"), attrs={"formnovalidate": True}, icon="draft")
    def save_draft(self, request, obj=None):
        """Submit-line marker; save_model routes the request to the post service."""

    @action(description=_("Publish"), icon="publish")
    def publish(self, request, obj=None):
        """Submit-line marker; save_model routes the request to the post service."""