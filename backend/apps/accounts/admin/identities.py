"""Native identity administration: super-admin provisioning with audited guards."""
from urllib.parse import urlencode

from django.conf import settings
from django.contrib.admin import action
from django.contrib.auth.admin import UserAdmin
from django.core.exceptions import PermissionDenied
from django.db import transaction
from django.db.models import Q
from django.urls import reverse
from django.utils.translation import gettext_lazy as _
from unfold.admin import ModelAdmin
from unfold.decorators import display

from apps.runtime.locks import lock as durable_lock
from apps.site.media import discard_created, schedule_media_cleanup, store_upload

from .copy import COPY as ADMIN_COPY
from ..models import Account, AuditEvent, User
from ..services import audit, get_grant, verify_development_emails
from .forms import AddIdentityForm, ChangeIdentityForm
from .lifecycle import RetainedHistoryDeleteMixin
from .presentation import (
    AccountSummaryMixin, EMAIL_LABELS, ROLE_LABELS, VISIBILITY_LABELS, badge, email_status,
    identity_cell, identity_role, identity_status, label,
)
from .site import owner_site


class IdentityAdmin(RetainedHistoryDeleteMixin, AccountSummaryMixin, UserAdmin, ModelAdmin):
    form = ChangeIdentityForm
    add_form = AddIdentityForm
    list_display = ["identity", "access_role", "signin_status", "email_status", "last_signin", "date_joined"]
    list_display_links = ["identity"]
    ordering = ["email"]
    search_fields = ["email", "display_name", "first_name", "last_name", "is_staff", "groups__name"]
    search_help_text = label("Find by name or email")
    list_filter = ["email_verified", *UserAdmin.list_filter]
    fieldsets = [
        (label("Identity"), {"fields": [("email", "display_name"), "email_verified"]}),
        (
            _("Profile"),
            {"fields": [("first_name", "last_name"), ("phone", "preferred_locale"), ("gender", "date_of_birth"), "bio"]},
        ),
        (label("Profile photo"), {"fields": ["avatar_file", "avatar_clear"]}),
        (label("Account access"), {"fields": ["is_active", "is_staff", "is_superuser", "groups", "attest_staff_email", "authority_version"]}),
        (
            label("Security & activity"),
            {
                "fields": [("last_login", "date_joined"), ("owner_authority", "credential_epoch")],
                "description": _("The legacy owner flag is retained for history. Super admin is the canonical administrative role."),
            },
        ),
    ]
    add_fieldsets = [
        (label("Identity"), {"fields": [("email", "display_name"), "password1", "password2"]}),
        (label("Account access"), {"fields": ["is_staff", "is_superuser", "groups", "attest_staff_email", "authority_version"]}),
    ]
    autocomplete_fields = ["groups"]
    filter_horizontal = []
    readonly_fields = ["email", "email_verified", "owner_authority", "credential_epoch", "last_login", "date_joined"]
    actions = ["verify_email_for_development"]
    warn_unsaved_form = True

    @display(description=label("Identity"), ordering="display_name", header=True)
    def identity(self, obj):
        return identity_cell(obj)

    @display(description=label("Access role"), label=ROLE_LABELS)
    def access_role(self, obj):
        return identity_role(obj)

    @display(description=label("Sign-in status"), ordering="is_active", label=VISIBILITY_LABELS)
    def signin_status(self, obj):
        return identity_status(obj)

    @display(description=label("Email verification"), ordering="email_verified", label=EMAIL_LABELS)
    def email_status(self, obj):
        return email_status(obj)

    @display(description=_("Last login"), ordering="last_login")
    def last_signin(self, obj):
        return obj.last_login or label("Never signed in")

    def record_summary(self, request, obj):
        account_admin = self.admin_site.get_model_admin(Account)
        links = []
        icons = {"buyer": "shopping_bag", "seller": "storefront", "staff": "shield"}
        for account in obj.accounts.order_by("context"):
            if not account_admin.has_view_or_change_permission(request, account):
                continue
            change_url = reverse("admin:accounts_account_change", args=[account.pk])
            filters = urlencode({"context__exact": account.context})
            links.append({
                "url": f"{change_url}?{urlencode({'_changelist_filters': filters})}",
                "title": account.get_context_display(),
                "icon": icons[account.context],
            })
        return {
            "user": obj,
            "links": links,
            "badges": [
                badge(identity_role(obj), ROLE_LABELS),
                badge(identity_status(obj), VISIBILITY_LABELS),
                badge(email_status(obj), EMAIL_LABELS),
            ],
        }

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

    retained_history_message = _("This user has audit history. Clear Active in Account access to remove sign-in access.")

    def has_audit_history(self, objs):
        ids = [obj.pk for obj in objs]
        return AuditEvent.objects.filter(Q(actor_id__in=ids) | Q(subject_id__in=ids)).exists()

    def has_delete_permission(self, request, obj=None):
        return (obj is None or obj.pk != request.user.pk) and super().has_delete_permission(request, obj)

    @transaction.atomic
    def delete_model(self, request, obj):
        durable_lock(728102803)
        current = User.objects.select_for_update().get(pk=obj.pk)
        if not self.has_delete_permission(request, current):
            raise PermissionDenied
        if current.is_superuser and not self.has_other_usable_super_admin(current):
            raise PermissionDenied(_("Keep at least one usable super admin."))
        user_id, avatar_id = current.pk, current.avatar_id
        super().delete_model(request, current)
        AuditEvent.objects.create(
            actor=request.user, context="owner", action="owner_identity_deleted",
            resource_type="accounts.user", resource_id=user_id,
            request_id=getattr(request, "request_id", None),
        )
        if avatar_id:
            schedule_media_cleanup([avatar_id])

    @staticmethod
    def has_other_usable_super_admin(user):
        alternatives = User.objects.filter(
            is_superuser=True, is_staff=True, is_active=True, email_verified=True,
        ).exclude(pk=user.pk)
        return any(candidate.has_usable_password() for candidate in alternatives)

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
            if not self.has_other_usable_super_admin(obj):
                raise PermissionDenied("Keep at least one usable super admin.")
        if obj.is_superuser and not (obj.is_staff and obj.is_active):
            raise PermissionDenied("Super admin requires active staff access.")
        attested = obj.is_staff and form.cleaned_data.get("attest_staff_email") and not obj.email_verified
        if attested:
            obj.email_verified = True
        previous_avatar = current.avatar_id if current else None
        created = []
        try:
            if form.cleaned_data.get("avatar_clear"):
                obj.avatar = None
            file = form.cleaned_data.get("avatar_file")
            if file:
                obj.avatar = store_upload(file, "image", created)
            super().save_model(request, obj, form, change)
        except Exception:
            discard_created(created)
            raise
        if previous_avatar and previous_avatar != obj.avatar_id:
            schedule_media_cleanup([previous_avatar])
        if obj.is_staff and not obj.is_superuser:
            Account.objects.get_or_create(user=obj, context="staff")
        if attested:
            audit("staff_email_attested", request=request, user=obj, context="owner", fields=["email_verified"])
        changed = [field for field in form.changed_data if field in {"email", "display_name", "first_name", "last_name", "phone", "preferred_locale", "gender", "date_of_birth", "bio", "is_active", "is_staff", "is_superuser", "groups"}]
        if previous_avatar != obj.avatar_id:
            changed.append("avatar")
        audit(
            "owner_identity_updated" if change else "owner_identity_provisioned",
            request=request,
            user=obj,
            context="owner",
            fields=changed,
        )

    def save_related(self, request, form, formsets, change):
        super().save_related(request, form, formsets, change)
        if "groups" in form.changed_data:
            audit("admin_staff_roles_updated", request=request, user=form.instance,
                  account=Account.objects.filter(user=form.instance, context="staff").first(),
                  context="owner", fields=["groups"])


owner_site.register(User, IdentityAdmin)
