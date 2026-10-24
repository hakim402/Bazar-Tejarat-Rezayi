from django.contrib import messages
from django.http import HttpResponseRedirect
from django.shortcuts import get_object_or_404, render
from django.urls import path, reverse
from django.utils.html import format_html
from rest_framework.exceptions import APIException
from unfold.admin import ModelAdmin

from apps.accounts.admin import owner_site
from apps.accounts.models import Account
from .access import Actor
from .models import BusinessProfile, Invitation, Membership, OwnershipTransfer
from .forms import WorkflowForm
from .owner_copy import COPY


class ReadOnlyAdmin(ModelAdmin):
    actions = []

    def get_readonly_fields(self, request, obj=None):
        return [field.name for field in self.model._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    def save_model(self, request, obj, form, change):
        pass  # All fields are read-only; transitions have dedicated guarded forms.


class WorkflowAdmin(ReadOnlyAdmin):
    def get_readonly_fields(self, request, obj=None):
        return [*super().get_readonly_fields(request, obj), "guarded_workflow"]

    def guarded_workflow(self, obj):
        url = reverse(f"admin:{self.model._meta.app_label}_{self.model._meta.model_name}_workflow", args=[obj.pk])
        return format_html('<a href="{}">Open guarded workflow</a>', url)

    def get_urls(self):
        info = self.model._meta
        return [
            path(
                "<uuid:pk>/workflow/",
                self.admin_site.admin_view(self.workflow),
                name=f"{info.app_label}_{info.model_name}_workflow",
            ),
            *super().get_urls(),
        ]

    def workflow(self, request, pk):
        from apps.verification.models import ReviewCase
        from apps.verification.services import authorize_case, review_action
        from apps.verification.forms import ReviewWorkflowForm
        from .transfers import transfer_action
        from .teams import change_member

        obj = get_object_or_404(self.model, pk=pk)
        locale = "en"
        t = COPY[locale]
        actor = Actor(request, "owner")
        if self.model is ReviewCase:
            from django.core.exceptions import PermissionDenied

            try:
                authorize_case(actor, obj)
            except APIException:
                raise PermissionDenied from None
        choices = [
            (v, t[v])
            for v in (
                ["assign", "approved", "rejected", "needs_information"]
                if self.model is ReviewCase
                else ["approve", "reject"]
                if self.model is OwnershipTransfer
                else ["revoke"]
            )
        ]
        current_version = obj.company.version if self.model is Membership else obj.version
        form_class = ReviewWorkflowForm if self.model is ReviewCase else WorkflowForm
        form = form_class(
            request.POST if request.method == "POST" else None,
            initial={"version": current_version}, locale=locale,
            **({"case": obj} if self.model is ReviewCase else {}),
        )
        form.fields["action"].choices = choices
        if self.model is ReviewCase:
            form.fields["assigned_to"].queryset = Account.objects.filter(
                context="staff",
                status="active",
                user__is_active=True,
                user__email_verified=True,
                permission_groups__permissions__content_type__app_label="verification",
                permission_groups__permissions__codename="decide_review",
            ).distinct()
        else:
            form.fields.pop("assigned_to")
        if request.method == "POST" and form.is_valid():
            data = form.cleaned_data
            if data.get("assigned_to") is not None:
                data["assigned_to"] = data["assigned_to"].pk
            try:
                if self.model is ReviewCase:
                    review_action(actor, obj.pk, data)
                elif self.model is OwnershipTransfer:
                    transfer_action(actor, obj.pk, data)
                else:
                    change_member(actor, obj.company_id, obj.pk, data)
                messages.success(request, t["success"])
                return HttpResponseRedirect(request.get_full_path())
            except APIException:
                form.add_error(None, t["refused"])
        return render(
            request,
            "organizations/owner_workflow.html",
            dict(
                self.admin_site.each_context(request), title=t["title"], form=form, resource=obj, t=t,
                locale=locale, direction="ltr" if locale == "en" else "rtl",
                requested_alternatives=getattr(form, "requested_alternatives", []),
            ),
        )


class ProfileAdmin(ReadOnlyAdmin):
    list_display = ["display_name", "kind", "version", "revision"]
    list_filter = ["kind"]


class MembershipAdmin(WorkflowAdmin):
    list_display = ["company", "account", "is_owner", "active"]
    list_filter = ["active", "is_owner"]


class TransferAdmin(WorkflowAdmin):
    list_display = ["company", "requester", "recipient", "status", "version"]
    list_filter = ["status"]


owner_site.register(BusinessProfile, ProfileAdmin)
owner_site.register(Membership, MembershipAdmin)
owner_site.register(Invitation, ReadOnlyAdmin)
owner_site.register(OwnershipTransfer, TransferAdmin)
# InvitationMail intentionally unregistered: protected delivery payloads are never exposed.
