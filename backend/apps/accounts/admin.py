from apps.runtime.locks import lock as durable_lock
from django.conf import settings
from django.contrib.admin import action
from django.contrib.auth.admin import UserAdmin
from django.contrib.auth.forms import UserChangeForm, UserCreationForm
from django.contrib.auth.models import Group
from django.contrib.auth.admin import GroupAdmin
from django import forms
from django.core.exceptions import PermissionDenied
from django.template.response import TemplateResponse
from django.db import transaction
from django.http import HttpResponseRedirect, Http404
from django.shortcuts import render
from django.urls import reverse, path
from django.utils.decorators import method_decorator
from django.utils.translation import gettext_lazy as _
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.debug import sensitive_post_parameters
from rest_framework.exceptions import APIException
from unfold.admin import ModelAdmin
from unfold.sites import UnfoldAdminSite

from . import admin_records
from .owner_copy import COPY, PASSWORD_ONLY_SUBTITLES
from .admin_copy import COPY as ADMIN_COPY
from .models import Account, AuditEvent, User
from .services import audit, begin_signin, finish_mfa, get_grant, admin_mfa_required, start_enrollment, verify_development_emails


from .admin_access import GuardedAdminMixin, admin_actor, is_owner
from .admin_display import AdminDisplayMixin


class OwnerSite(UnfoldAdminSite):
    site_header = "Bazar Rezayi"
    index_title = _("Overview")
    index_template = "accounts/admin/dashboard.html"
    site_title = "Bazar Rezayi"

    def admin_view(self, view, cacheable=False):
        from functools import wraps
        @wraps(view)
        def guarded(request, *args, **kwargs):
            try:
                return view(request, *args, **kwargs)
            except APIException as error:
                if error.status_code == 404:
                    raise Http404 from None
                if error.status_code in {401, 403}:
                    raise PermissionDenied from None
                raise
        return super().admin_view(guarded, cacheable=cacheable)

    def register(self, model_or_iterable, admin_class=None, **options):
        from .admin_labels import localize_model
        guarded = type("Guarded" + admin_class.__name__, (GuardedAdminMixin, admin_class), {})
        result = super().register(model_or_iterable, guarded, **options)
        models = model_or_iterable if isinstance(model_or_iterable, (list, tuple)) else [model_or_iterable]
        for model in models:
            localize_model(model)
        return result

    def get_app_list(self, request, app_label=None):
        # One fresh authority check for a directory, instead of rechecking it for
        # every permission of every model. Actual views/querysets/actions recheck.
        try:
            get_grant(request, 'owner')
            root = True
        except APIException:
            root = False
        previous = getattr(request, '_admin_directory_root', None)
        request._admin_directory_root = root
        try:
            return super().get_app_list(request, app_label)
        finally:
            if previous is None:
                del request._admin_directory_root
            else:
                request._admin_directory_root = previous

    def index(self, request, extra_context=None):
        if is_owner(request):
            return super().index(request, extra_context)
        request.current_app = self.name
        from .admin_work import my_work
        return TemplateResponse(request, "accounts/admin/staff_index.html", {
            **self.each_context(request), "title": ADMIN_COPY["staff_workspace"], "index": True,
            "app_list": self.get_app_list(request), "my_work": my_work(self, request, admin_actor(request)),
            **(extra_context or {}),
        })

    def each_context(self, request):
        return {**super().each_context(request), "is_owner_admin": is_owner(request)}

    def get_urls(self):
        from apps.site.admin import settings_urls
        from apps.reports.admin_views import report_urls
        from .admin_security import factor_reset, own_profile
        from .admin_locale import set_language
        return [path("factor-reset/", self.admin_view(lambda request: factor_reset(self, request)),
                     name="factor_reset"), path("profile/", self.admin_view(lambda request: own_profile(self, request)),
                     name="own_profile"), path("language/", set_language, name="admin_set_language"),
                *settings_urls(self), *report_urls(self), *super().get_urls()]

    def has_permission(self, request):
        try:
            admin_actor(request)
            return True
        except (APIException, PermissionDenied):
            return False

    @method_decorator(never_cache)
    @method_decorator(csrf_protect)
    @method_decorator(sensitive_post_parameters())
    def login(self, request, extra_context=None):
        from .admin_locale import admin_language, frontend_locale
        locale = admin_language(request)
        copy_locale = frontend_locale(locale)
        t = COPY[copy_locale]
        context = {
            "stage": "password",
            "error": "",
            "title": t["title"],
            "subtitle": t["subtitle"] if admin_mfa_required() else PASSWORD_ONLY_SUBTITLES[copy_locale],
            "site_header": self.site_header,
            "t": t,
            "locale": locale,
            "direction": "rtl" if locale == "fa-af" else "ltr",
            "admin_copy": ADMIN_COPY,
            "frontend_url": settings.FRONTEND_ORIGIN + "/" + frontend_locale(locale),
            "recovery_url": settings.FRONTEND_ORIGIN + "/" + frontend_locale(locale) + "/auth/forgot-password",
        }
        if self.has_permission(request):
            return HttpResponseRedirect(reverse("admin:index"))
        if request.method == "POST":
            stage = request.POST.get("stage", "password")
            try:
                if stage == "password":
                    state = begin_signin(
                        request, request.POST.get("email", "")[:254], request.POST.get("password", "")[:128],
                        self.login_context(request.POST.get("email", "")[:254]), admin_entry=True,
                    )
                    if state != "signed_in":
                        request.session["pending_mfa"]["entry"] = "admin"
                        request.session.modified = True
                    if state == "signed_in":
                        return HttpResponseRedirect(reverse("admin:index"))
                    context["stage"] = "enroll_start" if state == "enroll" else "challenge"
                elif stage == "enroll":
                    self.require_admin_pending(request)
                    context.update(start_enrollment(request), stage="challenge")
                elif stage == "challenge":
                    self.require_admin_pending(request)
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
        if context["stage"] != "password":
            context["subtitle"] = t["subtitle"]
        response = render(request, "accounts/owner_login.html", context)
        response["Cache-Control"] = "private, no-store"
        response["Referrer-Policy"] = "same-origin"
        return response

    def require_admin_pending(self, request):
        from .services import AuthFailure
        if request.session.get("pending_mfa", {}).get("entry") != "admin":
            raise AuthFailure()

    def password_change(self, request, extra_context=None):
        from .admin_security import own_password
        return own_password(self, request)

    def login_context(self, email):
        from .models import normalize_email
        user = User.objects.filter(email=normalize_email(email)).first()
        return "owner" if user and user.is_superuser else "staff"

    def logout(self, request, extra_context=None):
        if request.method == "POST":
            actor = admin_actor(request)
            audit("owner_session_signed_out" if actor.context == "owner" else "staff_session_signed_out",
                  request=request, user=request.user, account=actor.account, context=actor.context)
        return super().logout(request, extra_context)


