from django import forms
from django.contrib import messages
from django.http import HttpResponseRedirect
from django.shortcuts import get_object_or_404, render
from django.urls import path, reverse
from django.utils.html import format_html
from django.utils.translation import gettext_lazy as _
from rest_framework.exceptions import APIException
from unfold.admin import ModelAdmin

from apps.accounts.admin import owner_site
from apps.accounts.admin_access import admin_actor, permits
from apps.accounts.admin_display import AdminDisplayMixin
from .models import BusinessProfile, Invitation, Membership, OwnershipTransfer, InvitationMail
from .profiles import PROFILE_FIELDS, update_profile
from .contracts import BusinessProfileUpdate
from .forms import WorkflowForm
from .owner_copy import COPY


class ReadOnlyAdmin(AdminDisplayMixin, ModelAdmin):
    actions = []
    list_per_page = 30
    # Deterministic newest-first pagination for every read-only inspection list;
    # subclasses may override with a domain-meaningful ordering.
    ordering = ["-pk"]
    # Optional presentation-only grouping: (title, description, field names).
    fieldset_groups = ()
    # Optional per-field help for subclasses that legitimately allow editing.
    field_help = {}

    RECORD_DESCRIPTION = _(
        "Guarded domain record — the values below are retained history. Supported changes happen "
        "only through the linked guarded workflow; generic editing or deletion would bypass "
        "version, evidence and independence safeguards."
    )

    def get_fieldsets(self, request, obj=None):
        allowed = list(self.get_fields(request, obj))
        if not self.fieldset_groups:
            return [(None, {"fields": allowed, "description": self.RECORD_DESCRIPTION})]
        sections, used = [], set()
        for title, description, fields in self.fieldset_groups:
            present = [name for name in fields if name in allowed and name not in used]
            used.update(present)
            if present:
                sections.append((title, {"fields": present, "description": description}))
        rest = [name for name in allowed if name not in used]
        if rest:
            sections.append((_("Record details"), {"fields": rest, "description": self.RECORD_DESCRIPTION}))
        return sections

    def get_form(self, request, obj=None, **kwargs):
        form = super().get_form(request, obj, **kwargs)
        for name, text in self.field_help.items():
            if name in form.base_fields:
                form.base_fields[name].help_text = text
        return form

    def get_readonly_fields(self, request, obj=None):
        return [field.name for field in self.model._meta.fields]

    def has_change_permission(self, request, obj=None):
        return False

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
        return format_html('<a href="{}">{}</a>', url, _("Open guarded workflow"))

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
        from .transfers import transfer_action
        from .teams import change_member

        obj = get_object_or_404(self.get_queryset(request), pk=pk)
        language = (getattr(request, "LANGUAGE_CODE", "en") or "en").lower()
        locale = {"fa-af": "fa-AF", "fa": "fa-AF", "ps": "ps", "ar": "ar"}.get(language, "en")
        if locale not in COPY:
            locale = "en"
        t = COPY[locale]
        actor = admin_actor(request)
        choices = [
            (v, t[v])
            for v in (
                ["approve", "reject"]
                if self.model is OwnershipTransfer
                else ["revoke"]
            )
        ]
        current_version = obj.company.version if self.model is Membership else obj.version
        form = WorkflowForm(
            request.POST if request.method == "POST" else None,
            initial={"version": current_version}, locale=locale,
        )
        form.fields["action"].choices = choices
        form.fields.pop("assigned_to")
        if request.method == "POST" and form.is_valid():
            data = form.cleaned_data
            if data.get("assigned_to") is not None:
                data["assigned_to"] = data["assigned_to"].pk
            try:
                if self.model is OwnershipTransfer:
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


class ProfileForm(forms.ModelForm):
    expected_version = forms.IntegerField(widget=forms.HiddenInput)

    class Meta:
        model = BusinessProfile
        fields = list(PROFILE_FIELDS)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields['expected_version'].initial = self.instance.version

    def clean(self):
        data = super().clean()
        if self.errors:
            return data
        current = BusinessProfile.objects.select_for_update().get(pk=self.instance.pk)
        if data['expected_version'] != current.version:
            raise forms.ValidationError('This profile changed. Your input is retained; reload the saved version before trying again.')
        contract = BusinessProfileUpdate(data={**{field: data[field] for field in PROFILE_FIELDS}, 'version': data['expected_version']})
        try:
            contract.is_valid(raise_exception=True)
        except APIException:
            raise forms.ValidationError('Review the business details. The submitted values are not valid.') from None
        data.update(contract.validated_data)
        return data


class ProfileAdmin(ModelAdmin):
    form = ProfileForm
    fields = ['account', 'kind', 'revision', 'version', *PROFILE_FIELDS, 'expected_version']
    readonly_fields = ['account', 'kind', 'revision', 'version']
    list_display = ['display_name', 'kind', 'version', 'revision']
    list_filter = ['kind']
    search_fields = ['display_name', 'legal_name']
    list_per_page = 30

    def get_fieldsets(self, request, obj=None):
        description = _(
            "Validated business details. Material changes start a new verification revision and can remove current public eligibility; review remains independent. Account, kind and historical revisions cannot be reassigned."
        )
        return [(None, {'fields': self.fields, 'description': description})]

    def has_add_permission(self, request):
        return False  # Creation belongs to the applicant account context.

    def has_delete_permission(self, request, obj=None):
        return False

    def save_model(self, request, obj, form, change):
        actor = admin_actor(request)
        if actor.context != 'owner':
            from django.core.exceptions import PermissionDenied
            raise PermissionDenied
        update_profile(actor, obj.pk, {**{field: form.cleaned_data[field] for field in PROFILE_FIELDS}, 'version': form.cleaned_data['expected_version']})
        obj.refresh_from_db()


class MembershipAdmin(WorkflowAdmin):
    list_display = ["company", "account", "is_owner", "active"]
    list_filter = ["active", "is_owner"]


class TransferAdmin(WorkflowAdmin):
    def staff_view(self, request, obj=None):
        return permits(request, "verification", "review_transfer") and (
            obj is None or self.staff_queryset(request, OwnershipTransfer.objects.filter(pk=obj.pk)).exists())

    def staff_queryset(self, request, qs):
        return qs.exclude(company__account__user=request.user).exclude(
            company__memberships__account__user=request.user).distinct()

    list_display = ["company", "requester", "recipient", "status", "version"]
    list_filter = ["status"]


owner_site.register(BusinessProfile, ProfileAdmin)
owner_site.register(Membership, MembershipAdmin)
class InvitationAdmin(ReadOnlyAdmin):
    fields = ['company', 'inviter', 'email', 'bundles', 'locale', 'expires_at', 'status', 'accepted_by', 'accepted_at', 'version', 'created_at']
    list_display = ['company', 'email', 'status', 'expires_at']
    list_filter = ['status']
    search_fields = ['company__display_name', 'email']

    def get_readonly_fields(self, request, obj=None):
        return self.fields


class InvitationDeliveryAdmin(ReadOnlyAdmin):
    fields = ['invitation', 'invitation_version', 'status', 'attempts', 'next_attempt_at']
    list_display = ['invitation', 'status', 'attempts', 'next_attempt_at']
    list_filter = ['status']

    def get_readonly_fields(self, request, obj=None):
        return self.fields


owner_site.register(Invitation, InvitationAdmin)
owner_site.register(InvitationMail, InvitationDeliveryAdmin)
owner_site.register(OwnershipTransfer, TransferAdmin)
