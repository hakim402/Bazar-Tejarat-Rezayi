from django.conf import settings
from django.contrib.admin import action
from django.contrib.auth.admin import UserAdmin
from django.contrib.auth.forms import UserChangeForm, UserCreationForm
from django.contrib.auth.models import Group
from django.db import transaction
from django.http import HttpResponseRedirect
from django.shortcuts import render
from django.urls import reverse
from django.utils.decorators import method_decorator
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.debug import sensitive_post_parameters
from rest_framework.exceptions import APIException
from unfold.admin import ModelAdmin
from unfold.sites import UnfoldAdminSite

from .owner_copy import COPY, PASSWORD_ONLY_SUBTITLES
from .admin_copy import COPY as ADMIN_COPY
from .models import Account, AuditEvent, User
from .services import audit, begin_signin, finish_mfa, get_grant, owner_mfa_required, start_enrollment, verify_development_emails


class OwnerSite(UnfoldAdminSite):
    site_header = "Bazar Rezayi"
    index_title = "Overview"
    index_template = "accounts/admin/dashboard.html"
    site_title = "Bazar Rezayi"

    def get_urls(self):
        from apps.site.admin import settings_urls
        return [*settings_urls(self), *super().get_urls()]

    def has_permission(self, request):
        try:
            get_grant(request, "owner")
            return True
        except APIException:
            return False

    @method_decorator(never_cache)
    @method_decorator(csrf_protect)
    @method_decorator(sensitive_post_parameters())
    def login(self, request, extra_context=None):
        locale = "en"
        t = COPY[locale]
        context = {
            "stage": "password",
            "error": "",
            "title": t["title"],
            "subtitle": t["subtitle"] if owner_mfa_required() else PASSWORD_ONLY_SUBTITLES[locale],
            "site_header": self.site_header,
            "t": t,
            "locale": locale,
            "direction": "ltr",
            "admin_copy": ADMIN_COPY,
            "frontend_url": settings.FRONTEND_ORIGIN + "/en",
        }
        if self.has_permission(request):
            return HttpResponseRedirect(reverse("admin:index"))
        if request.method == "POST":
            stage = request.POST.get("stage", "password")
            try:
                if stage == "password":
                    state = begin_signin(
                        request, request.POST.get("email", "")[:254], request.POST.get("password", "")[:128], "owner"
                    )
                    if state == "signed_in":
                        return HttpResponseRedirect(reverse("admin:index"))
                    context["stage"] = "enroll_start" if state == "enroll" else "challenge"
                elif stage == "enroll":
                    context.update(start_enrollment(request), stage="challenge")
                elif stage == "challenge":
                    codes = finish_mfa(
                        request, request.POST.get("code", "")[:32], recovery=request.POST.get("recovery") == "on"
                    )
                    if not codes:
                        return HttpResponseRedirect(reverse("admin:index"))
                    context.update(stage="complete", codes=codes)
                else:
                    raise ValueError
            except (APIException, ValueError):
                context["error"] = t["error"]
                if stage == "challenge":
                    context["stage"] = "challenge"
        response = render(request, "accounts/owner_login.html", context)
        response["Cache-Control"] = "private, no-store"
        response["Referrer-Policy"] = "same-origin"
        return response

    def logout(self, request, extra_context=None):
        if request.method == "POST":
            audit(
                "owner_session_signed_out",
                request=request,
                user=request.user if request.user.is_authenticated else None,
                context="owner",
            )
        return super().logout(request, extra_context)


owner_site = OwnerSite(name="admin")


class AddIdentityForm(UserCreationForm):
    class Meta(UserCreationForm.Meta):
        model = User
        fields = ["email", "display_name"]


class ChangeIdentityForm(UserChangeForm):
    class Meta(UserChangeForm.Meta):
        model = User
        fields = ["email", "display_name", "is_active"]


class IdentityAdmin(UserAdmin, ModelAdmin):
    form = ChangeIdentityForm
    add_form = AddIdentityForm
    list_display = ["display_name", "email", "email_verified", "is_active", "owner_authority"]
    ordering = ["email"]
    search_fields = ["email", "display_name"]
    list_filter = ["email_verified", *UserAdmin.list_filter]
    fieldsets = [
        (None, {"fields": ["email", "display_name", "is_active"]}),
        (
            "Protected identity state",
            {"fields": ["email_verified", "owner_authority", "is_staff", "is_superuser", "credential_epoch"]},
        ),
    ]
    add_fieldsets = [(None, {"fields": ["email", "display_name", "password1", "password2"]})]
    filter_horizontal = []
    readonly_fields = ["email", "email_verified", "owner_authority", "is_staff", "is_superuser", "credential_epoch"]
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
        return [url for url in super().get_urls() if url.name != "accounts_user_password_change"]

    def has_delete_permission(self, request, obj=None):
        return False

    @transaction.atomic
    def save_model(self, request, obj, form, change):
        super().save_model(request, obj, form, change)
        audit(
            "owner_identity_updated" if change else "owner_identity_provisioned",
            request=request,
            user=obj,
            context="owner",
            fields=[field for field in form.changed_data if field in {"email", "display_name", "is_active"}],
        )


class AccountAdmin(ModelAdmin):
    list_display = ["id", "user", "context", "status", "intent", "review_status"]
    list_filter = ["context", "status"]
    fields = ["user", "context", "status", "intent", "review_status", "permission_groups"]
    filter_horizontal = ["permission_groups"]
    actions = []

    def get_readonly_fields(self, request, obj=None):
        return ["user", "context", "intent", "review_status"] if obj else ["context", "intent", "review_status"]

    def get_changeform_initial_data(self, request):
        return {"context": "staff", "intent": "individual", "review_status": "not_requested"}

    def formfield_for_manytomany(self, db_field, request, **kwargs):
        if db_field.name == "permission_groups":
            kwargs["queryset"] = Group.objects.filter(name__startswith="Rezayi: ")
        return super().formfield_for_manytomany(db_field, request, **kwargs)

    def has_delete_permission(self, request, obj=None):
        return False

    def save_model(self, request, obj, form, change):
        if not change:
            obj.context, obj.intent, obj.review_status = "staff", "individual", "not_requested"
        super().save_model(request, obj, form, change)
        audit(
            "owner_account_updated" if change else "owner_staff_provisioned",
            request=request,
            user=obj.user,
            account=obj,
            context="owner",
            fields=[field for field in form.changed_data if field in {"status", "permission_groups"}],
        )

    def save_related(self, request, form, formsets, change):
        super().save_related(request, form, formsets, change)
        if "permission_groups" in form.changed_data:
            audit(
                "owner_staff_permissions_changed",
                request=request,
                user=form.instance.user,
                account=form.instance,
                context="owner",
                fields=["permission_groups"],
            )


class AuditAdmin(ModelAdmin):
    list_display = ["created_at", "actor", "context", "action", "account", "request_id"]
    list_filter = ["context", "action"]
    readonly_fields = [field.name for field in AuditEvent._meta.fields]
    actions = []

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


owner_site.register(User, IdentityAdmin)
owner_site.register(Account, AccountAdmin)
owner_site.register(AuditEvent, AuditAdmin)
