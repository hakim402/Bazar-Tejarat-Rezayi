"""Shared owner guard, submit-button detection and small presentation helpers."""
from django.conf import settings
from django.contrib import messages
from django.core.exceptions import PermissionDenied, ValidationError
from django.db import DatabaseError
from django.shortcuts import redirect
from django.urls import reverse
from django.utils.html import format_html
from django.utils.translation import gettext_lazy as _
from rest_framework.exceptions import APIException
from apps.accounts.admin.theme import SITE_THEME
from apps.accounts.services import get_grant


def require_owner(request):
    """Custom endpoints use the same owner grant as the guarded model admins."""
    try:
        get_grant(request, "owner")
    except APIException:
        raise PermissionDenied from None


def submit_pressed(data, name):
    """Unfold submit-line buttons POST '{app}_{model}_{action}' keys."""
    return any(key.endswith(f"_{name}") for key in data)


def asset_img(asset_id, css, alt=""):
    """One stored media asset rendered through the private streaming endpoint."""
    return format_html('<img src="{}" alt="{}" class="{}">', reverse("site_media", kwargs={"pk": asset_id}), alt, css)


def asset_video(video_id, poster_id):
    """Stored video with its poster, streamed through the same private endpoint."""
    return format_html(
        f'<video controls preload="metadata" src="{{}}" poster="{{}}" class="{SITE_THEME["video"]}"></video>',
        reverse("site_media", kwargs={"pk": video_id}),
        reverse("site_media", kwargs={"pk": poster_id}) if poster_id else "",
    )


def state_badge(label, tone):
    """Shared status badge; tones map to the centralized admin palette."""
    return format_html(
        '<span class="{} {}">{}</span>', SITE_THEME["badge"], SITE_THEME["badge_tones"][tone], label
    )


def slide_thumbnail(obj):
    """Small preview for a slide/post row, shared by the library and workspace panels."""
    asset_id = obj.poster_id if obj.kind == "video" else obj.image_id
    src = reverse("site_media", kwargs={"pk": asset_id}) if asset_id else f"{settings.FRONTEND_ORIGIN}/images/marketplace/hero.webp" if obj.bundled_image else ""
    return format_html(f'<img src="{{}}" alt="" class="{SITE_THEME["thumb"]}" loading="lazy">', src) if src else "—"


def slide_state(obj):
    """Publication status pill for a public slide/post root (pending draft aware)."""
    if obj.is_draft:
        return state_badge(_("Draft"), "draft")
    if getattr(obj, "pending_draft", None) is not None:
        return state_badge(_("Published · draft changes"), "draft")
    if not obj.enabled:
        return state_badge(_("Published · hidden"), "hidden")
    return state_badge(_("Published"), "published")


def with_initial(form_class, initial_factory):
    """Prefill change-form GETs; Django only applies get_changeform_initial_data on add."""
    class WrappedForm(form_class):
        def __init__(self, *args, **kwargs):
            if not args and kwargs.get("data") is None:
                kwargs["initial"] = {**initial_factory(), **(kwargs.get("initial") or {})}
            super().__init__(*args, **kwargs)
    return WrappedForm


class ServiceFormMixin:
    """Shape the change form for service-routed saves with resilient errors.

    Owner permissions come from GuardedAdminMixin at registration; this mixin
    hides the default save buttons, retries once when a concurrent session wins
    the version race, and redirects safely when storage fails mid-save.
    """

    def changeform_view(self, request, object_id=None, form_url="", extra_context=None):
        extra_context = {**(extra_context or {}), "show_save": False, "show_save_and_continue": False, "show_save_and_add_another": False}
        try:
            return super().changeform_view(request, object_id, form_url, extra_context)
        except ValidationError as error:
            # The race slipped past form validation; one retry re-renders the
            # form against the fresh row with the submitted input retained.
            if not getattr(request, "_site_form_retry", False):
                request._site_form_retry = True
                return self.changeform_view(request, object_id, form_url, extra_context)
            messages.error(request, "; ".join(str(message) for message in error.messages))
            return redirect(request.get_full_path())
        except (OSError, DatabaseError):
            messages.error(request, _("Changes could not be saved. Re-select new uploads and retry."))
            return redirect(request.get_full_path())