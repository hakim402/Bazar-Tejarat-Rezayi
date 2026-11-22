"""Explicit safe metadata coverage. Security payloads never enter admin forms."""
from django import forms
from django.contrib.admin.models import LogEntry
from django.contrib.admin import SimpleListFilter
from django.contrib.auth.models import Permission
from django.contrib.contenttypes.models import ContentType
from django.core.exceptions import PermissionDenied
from django.db import transaction
from django.http import HttpResponse
from django.shortcuts import get_object_or_404, redirect
from django.urls import reverse
from django.utils import timezone
from django.utils.translation import gettext_lazy as _
from unfold.admin import ModelAdmin
from unfold.decorators import action, display
from unfold.enums import ActionVariant
from unfold.forms import BaseDialogForm
from unfold.widgets import UnfoldAdminTextareaWidget

from .access import is_owner
from .display import record_identity
from .presentation import CONTEXT_LABELS, context_status, label
from ..models import (ActionToken, AuditEvent, Authenticator, RecoveryCode, RateBucket, MailAttempt,
                     BrowserAuthority, ContextGrant, GoogleIdentity, GoogleAttempt, AccountMail, User)
from ..services import get_grant


class MetadataAdmin(ModelAdmin):
    actions = None
    list_per_page = 30
    ordering = ['-pk']
    restriction_reason = 'Retained security/delivery metadata. Use the supported sign-in, recovery or delivery workflow; generic edits would invalidate security and audit invariants.'

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    def get_readonly_fields(self, request, obj=None):
        return self.fields

    def get_fieldsets(self, request, obj=None):
        return [(None, {'fields': self.fields, 'description': self.restriction_reason})]


class AccountMetadataAdmin(MetadataAdmin):
    section_title = label("Security record")

    def get_fieldsets(self, request, obj=None):
        return [(self.section_title, {"fields": self.fields, "description": label("Read-only record")})]


class UserMetadataAdmin(AccountMetadataAdmin):
    list_select_related = ["user"]
    search_fields = ["user__display_name", "user__email"]
    search_help_text = label("Find by name or email")

    @display(description=label("Account"), ordering="user__display_name")
    def account_identity(self, obj):
        user = obj.user
        return record_identity(user.display_name or user.email, user.email, glyph="person")


class RevocationForm(BaseDialogForm):
    reason = forms.CharField(
        label=_("Reason"), min_length=3, max_length=1000, widget=UnfoldAdminTextareaWidget(attrs={"rows": 3}),
    )


class RevocableRecordMixin:
    actions_detail = ["revoke_record"]
    revoke_user_field = "user_id"

    def has_revoke_permission(self, request, object_id=None):
        obj = self.get_object(request, object_id) if is_owner(request) and object_id else None
        return obj is not None and self.revocable(request, self.model.objects.filter(pk=obj.pk)).exists()

    @action(
        description=_("Revoke"), icon="block", permissions=["revoke"], variant=ActionVariant.DANGER,
        dialog={
            "title": _("Revoke this record?"), "form_class": RevocationForm, "form_submit_text": _("Revoke"),
        },
    )
    def revoke_record(self, request, form, object_id):
        if request.method != "POST":
            raise PermissionDenied
        get_grant(request, "owner")
        with transaction.atomic():
            record = self.model.objects.filter(pk=object_id)
            user_id = get_object_or_404(record.values(self.revoke_user_field))[self.revoke_user_field]
            get_object_or_404(User.objects.select_for_update(), pk=user_id)
            if self.revocable(request, record).update(**self.revocation_values()):
                AuditEvent.objects.create(
                    actor=request.user, subject_id=user_id, context="owner", action="owner_security_record_revoked",
                    resource_type=self.model._meta.label_lower, state={"record_id": str(object_id)},
                    request_id=getattr(request, "request_id", None), reason=form.cleaned_data["reason"],
                )
                self.message_user(request, _("Record revoked."))
            else:
                self.message_user(request, _("This record is already inactive."))
        url = reverse(f"admin:accounts_{self.model._meta.model_name}_change", args=[object_id])
        if request.headers.get("HX-Request"):
            return HttpResponse(headers={"HX-Redirect": url})
        return redirect(url)

    def revocable(self, request, queryset):
        return queryset.filter(revoked=False)

    def revocation_values(self):
        return {"revoked": True}


TOKEN_STATES = {"used": "success", "unused": "default", "expired": "warning"}
ACCESS_STATES = {"current": "default", "revoked": "danger"}
CONFIRMATION_STATES = {"confirmed": "success", "unconfirmed": "warning"}
MAIL_STATES = {"sent": "success", "failed": "danger"}
MAIL_PURPOSES = {"verify": label("Verify email"), "reset": label("Reset password")}
OUTBOX_STATES = {
    "queued": "default", "dispatching": "info", "captured": "success", "smtp_accepted": "success",
    "delivery_unknown": "warning", "delivery_failed": "danger", "expired": "warning", "other": "default",
}


def token_state(used_at, expires_at=None):
    if used_at:
        return "used", label("Used")
    if expires_at and expires_at <= timezone.now():
        return "expired", label("Expired")
    return "unused", label("Unused")


