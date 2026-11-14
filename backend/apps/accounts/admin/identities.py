"""Native identity administration: super-admin provisioning with audited guards."""
from django.conf import settings
from django.contrib.admin import action
from django.contrib.auth.admin import UserAdmin
from django.core.exceptions import PermissionDenied
from django.db import transaction
from django.utils.translation import gettext_lazy as _
from unfold.admin import ModelAdmin

from apps.runtime.locks import lock as durable_lock

from .copy import COPY as ADMIN_COPY
from ..models import Account, User
from ..services import audit, get_grant, verify_development_emails
from .forms import AddIdentityForm, ChangeIdentityForm
from .site import owner_site


class IdentityAdmin(UserAdmin, ModelAdmin):
    form = ChangeIdentityForm
    add_form = AddIdentityForm
    list_display = ["display_name", "email", "email_verified", "is_active", "is_staff", "is_superuser"]
    ordering = ["email"]
    search_fields = ["email", "display_name", "is_staff", "groups__name"]
    list_filter = ["email_verified", *UserAdmin.list_filter]
    fieldsets = [
        (None, {"fields": ["email", "display_name", "is_active", "is_staff", "is_superuser", "groups", "attest_staff_email", "authority_version"]}),
        (
            _("Protected identity state"),
            {
                "fields": ["email_verified", "owner_authority", "credential_epoch"],
                "description": _(
                    "The legacy owner flag is retained for history. Super admin above is the canonical administrative role."
                ),
            },
        ),
    ]
    add_fieldsets = [(None, {"fields": ["email", "display_name", "password1", "password2", "is_staff", "is_superuser", "groups", "attest_staff_email", "authority_version"]})]
    filter_horizontal = ["groups"]
    readonly_fields = ["email", "email_verified", "owner_authority", "credential_epoch"]
    actions = ["verify_email_for_development"]

    def get_actions(self, request):
        actions = super().get_actions(request)
        if settings.PRODUCTION or not settings.DEBUG or not self.admin_site.has_permission(request):
            actions.pop("verify_email_for_development", None)
        return actions

    @action(description=ADMIN_COPY["development_verify_email"])
    def verify_email_for_development(self, request, queryset):
        count = verify_development_emails(request, queryset.values_list("pk", flat=True))
        self.message_user(request, ADMIN_COPY["development_verified_result"] % {"count": count})

    def get_readonly_fields(self, request, obj=None):
        return self.readonly_fields if obj else []

    def get_urls(self):
        # Shared-credential password changes use the audited session-invalidating workflow.
        # Django's UserAdmin hardcodes the native route name as "auth_user_password_change"
        # even for a custom user model, so filter that exact name to retire the route.
        return [url for url in super().get_urls() if url.name != "auth_user_password_change"]

    def has_delete_permission(self, request, obj=None):
        return False

    @transaction.atomic
    def save_model(self, request, obj, form, change):
        # One transaction-level lock serializes privileged changes, even when two
        # admins target different identities. Never lock only the target row.
        durable_lock(728102803)
        get_grant(request, "owner")
        current = User.objects.select_for_update().filter(pk=obj.pk).first() if change else None
        if current and form.cleaned_data.get("authority_version") != current.credential_epoch:
            raise PermissionDenied("Identity authority changed. Reload this form.")
        removing = current and current.is_superuser and not (obj.is_superuser and obj.is_staff and obj.is_active)
        if removing:
            if obj.pk == request.user.pk:
                raise PermissionDenied("You cannot remove your own administrative access.")
            alternatives = User.objects.filter(is_superuser=True, is_staff=True, is_active=True, email_verified=True).exclude(pk=obj.pk)
            if not any(user.has_usable_password() for user in alternatives):
                raise PermissionDenied("Keep at least one usable super admin.")
        if obj.is_superuser and not (obj.is_staff and obj.is_active):
            raise PermissionDenied("Super admin requires active staff access.")
        attested = obj.is_staff and form.cleaned_data.get("attest_staff_email") and not obj.email_verified
        if attested:
            obj.email_verified = True
        super().save_model(request, obj, form, change)
        if obj.is_staff and not obj.is_superuser:
            Account.objects.get_or_create(user=obj, context="staff")
        if attested:
            audit("staff_email_attested", request=request, user=obj, context="owner", fields=["email_verified"])
        audit(
            "owner_identity_updated" if change else "owner_identity_provisioned",
            request=request,
            user=obj,
            context="owner",
            fields=[field for field in form.changed_data if field in {"email", "display_name", "is_active", "is_staff", "is_superuser", "groups"}],
        )

    def save_related(self, request, form, formsets, change):
        super().save_related(request, form, formsets, change)
        if "groups" in form.changed_data:
            audit("admin_staff_roles_updated", request=request, user=form.instance,
                  account=Account.objects.filter(user=form.instance, context="staff").first(),
                  context="owner", fields=["groups"])


owner_site.register(User, IdentityAdmin)