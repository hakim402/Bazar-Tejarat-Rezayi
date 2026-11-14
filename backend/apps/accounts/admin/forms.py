"""Admin forms for identity provisioning and staff account status changes."""
from django import forms
from django.contrib.auth.forms import UserChangeForm, UserCreationForm
from django.utils.translation import gettext_lazy as _

from .copy import COPY as ADMIN_COPY
from ..models import Account, User


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