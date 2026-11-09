"""Root-only native admin commerce report. Staff platform aggregates are not exposed."""

from django import forms
from django.core.exceptions import PermissionDenied
from django.shortcuts import render
from django.urls import path
from django.views.decorators.http import require_GET
from rest_framework.exceptions import APIException, ValidationError

from apps.accounts.services import get_grant
from apps.orders.models import SellerOrder

from . import exports, queries
from .contracts import EXPORT_KINDS


class PeriodForm(forms.Form):
    start = forms.DateField(required=False, widget=forms.DateInput(attrs={"type": "date"}))
    end = forms.DateField(required=False, widget=forms.DateInput(attrs={"type": "date"}))
    kind = forms.ChoiceField(required=False, choices=[(kind, kind) for kind in EXPORT_KINDS])

    def clean(self):
        data = super().clean()
        start, end = data.get("start"), data.get("end")
        if start and end and start > end:
            raise forms.ValidationError("Start date must be on or before the end date.")
        if start and end and (end - start).days + 1 > queries.MAX_DAYS:
            raise forms.ValidationError(f"Choose at most {queries.MAX_DAYS} days.")
        return data


def owner_only(request):
    try:
        get_grant(request, "owner")
    except APIException:
        raise PermissionDenied from None


def report_urls(admin_site):
    @require_GET
    def commerce(request):
        owner_only(request)
        form = PeriodForm(request.GET or None)
        valid = form.is_valid() if request.GET else True
        data = form.cleaned_data if request.GET and valid else {}
        window = queries.period(data.get("start"), data.get("end"))
        if valid and request.GET.get("export"):
            kind = data.get("kind") or "orders"
            try:
                return exports.platform_export(request, kind, window)
            except ValidationError:
                form.add_error(None, "Too many rows; choose a shorter period.")
        orders = SellerOrder.objects.all()
        rights = {name: True for name in queries.SECTIONS}
        context = {
            **admin_site.each_context(request),
            "title": "Commerce reports",
            "form": form,
            "window": window,
            "report": queries.summary(orders, window, rights),
            "sellers": queries.platform_sellers(window),
            "kinds": EXPORT_KINDS,
        }
        return render(request, "reports/admin/commerce.html", context)

    return [path("reports/commerce/", admin_site.admin_view(commerce), name="reports_commerce")]
