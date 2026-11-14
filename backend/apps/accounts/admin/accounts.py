"""Staff account provisioning and audited status changes (buyer/seller roles stay marketplace-owned)."""
from django.contrib.auth.models import Group
from unfold.admin import ModelAdmin

from .display import AdminDisplayMixin
from ..models import Account
from ..services import audit
from .forms import AccountForm
from .site import owner_site

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


owner_site.register(Account, AccountAdmin)