def access_state(revoked):
    return ("revoked", label("Revoked")) if revoked else ("current", label("Not revoked"))


class TokenAdmin(RevocableRecordMixin, UserMetadataAdmin):
    fields = ["user", "purpose", "expires_at", "used_at", "created_at"]
    list_display = ["account_identity", "purpose", "token_status", "expires_at", "created_at"]
    list_filter = ["purpose", "used_at"]

    @display(description=_("Status"), label=TOKEN_STATES)
    def token_status(self, obj):
        return token_state(obj.used_at, obj.expires_at)

    def revocable(self, request, queryset):
        return queryset.filter(used_at__isnull=True, expires_at__gt=timezone.now())

    def revocation_values(self):
        return {"used_at": timezone.now()}


class FactorAdmin(UserMetadataAdmin):
    fields = ["user", "name", "confirmed"]
    list_display = ["account_identity", "name", "factor_status"]
    list_filter = ["confirmed"]

    @display(description=_("Status"), ordering="confirmed", label=CONFIRMATION_STATES)
    def factor_status(self, obj):
        return ("confirmed", label("Confirmed")) if obj.confirmed else ("unconfirmed", label("Unconfirmed"))


class RecoveryAdmin(UserMetadataAdmin):
    fields = ["user", "used_at"]
    list_display = ["account_identity", "recovery_status", "used_at"]
    list_filter = ["used_at"]

    @display(description=_("Status"), ordering="used_at", label=TOKEN_STATES)
    def recovery_status(self, obj):
        return token_state(obj.used_at)


class RateAdmin(AccountMetadataAdmin):
    fields = ["count", "expires_at"]
    list_display = ["bucket", "count", "expires_at", "bucket_status"]
    ordering = ["-expires_at"]

    @display(description=label("Bucket"), ordering="key")
    def bucket(self, obj):
        return record_identity(obj.key, label("Rate limit bucket"), glyph="speed")

    @display(description=_("Status"), label={"active": "info", "expired": "default"})
    def bucket_status(self, obj):
        return ("expired", label("Expired")) if obj.expires_at <= timezone.now() else ("active", label("Active"))


class DeliveryAdmin(UserMetadataAdmin):
    section_title = label("Account email attempt")
    fields = ["user", "purpose", "status", "created_at"]
    list_display = ["account_identity", "purpose_label", "delivery_status", "created_at"]
    list_filter = ["status", "purpose"]

    @display(description=label("Purpose"), ordering="purpose")
    def purpose_label(self, obj):
        return MAIL_PURPOSES.get(obj.purpose, obj.purpose)

    @display(description=_("Status"), ordering="status", label=MAIL_STATES)
    def delivery_status(self, obj):
        return obj.status, obj.get_status_display()


class AuthorityAdmin(RevocableRecordMixin, UserMetadataAdmin):
    fields = ["user", "revoked", "created_at"]
    list_display = ["account_identity", "authority_status", "created_at"]
    list_filter = ["revoked"]

    @display(description=_("Status"), ordering="revoked", label=ACCESS_STATES)
    def authority_status(self, obj):
        return access_state(obj.revoked)

    def revocable(self, request, queryset):
        return super().revocable(request, queryset).exclude(pk=request.session.get("authority"))


class GrantAdmin(RevocableRecordMixin, AccountMetadataAdmin):
    fields = ["authority", "context", "revoked"]
    list_display = ["identity", "grant_context", "grant_status"]
    list_select_related = ["authority__user"]
    list_filter = ["context", "revoked"]
    search_fields = ["authority__user__display_name", "authority__user__email"]
    search_help_text = label("Find by name or email")
    revoke_user_field = "authority__user_id"

    def revocable(self, request, queryset):
        active_owner_grant = request.session.get("grants", {}).get("owner", {}).get("grant_id")
        return super().revocable(request, queryset).filter(authority__revoked=False).exclude(pk=active_owner_grant)

    @display(description=label("Identity"), ordering="authority__user__display_name")
    def identity(self, obj):
        user = obj.authority.user
        return record_identity(user.display_name or user.email, user.email, glyph="person")

    @display(description=_("Context"), ordering="context", label=CONTEXT_LABELS)
    def grant_context(self, obj):
        return context_status(obj.context)

    @display(description=_("Status"), ordering="revoked", label=ACCESS_STATES)
    def grant_status(self, obj):
        return access_state(obj.revoked)


class GoogleIdentityAdmin(UserMetadataAdmin):
    fields = ["user", "issuer", "created_at"]
    list_display = ["account_identity", "issuer", "created_at"]


class GoogleAttemptAdmin(UserMetadataAdmin):
    fields = ["user", "context", "locale", "action", "expires_at", "consumed_at"]
    list_display = ["account_identity", "attempt_context", "action", "attempt_status", "expires_at"]
    list_filter = ["context", "action", "consumed_at"]

    @display(description=_("Context"), ordering="context", label=CONTEXT_LABELS)
    def attempt_context(self, obj):
        return context_status(obj.context)

    @display(description=_("Status"), label=TOKEN_STATES)
    def attempt_status(self, obj):
        return token_state(obj.consumed_at, obj.expires_at)


