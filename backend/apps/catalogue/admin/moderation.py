"""Versioned Super Admin decisions on product visibility and deletion."""

from django import forms
from django.contrib import messages
from django.core.exceptions import PermissionDenied
from django.db import IntegrityError
from django.http import Http404
from django.shortcuts import redirect
from django.urls import reverse
from django.utils.translation import gettext_lazy as _
from rest_framework.exceptions import APIException
from unfold.widgets import UnfoldAdminTextareaWidget

from apps.accounts.admin.access import admin_actor, is_owner

from .. import services
from .helpers import DeleteRecordForm, link_button, operation_form


VISIBILITY_ACTIONS = {
    "unpublish": (_("Unpublish product"), _("Remove this product from the storefront.")),
    "restrict": (_("Restrict product"), _("Hide this product and block publication until the restriction is lifted.")),
    "lift_restriction": (_("Lift restriction"), _("Allow this product to enter publication review again.")),
}


class VisibilityForm(forms.Form):
    version = forms.IntegerField(min_value=1, widget=forms.HiddenInput)
    reason = forms.CharField(label=_("Moderation reason"), max_length=1000, widget=UnfoldAdminTextareaWidget(attrs={"rows": 3}))


def owner_product(admin, request, object_id):
    if not is_owner(request):
        raise PermissionDenied
    item = admin.get_object(request, object_id)
    if item is None:
        raise Http404
    return item


def links(item):
    actions = ["lift_restriction"] if item.moderation_state == "restrict" else ["restrict"]
    if item.published_id:
        actions.insert(0, "unpublish")
    icons = {"unpublish": "visibility_off", "restrict": "lock", "lift_restriction": "lock_open"}
    urls = [
        link_button(
            reverse("admin:catalogue_product_visibility", args=[item.pk, action]),
            VISIBILITY_ACTIONS[action][0], icons[action],
        )
        for action in actions
    ]
    urls.append(link_button(reverse("admin:catalogue_product_delete", args=[item.pk]),
                            _("Delete product"), "delete", variant="danger"))
    return urls


def change_visibility(admin, request, pk, action):
    if action not in VISIBILITY_ACTIONS:
        raise Http404
    item = owner_product(admin, request, pk)
    title, description = VISIBILITY_ACTIONS[action]
    form = VisibilityForm(request.POST if request.method == "POST" else None, initial={"version": item.version})
    if request.method == "POST" and form.is_valid():
        try:
            services.moderate_product(
                admin_actor(request), item.pk, form.cleaned_data["version"], action, form.cleaned_data["reason"],
            )
        except APIException as error:
            if error.status_code == 400:
                form.add_error("reason", _("Enter a clear reason for this decision."))
            else:
                form.add_error(None, _("The product state changed. Reload and try again."))
        else:
            messages.success(request, _("Product visibility updated."))
            return redirect("admin:catalogue_product_change", item.pk)
    return operation_form(
        request, admin, form, [(title, {"fields": ["version", "reason"], "description": description})],
        title, original=item, submit=title,
    )


def remove_product(admin, request, pk):
    item = owner_product(admin, request, pk)
    form = DeleteRecordForm(request.POST if request.method == "POST" else None, initial={"version": item.version})
    if request.method == "POST" and form.is_valid():
        try:
            services.delete_product(admin_actor(request), item.pk, form.cleaned_data["version"])
        except APIException as error:
            if error.status_code == 400:
                form.add_error(None, _("This product has linked records. Unpublish or restrict it to hide it from the storefront."))
            else:
                form.add_error(None, _("The product changed. Reload and try again."))
        except IntegrityError:
            form.add_error(None, _("This product is linked to other records. Reload before trying again."))
        else:
            messages.success(request, _("Product deleted."))
            return redirect("admin:catalogue_product_changelist")
    return operation_form(
        request, admin, form, [(_("Confirm deletion"), {
            "fields": ["version", "confirm"],
            "description": _("Products referenced by orders or stock records are protected from deletion."),
        })], _("Delete product"), original=item, submit=_("Delete product"),
    )
