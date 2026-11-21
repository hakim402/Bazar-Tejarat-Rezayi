"""Manage customer address-book entries without changing order snapshots."""

from django import forms
from django.db import transaction
from django.utils.translation import gettext_lazy as _
from unfold.admin import ModelAdmin

from ..models import Address, User
from ..services import audit
from ..services.profile import _clear_other_defaults
from .presentation import label
from .site import owner_site


class AddressForm(forms.ModelForm):
    class Meta:
        model = Address
        fields = "__all__"

    def clean(self):
        data = super().clean()
        for name in ("recipient_name", "street_address"):
            if not data.get(name, "").strip():
                self.add_error(name, _("This field is required."))
        return data

    def _get_validation_exclusions(self):
        # The save replaces an existing default under the identity row lock.
        return {*super()._get_validation_exclusions(), "is_default"}


class AddressAdmin(ModelAdmin):
    form = AddressForm
    list_display = ["user", "label", "province", "city", "is_default", "updated_at"]
    list_select_related = ["user"]
    list_filter = ["is_default", "province"]
    search_fields = ["user__display_name", "user__email", "label"]
    search_help_text = label("Find by name or email")
    autocomplete_fields = ["user"]
    actions = None
    warn_unsaved_form = True
    fieldsets = [
        (_("Address"), {"fields": ["user", "label", ("recipient_name", "phone"), ("province", "city"),
                                  "area", "street_address", "landmark", "is_default"]}),
    ]

    def get_readonly_fields(self, request, obj=None):
        return ["user"] if obj else []

    @transaction.atomic
    def save_model(self, request, obj, form, change):
        user = User.objects.select_for_update().get(pk=obj.user_id)
        if change:
            Address.objects.select_for_update().get(pk=obj.pk, user=user)
        if obj.is_default:
            _clear_other_defaults(user, keep_pk=obj.pk)
        super().save_model(request, obj, form, change)
        audit("owner_address_updated" if change else "owner_address_created",
              request=request, user=user, context="owner", fields=["addresses"])

    @transaction.atomic
    def delete_model(self, request, obj):
        user = User.objects.select_for_update().get(pk=obj.user_id)
        current = Address.objects.select_for_update().get(pk=obj.pk, user=user)
        super().delete_model(request, current)
        audit("owner_address_deleted", request=request, user=user, context="owner", fields=["addresses"])


owner_site.register(Address, AddressAdmin)
