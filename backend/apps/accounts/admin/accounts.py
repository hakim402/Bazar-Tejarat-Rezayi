"""Account provisioning and audited status changes for Super Admin."""
from urllib.parse import parse_qs

from django.contrib.auth.models import Group
from django.core.exceptions import PermissionDenied
from django.db import transaction
from django.urls import reverse
from django.utils.translation import gettext_lazy as _
from unfold.admin import ModelAdmin
from unfold.decorators import display

from ..models import Account, AuditEvent, User
from ..services import audit
from .forms import AccountForm
from .lifecycle import RetainedHistoryDeleteMixin
from .presentation import (
    ACCOUNT_SEGMENTS, ACCOUNT_STATUS_LABELS, CONTEXT_LABELS, REVIEW_LABELS, AccountSummaryMixin,
    badge, identity_cell, label,
)
from .site import owner_site

STATUS_ACTIONS = {"suspended": "account_suspended", "archived": "account_archived", "active": "account_reopened"}


class AccountAdmin(RetainedHistoryDeleteMixin, AccountSummaryMixin, ModelAdmin):
    form = AccountForm
    list_display = ["identity", "account_context", "account_status", "intent", "account_review", "created_at"]
    list_display_links = ["identity"]
    list_select_related = ["user"]
    search_fields = ["user__display_name", "user__email", "user__first_name", "user__last_name"]
    search_help_text = label("Find by name or email")
    list_filter = ["context", "status", "intent", "review_status"]
    list_before_template = "accounts/admin/includes/account_segments.html"
    fieldsets = [
        (label("Account details"), {"fields": ["user", ("context", "intent"), "review_status", ("created_at", "id")]}),
        (label("Change account status"), {"fields": ["status", "status_reason"]}),
        (_("Permissions"), {"fields": ["permission_groups"]}),
    ]
    add_fieldsets = [
        (label("Account details"), {"fields": ["user", ("context", "intent")]}),
        (label("Change account status"), {"fields": ["status", "status_reason"]}),
    ]
    autocomplete_fields = ["user"]
    filter_horizontal = []
    actions = []
    warn_unsaved_form = True

    ACCOUNT_HELP = {
        "status": _("Suspending this account immediately removes access for this account type."),
    }

    @display(description=_("Account"), ordering="user__display_name", header=True)
    def identity(self, obj):
        return identity_cell(obj.user)

    @display(description=label("Account type"), ordering="context", label=CONTEXT_LABELS)
    def account_context(self, obj):
        return obj.context, obj.get_context_display()

    @display(description=_("Status"), ordering="status", label=ACCOUNT_STATUS_LABELS)
    def account_status(self, obj):
        return obj.status, obj.get_status_display()

    @display(description=_("Review status"), ordering="review_status", label=REVIEW_LABELS)
    def account_review(self, obj):
        return obj.review_status, obj.get_review_status_display()

    def get_list_display(self, request):
        context = request.GET.get("context__exact")
        columns = super().get_list_display(request)
        if context == "staff":
            return [column for column in columns if column not in {"account_context", "intent", "account_review"}]
        if context in {"buyer", "seller"}:
            return [column for column in columns if column != "account_context"]
        return columns

    def changelist_view(self, request, extra_context=None):
        params = request.GET.copy()
        selected = params.pop("context__exact", [""])[-1]
        for key in ("p", "o", "all", "e"):
            params.pop(key, None)
        url = reverse("admin:accounts_account_changelist")
        segments = []
        for context, title in ACCOUNT_SEGMENTS:
            query = params.copy()
            if context:
                query["context__exact"] = context
            segments.append({
                "title": title,
                "url": f"{url}?{query.urlencode()}" if query else url,
                "selected": selected == context,
            })
        context = {"account_segments": segments, "account_segments_label": label("Account type")}
        return super().changelist_view(request, {**context, **(extra_context or {})})

    def record_summary(self, request, obj):
        user_admin = self.admin_site.get_model_admin(User)
        links = []
        if user_admin.has_view_or_change_permission(request, obj.user):
            links.append({
                "title": label("Open user"),
                "url": reverse("admin:accounts_user_change", args=[obj.user_id]),
                "icon": "person",
            })
        return {
            "user": obj.user,
            "links": links,
            "badges": [
                badge(self.account_context(obj), CONTEXT_LABELS),
                badge(self.account_status(obj), ACCOUNT_STATUS_LABELS),
                *([badge(self.account_review(obj), REVIEW_LABELS)] if obj.context != Account.Context.STAFF else []),
            ],
        }

    def get_form(self, request, obj=None, **kwargs):
        form = super().get_form(request, obj, **kwargs)
        for name, text in self.ACCOUNT_HELP.items():
            if name in form.base_fields:
                form.base_fields[name].help_text = text
        return form

    def get_readonly_fields(self, request, obj=None):
        if obj:
            return ["user", "context", "intent", "review_status", "permission_groups", "created_at", "id"]
        return ["review_status", "permission_groups"]

    def get_changeform_initial_data(self, request):
        filtered = parse_qs(request.GET.get("_changelist_filters", "")).get("context__exact", [""])[-1]
        context = request.GET.get("context", filtered)
        return {"context": context if context in Account.Context.values else "staff", "intent": "individual"}

    def formfield_for_manytomany(self, db_field, request, **kwargs):
        if db_field.name == "permission_groups":
            kwargs["queryset"] = Group.objects.filter(name__startswith="Rezayi: ")
        return super().formfield_for_manytomany(db_field, request, **kwargs)

    retained_history_message = _("This account has audit history. Set its status to Archived to remove access.")

    def has_audit_history(self, objs):
        return AuditEvent.objects.filter(account_id__in=[obj.pk for obj in objs]).exists()

    @transaction.atomic
    def delete_model(self, request, obj):
        User.objects.select_for_update().get(pk=obj.user_id)
        current = Account.objects.select_for_update().get(pk=obj.pk)
        account_id = current.pk
        super().delete_model(request, current)
        AuditEvent.objects.create(
            actor=request.user, context="owner", action="owner_account_deleted",
            resource_type="accounts.account", resource_id=account_id,
            request_id=getattr(request, "request_id", None),
        )

    @transaction.atomic
    def save_model(self, request, obj, form, change):
        user = User.objects.select_for_update().get(pk=obj.user_id)
        if not change:
            if obj.context == Account.Context.STAFF and not user.is_staff:
                raise PermissionDenied(_("This user no longer has staff access."))
            obj.review_status = "pending" if obj.context == "seller" or obj.intent == "business" else "not_requested"
        previous = Account.objects.select_for_update().filter(pk=obj.pk).values_list("status", flat=True).first() if change else None
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
            "owner_account_updated" if change else (
                "owner_staff_provisioned" if obj.context == Account.Context.STAFF else "owner_account_provisioned"
            ),
            request=request,
            user=obj.user,
            account=obj,
            context="owner",
            fields=[field for field in form.changed_data if field in {"status", "context", "intent"}],
            reason=form.cleaned_data["status_reason"].strip() if not change else "",
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


owner_site.register(Account, AccountAdmin)
