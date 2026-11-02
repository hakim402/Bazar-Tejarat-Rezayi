"""Explicit safe metadata coverage. Security payloads never enter admin forms."""
from django.contrib.admin.models import LogEntry
from django.contrib.auth.models import Permission
from django.contrib.contenttypes.models import ContentType
from unfold.admin import ModelAdmin
from .models import (ActionToken, Authenticator, RecoveryCode, RateBucket, MailAttempt,
                     BrowserAuthority, ContextGrant, GoogleIdentity, GoogleAttempt, AccountMail)


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


class TokenAdmin(MetadataAdmin):
    fields = ['user', 'purpose', 'expires_at', 'used_at', 'created_at']
    list_display = ['user', 'purpose', 'expires_at', 'used_at']
    list_filter = ['purpose', 'used_at']
    search_fields = ['user__email', 'user__display_name']


class FactorAdmin(MetadataAdmin):
    fields = ['user', 'name', 'confirmed']
    list_display = ['user', 'confirmed']
    list_filter = ['confirmed']


class RecoveryAdmin(MetadataAdmin):
    fields = ['user', 'used_at']
    list_display = ['user', 'used_at']


class RateAdmin(MetadataAdmin):
    fields = ['count', 'expires_at']
    list_display = ['expires_at', 'count']


class DeliveryAdmin(MetadataAdmin):
    fields = ['user', 'purpose', 'status', 'created_at']
    list_display = ['user', 'purpose', 'status', 'created_at']
    list_filter = ['status', 'purpose']


class AuthorityAdmin(MetadataAdmin):
    fields = ['user', 'revoked', 'created_at']
    list_display = ['user', 'revoked', 'created_at']
    list_filter = ['revoked']


class GrantAdmin(MetadataAdmin):
    fields = ['authority', 'context', 'revoked']
    list_display = ['authority', 'context', 'revoked']
    list_filter = ['context', 'revoked']


class GoogleIdentityAdmin(MetadataAdmin):
    fields = ['user', 'issuer', 'created_at']
    list_display = ['user', 'issuer', 'created_at']


class GoogleAttemptAdmin(MetadataAdmin):
    fields = ['user', 'context', 'locale', 'action', 'expires_at', 'consumed_at']
    list_display = ['user', 'context', 'action', 'expires_at', 'consumed_at']
    list_filter = ['context', 'action']


class OutboxAdmin(MetadataAdmin):
    fields = ['token', 'status', 'attempts', 'next_attempt_at', 'expires_at', 'updated_at']
    list_display = ['token', 'status', 'attempts', 'next_attempt_at']
    list_filter = ['status']


class PermissionAdmin(MetadataAdmin):
    restriction_reason = 'Django-generated permission definitions. Assign these through Roles & Permissions; do not mutate migration-owned codenames.'
    fields = ['name', 'content_type', 'codename']
    list_display = ['name', 'content_type', 'codename']
    list_filter = ['content_type__app_label']
    search_fields = ['name', 'codename']


class ContentTypeAdmin(MetadataAdmin):
    restriction_reason = 'Django-generated application/model registry; maintained by migrations.'
    fields = ['app_label', 'model']
    list_display = ['app_label', 'model']
    search_fields = ['app_label', 'model']


class NativeLogAdmin(MetadataAdmin):
    fields = ['action_time', 'user', 'content_type', 'action_flag']
    list_display = ['action_time', 'user', 'content_type', 'action_flag']
    list_filter = ['action_flag', 'content_type']


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
