"""Root-only native admin commerce report. Staff platform aggregates are not exposed."""

from datetime import date, timedelta
from urllib.parse import urlencode

from django import forms
from django.core.exceptions import PermissionDenied
from django.shortcuts import render
from django.urls import path, reverse
from django.utils.translation import gettext_lazy as _
from django.utils import timezone
from django.views.decorators.http import require_GET
from rest_framework.exceptions import APIException, ValidationError

from apps.accounts.admin.theme import REPORT_THEME
from apps.accounts.services import get_grant
from apps.catalogue.models import SourceRevision
from apps.fulfilment.queries import OPEN_HOLDS_FILTER, UNDISPATCHED_FILTER
from apps.orders.models import SellerOrder

from . import admin_queries, exports, queries
from .contracts import EXPORT_KINDS


TABS = {"summary": _("Summary"), "orders": _("Orders"), "finance": _("Finance"), "sellers": _("Sellers & locations")}
EXPORT_LABELS = {"orders": _("Accepted orders"), "payments": _("Payments received"), "refunds": _("Confirmed refunds")}


class PeriodForm(forms.Form):
    start = forms.DateField(required=False, label=_("From"), widget=forms.DateInput(attrs={"type": "date"}))
    end = forms.DateField(required=False, label=_("To"), widget=forms.DateInput(attrs={"type": "date"}))
    kind = forms.ChoiceField(required=False, label=_("Export"), choices=[(kind, EXPORT_LABELS[kind]) for kind in EXPORT_KINDS])
    currency = forms.ChoiceField(required=False, label=_("Currency"), choices=[(code, code) for code in queries.CURRENCIES])
    tab = forms.ChoiceField(required=False, label=_("Report section"), choices=TABS.items())

    def clean(self):
        data = super().clean()
        end = data.get("end") or timezone.localdate()
        try:
            start = data.get("start") or end - timedelta(days=queries.DEFAULT_DAYS - 1)
        except OverflowError:
            raise forms.ValidationError(_("Choose dates within the supported report range.")) from None
        duration = (end - start).days + 1
        if start > end:
            raise forms.ValidationError(_("Start date must be on or before the end date."))
        if duration > queries.MAX_DAYS:
            raise forms.ValidationError(_("Choose at most %(days)s days.") % {"days": queries.MAX_DAYS})
        # The report uses an exclusive end and an equally long previous period.
        if end == date.max or start.toordinal() <= duration:
            raise forms.ValidationError(_("Choose dates within the supported report range."))
        return data


def owner_only(request):
    try:
        get_grant(request, "owner")
    except APIException:
        raise PermissionDenied from None


def period_presets(window):
    today = timezone.localdate()
    return [
        {"label": label, "start": start.isoformat(), "end": today.isoformat(),
         "selected": window["start"] == start and window["end"] == today}
        for label, start in (
            (_("Last 7 days"), today - timedelta(days=6)),
            (_("Last 14 days"), today - timedelta(days=13)),
            (_("Last 30 days"), today - timedelta(days=29)),
            (_("This month"), today.replace(day=1)),
        )
    ]


def queue_links(counts):
    """Current queues, independent of the report's historical date range."""
    links = (
        ("holds", _("Open delivery holds"), "pause_circle", "fulfilment_blocker", OPEN_HOLDS_FILTER),
        ("payment_reviews", _("Payment reviews"), "payments", "payments_reviewcase", {"state": "open"}),
        ("awaiting_dispatch", _("Awaiting dispatch"), "local_shipping", "orders_sellerorder", UNDISPATCHED_FILTER),
        ("publication", _("Catalogue revisions awaiting publication review"), "inventory_2", "catalogue_sourcerevision", {"state__exact": "submitted"}),
        ("disputes", _("Open disputes"), "gavel", "orders_disputerequest", {"state": "pending"}),
        ("cancellations", _("Cancellation requests"), "cancel", "orders_cancellationrequest", {"state": "pending"}),
        ("amendments", _("Pending amendments"), "edit_note", "orders_amendment", {"state": "pending"}),
        ("delivery_reviews", _("Open delivery reviews"), "fact_check", "fulfilment_reviewcase", {"state__exact": "open"}),
        ("reviews_pending", _("Reviews awaiting moderation"), "rate_review", "orders_review", {"state": "pending"}),
    )
    return [{"label": label, "icon": icon, "count": counts[key],
             "url": reverse(f"admin:{route}_changelist") + "?" + urlencode(filters)}
            for key, label, icon, route, filters in links]


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
        tab = data.get("tab") or "summary"
        currency = data.get("currency") or "AFN"
        report = admin_queries.dashboard(SellerOrder.objects.all(), window, tab=tab, currency=currency)
        if tab == "summary":
            report["queues"] = queue_links({**report["queues"], "publication": SourceRevision.objects.filter(state="submitted").count()})

        params = {"start": window["start"].isoformat(), "end": window["end"].isoformat(), "tab": tab, "currency": currency}
        presets = period_presets(window)

        def link(**changes):
            return "?" + urlencode({**params, **changes})

        context = {
            **admin_site.each_context(request),
            "title": _("Commerce reports"),
            "form": form,
            "window": window,
            "report": report,
            "rz_report": REPORT_THEME,
            "tab": tab,
            "currency": currency,
            "presets": presets,
            "custom_period": not valid or not any(preset["selected"] for preset in presets),
            "start_value": request.GET.get("start") or params["start"],
            "end_value": request.GET.get("end") or params["end"],
            "tabs": [{"label": label, "url": link(tab=key), "active": key == tab} for key, label in TABS.items()],
            "currencies": [{"label": code, "url": link(currency=code), "active": code == currency} for code in queries.CURRENCIES],
            "export_links": [{"label": EXPORT_LABELS[kind], "url": link(kind=kind, export=1)} for kind in EXPORT_KINDS],
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

    from apps.accounts.admin.access import admin_actor
    from apps.accounts.admin.work import my_work
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