owner_site = OwnerSite(name="admin")


class StaffProvisioningFormMixin:
    attest_staff_email = forms.BooleanField(required=False, label=ADMIN_COPY["staff_email_attest"],
        help_text=ADMIN_COPY["staff_email_attest_help"])

    authority_version = forms.IntegerField(required=False, widget=forms.HiddenInput)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["authority_version"].required = not self.instance._state.adding
        self.fields["authority_version"].initial = self.instance.credential_epoch if self.instance.pk else None
        self.fields["is_superuser"].label = _("Super admin")
        self.fields["is_superuser"].help_text = _(
            "Full native administration; independent approvals and immutable history still apply. "
            "Requires active staff access and verified email."
        )

    def clean(self):
        data = super().clean()
        if data.get("is_superuser") and not data.get("is_staff"):
            self.add_error("is_superuser", _("Super admin requires staff access."))
        if data.get("is_staff") and not self.instance.email_verified and not data.get("attest_staff_email"):
            self.add_error("attest_staff_email", ADMIN_COPY["staff_email_attest_required"])
        return data


class AddIdentityForm(StaffProvisioningFormMixin, UserCreationForm):
    attest_staff_email = StaffProvisioningFormMixin.attest_staff_email
    authority_version = StaffProvisioningFormMixin.authority_version
    class Meta(UserCreationForm.Meta):
        model = User
        fields = ["email", "display_name", "is_staff", "is_superuser", "groups"]