class OutboxAdmin(AccountMetadataAdmin):
    section_title = label("Account email record")
    fields = ["token", "status", "attempts", "next_attempt_at", "expires_at", "updated_at"]
    list_display = ["identity", "purpose", "delivery_status", "attempts", "next_attempt_at"]
    list_select_related = ["token__user"]
    list_filter = ["status"]
    search_fields = ["token__user__display_name", "token__user__email"]
    search_help_text = label("Find by name or email")

    @display(description=label("Identity"), ordering="token__user__display_name")
    def identity(self, obj):
        user = obj.token.user
        return record_identity(user.display_name or user.email, user.email, glyph="person")

    @display(description=_("Purpose"), ordering="token__purpose")
    def purpose(self, obj):
        return obj.token.get_purpose_display()

    @display(description=_("Status"), ordering="status", label=OUTBOX_STATES)
    def delivery_status(self, obj):
        key = obj.status if obj.status in OUTBOX_STATES else "other"
        return key, label(obj.status.replace("_", " ").capitalize())


class PermissionAdmin(MetadataAdmin):
    restriction_reason = 'Django-generated permission definitions. Assign these through Roles & Permissions; do not mutate migration-owned codenames.'
    fields = ['name', 'content_type', 'codename']
    list_display = ['name', 'content_type', 'codename']
    list_filter = ['content_type__app_label']
    search_fields = ['name', 'codename']
    section_title = label("Permission metadata")

    def get_fieldsets(self, request, obj=None):
        return [(self.section_title, {"fields": self.fields, "description": label("Read-only record")})]


class ContentTypeAdmin(MetadataAdmin):
    restriction_reason = 'Django-generated application/model registry; maintained by migrations.'
    fields = ['app_label', 'model']
    list_display = ['app_label', 'model', 'model_name']
    search_fields = ['app_label', 'model']
    section_title = label("Registered model")

    @display(description=label("Model name"), ordering="model")
    def model_name(self, obj):
        model = obj.model_class()
        return model._meta.verbose_name if model else obj.model

    def get_fieldsets(self, request, obj=None):
        return [(self.section_title, {"fields": self.fields, "description": label("Read-only record")})]


class LogActionFilter(SimpleListFilter):
    title = label("Activity")
    parameter_name = "log_action"

    def lookups(self, request, model_admin):
        return [(flag, title) for flag, title in LOG_ACTIONS.items()]

    def queryset(self, request, queryset):
        if not self.value():
            return queryset
        return queryset.filter(action_flag=int(self.value()))


LOG_ACTIONS = {1: (label("Added"), "success"), 2: (label("Changed"), "info"), 3: (label("Removed"), "danger")}
LOG_ACTION_TONES = {flag: tone for flag, (_, tone) in LOG_ACTIONS.items()}


class NativeLogAdmin(MetadataAdmin):
    section_title = label("Activity record")
    fields = ["log_time", "log_actor", "log_action", "log_object", "content_type", "object_id", "change_message"]
    list_display = ["log_time", "log_actor", "log_action", "log_object"]
    list_filter = [LogActionFilter]
    search_fields = ["object_repr", "change_message", "user__display_name", "user__email"]
    search_help_text = label("Find by record, actor or email")
    ordering = ["-action_time"]

    def get_fieldsets(self, request, obj=None):
        return [
            (self.section_title, {"fields": ["log_time", "log_actor", "log_action", "log_object"]}),
            (label("Technical record"), {"fields": ["content_type", "object_id", "change_message"],
                                         "description": label("Read-only record")}),
        ]

    @display(description=label("Recorded at"), ordering="action_time")
    def log_time(self, obj):
        return obj.action_time

    @display(description=label("Actor"), ordering="user__display_name")
    def log_actor(self, obj):
        if not obj.user_id:
            return label("System")
        return record_identity(obj.user.display_name or obj.user.email, obj.user.email, glyph="person")

    @display(description=label("Action"), ordering="action_flag", label=LOG_ACTION_TONES)
    def log_action(self, obj):
        title = LOG_ACTIONS.get(obj.action_flag, (label("Activity"), "default"))[0]
        return obj.action_flag, title

    @display(description=label("Record"), ordering="object_repr")
    def log_object(self, obj):
        scope = obj.content_type.name if obj.content_type_id else label("Resource")
        return record_identity(obj.object_repr or scope, scope, glyph="label")


def register(site):
    site.register(ActionToken, TokenAdmin)
    site.register(Authenticator, FactorAdmin)
    site.register(RecoveryCode, RecoveryAdmin)
    site.register(RateBucket, RateAdmin)
    site.register(MailAttempt, DeliveryAdmin)
    site.register(BrowserAuthority, AuthorityAdmin)
    site.register(ContextGrant, GrantAdmin)
    site.register(GoogleIdentity, GoogleIdentityAdmin)
    site.register(GoogleAttempt, GoogleAttemptAdmin)
    site.register(AccountMail, OutboxAdmin)
    site.register(Permission, PermissionAdmin)
    site.register(ContentType, ContentTypeAdmin)
    site.register(LogEntry, NativeLogAdmin)
