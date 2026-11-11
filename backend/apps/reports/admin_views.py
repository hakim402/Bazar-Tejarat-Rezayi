"""Root-only native admin commerce report. Staff platform aggregates are not exposed."""

from django import forms
from django.core.exceptions import PermissionDenied
from django.shortcuts import render
from django.urls import path
from django.utils.translation import gettext_lazy as _
from django.views.decorators.http import require_GET
from rest_framework.exceptions import APIException, ValidationError

from apps.accounts.services import get_grant
from apps.catalogue.models import SourceRevision
from apps.orders.models import SellerOrder

from . import exports, queries
from .contracts import EXPORT_KINDS


class PeriodForm(forms.Form):
    start = forms.DateField(required=False, label=_("From"), widget=forms.DateInput(attrs={"type": "date"}))
    end = forms.DateField(required=False, label=_("To"), widget=forms.DateInput(attrs={"type": "date"}))
    kind = forms.ChoiceField(required=False, label=_("Export"), choices=[(kind, kind) for kind in EXPORT_KINDS])

    def clean(self):
        data = super().clean()
        start, end = data.get("start"), data.get("end")
        if start and end and start > end:
            raise forms.ValidationError(_("Start date must be on or before the end date."))
        if start and end and (end - start).days + 1 > queries.MAX_DAYS:
            raise forms.ValidationError(_("Choose at most %(days)s days.") % {"days": queries.MAX_DAYS})
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
                form.add_error(None, _("Too many rows; choose a shorter period."))
        orders = SellerOrder.objects.all()
        rights = {name: True for name in queries.SECTIONS}
        context = {
            **admin_site.each_context(request),
            "title": _("Commerce reports"),
            "form": form,
            "window": window,
            "report": queries.summary(orders, window, rights),
            "sellers": queries.platform_sellers(window),
            "publication_pending": SourceRevision.objects.filter(state="submitted").count(),
            "kinds": EXPORT_KINDS,
        }
        return render(request, "reports/admin/commerce.html", context)

    @require_GET
    def work(request):
        return staff_work_report(request, admin_site)

    return [
        path("reports/commerce/", admin_site.admin_view(commerce), name="reports_commerce"),
        path("reports/work/", admin_site.admin_view(work), name="reports_work"),
    ]


def staff_work_report(request, admin_site):
    """Fresh native queue scopes, without platform or financial aggregates."""
    from django.http import HttpResponseBadRequest

    from apps.accounts.admin_access import admin_actor
    from apps.accounts.admin_work import my_work
    from apps.accounts.models import AuditEvent
    from apps.accounts.services import rate_limit

    actor = admin_actor(request)
    if set(request.GET) - {"export"} or request.GET.getlist("export") not in ([], ["1"]):
        return HttpResponseBadRequest("Invalid report query.")
    rows = my_work(admin_site, request, actor)
    if request.GET.get("export"):
        import csv
        import io

        rate_limit(request, "staff_report_export", identity=str(actor.user.pk), limit=30)
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["queue", "open", "assigned_to_me", "unassigned"])
        for row in rows:
            writer.writerow([exports.cell(row[key]) for key in ("label", "open", "mine", "unassigned")])
        AuditEvent.objects.create(
            actor=actor.user, account=actor.account, context=actor.context,
            action="staff_report_exported", resource_type="reports.work",
            reason="Scoped work queue export", state={"queues": len(rows)},
        )
        return exports.response("\ufeff" + output.getvalue(), "my-work.csv")
    return render(request, "reports/admin/work.html", {
        **admin_site.each_context(request), "title": _("My work"), "my_work": rows,
    })