class ChangeIdentityForm(StaffProvisioningFormMixin, UserChangeForm):
    attest_staff_email = StaffProvisioningFormMixin.attest_staff_email
    authority_version = StaffProvisioningFormMixin.authority_version
    class Meta(UserChangeForm.Meta):
        model = User
        fields = ["email", "display_name", "is_active", "is_staff", "is_superuser", "groups"]


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


class AccountForm(forms.ModelForm):
    status_reason = forms.CharField(
        max_length=1000,
        required=False,
        widget=forms.Textarea(attrs={"rows": 3}),
        label="Status change reason",
        help_text="Required when suspending, archiving or reopening. Recorded in the audit history.",
    )

    class Meta:
        model = Account
        fields = ["user", "context", "status", "intent", "review_status", "permission_groups"]

    def clean(self):
        data = super().clean()
        if self.instance.pk and "status" in self.changed_data and not (data.get("status_reason") or "").strip():
            self.add_error("status_reason", "Give a reason for this status change.")
        return data


STATUS_ACTIONS = {"suspended": "account_suspended", "archived": "account_archived", "active": "account_reopened"}


class AccountAdmin(AdminDisplayMixin, ModelAdmin):
    form = AccountForm
    list_display = ["id", "user", "context", "status", "intent", "review_status"]
    list_filter = ["context", "status"]
    fields = ["user", "context", "status", "status_reason", "intent", "review_status", "permission_groups"]
    filter_horizontal = []
    actions = []
    badge_fields = ("context", "status", "intent", "review_status")

    ACCOUNT_HELP = {
        "context": "Buyer and seller roles grow from marketplace activity; this form provisions staff accounts only.",
        "status": "Suspended accounts lose marketplace access immediately; the underlying user identity is untouched.",
        "intent": "Individual is the starting tier. Company upgrades happen in authenticated Settings with evidence review.",
        "review_status": "Verification decisions belong to the verification workflow, not this form.",
        "permission_groups": "Fresh Rezayi role grants define staff authority. Re-saving revokes any grant not selected here.",
    }

    def get_form(self, request, obj=None, **kwargs):
        form = super().get_form(request, obj, **kwargs)
        for name, text in self.ACCOUNT_HELP.items():
            if name in form.base_fields:
                form.base_fields[name].help_text = text
        return form

    def get_readonly_fields(self, request, obj=None):
        return ["user", "context", "intent", "review_status", "permission_groups"] if obj else ["context", "intent", "review_status", "permission_groups"]

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
        previous = Account.objects.filter(pk=obj.pk).values_list("status", flat=True).first() if change else None
        super().save_model(request, obj, form, change)
        if previous and previous != obj.status:
            audit(
                STATUS_ACTIONS[obj.status],
                request=request,
                user=obj.user,
                account=obj,
                context="owner",
                fields=["status"],
                reason=form.cleaned_data["status_reason"].strip(),
                state={"status": {"before": previous, "after": obj.status}, "context": obj.context},
            )
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
    search_fields = ["action", "request_id", "actor__email"]
    ordering = ["-created_at", "-pk"]
    list_per_page = 30
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


class RoleAdmin(GroupAdmin, ModelAdmin):
    actions = []

    def has_delete_permission(self, request, obj=None):
        return False


owner_site.register(Group, RoleAdmin)

# Explicit allowlisted metadata; never register authentication backing fields wholesale.
admin_records.register(owner_site)
