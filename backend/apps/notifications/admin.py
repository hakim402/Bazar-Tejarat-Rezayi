"""Sanitized operational metadata. Explicit retry uses a native guarded form."""

from django import forms
from django.http import HttpResponseRedirect, Http404
from django.core.exceptions import PermissionDenied
from django.contrib import messages
from rest_framework.exceptions import APIException
from django.utils.translation import gettext_lazy as _
from unfold.widgets import UnfoldAdminTextareaWidget
from apps.accounts.admin import owner_site
from apps.accounts.admin_access import permits, admin_actor
from apps.organizations.admin import ReadOnlyAdmin
from .models import (
    Outbox, Attempt, Event, Notice, Preference, OrderNoticeCursor,
    AftercareNoticeCursor, AftercareEmail, AftercareEmailAttempt,
)
from .delivery import retry


class DeliveryForm(forms.ModelForm):
    expected_version = forms.IntegerField(min_value=1, widget=forms.HiddenInput)
    retry_unknown = forms.BooleanField(required=False, label=_("Retry delivery (may duplicate an accepted email)"))
    reason = forms.CharField(label=_("Reason"), min_length=3, max_length=1000, required=False, widget=UnfoldAdminTextareaWidget(attrs={"rows": 3}))
    acknowledge_risk = forms.BooleanField(required=False, label=_("I acknowledge the risk of duplicate delivery"))

    class Meta:
        model = Outbox
        fields = []

    def clean(self):
        values = super().clean()
        if values.get("retry_unknown") and (
            not values.get("acknowledge_risk") or len(values.get("reason", "").strip()) < 3
        ):
            raise forms.ValidationError(_("A reason and duplicate-risk acknowledgement are required."))
        return values


class OutboxAdmin(ReadOnlyAdmin):
    list_display = ["id", "status", "attempts", "due_at", "accepted_at"]
    list_filter = ["status"]
    search_fields = []
    form = DeliveryForm
    fields = [
        "id",
        "status",
        "attempts",
        "due_at",
        "lease_until",
        "accepted_at",
        "version",
        "expected_version",
        "retry_unknown",
        "reason",
        "acknowledge_risk",
    ]
    readonly_fields = ["id", "status", "attempts", "due_at", "lease_until", "accepted_at", "version"]

    def lookup_allowed(self, lookup, value, request=None):
        return lookup in {"id", "id__exact", "status", "status__exact"}

    def get_readonly_fields(self, request, obj=None):
        return self.readonly_fields

    def get_form(self, request, obj=None, **kwargs):
        form = super().get_form(request, obj, **kwargs)
        if "expected_version" in form.base_fields:
            form.base_fields["expected_version"].initial = obj.version if obj else 1
        return form

    def staff_view(self, request, obj=None):
        return permits(request, "notifications", "view_delivery", "retry_delivery")

    def staff_change(self, request, obj=None):
        return permits(request, "notifications", "retry_delivery")

    def has_change_permission(self, request, obj=None):
        return permits(request, "notifications", "retry_delivery")

    def get_fields(self, request, obj=None):
        return self.fields if self.has_change_permission(request, obj) else self.readonly_fields

    def change_view(self, request, object_id, form_url="", extra_context=None):
        if request.method != "POST":
            return super().change_view(request, object_id, form_url, extra_context)
        if not self.has_change_permission(request):
            raise PermissionDenied
        obj = self.get_object(request, object_id)
        if obj is None:
            raise Http404
        form = self.get_form(request, obj)(request.POST, instance=obj)
        if not form.is_valid():
            return super().change_view(request, object_id, form_url, extra_context)
        if not form.cleaned_data.get("retry_unknown"):
            raise PermissionDenied
        try:
            retry(
                admin_actor(request),
                obj.pk,
                form.cleaned_data["expected_version"],
                form.cleaned_data["reason"],
                form.cleaned_data["acknowledge_risk"],
            )
        except APIException:
            messages.error(request, _("Delivery changed or access ended. Review its current status before retrying."))
        else:
            messages.info(request, _("Retry recorded. The worker will recheck current eligibility."))
        return HttpResponseRedirect(request.path)

    def save_model(self, *args, **kwargs):
        raise PermissionDenied

    def save_related(self, *args, **kwargs):
        raise PermissionDenied


class DiagnosticAdmin(ReadOnlyAdmin):
    fields = ["identifier"]
    list_display = ["identifier"]
    search_fields = []

    def identifier(self, obj):
        return str(obj.pk)

    def lookup_allowed(self, lookup, value, request=None):
        return lookup in {self.model._meta.pk.name, self.model._meta.pk.name + "__exact"}

    def get_readonly_fields(self, request, obj=None):
        return self.fields

    def staff_view(self, request, obj=None):
        return permits(request, "notifications", "view_delivery")


class AttemptAdmin(DiagnosticAdmin):
    fields = ["id", "delivery_id", "status", "code", "created_at"]
    list_display = fields
    list_filter = ["status", "code"]
    ordering = ["-created_at", "pk"]

    def delivery_id(self, obj):
        return str(obj.outbox_id)

    def lookup_allowed(self, lookup, value, request=None):
        return lookup in {"id", "id__exact", "status", "status__exact", "code", "code__exact"}


owner_site.register(Outbox, OutboxAdmin)
owner_site.register(Attempt, AttemptAdmin)


class PrivateMetadataAdmin(DiagnosticAdmin):
    def staff_view(self, request, obj=None):
        return False


for model in (Event, Notice, Preference):
    owner_site.register(model, PrivateMetadataAdmin)


for model in (OrderNoticeCursor, AftercareNoticeCursor, AftercareEmail, AftercareEmailAttempt):
    owner_site.register(model, PrivateMetadataAdmin)
