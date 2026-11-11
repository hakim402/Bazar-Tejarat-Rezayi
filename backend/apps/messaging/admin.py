"""Native metadata lists and one audited, related-case conversation workspace."""

from django import forms
from django.db import transaction
from django.contrib.admin import SimpleListFilter
from django.core.exceptions import PermissionDenied
from django.http import HttpResponseRedirect, JsonResponse
from django.shortcuts import get_object_or_404, render
from django.urls import path, reverse
from django.utils.html import format_html
from django.utils.translation import gettext_lazy as _
from rest_framework.exceptions import APIException
from unfold.widgets import UnfoldAdminSelectWidget, UnfoldAdminTextareaWidget
from apps.accounts.admin import owner_site
from apps.accounts.admin_access import admin_actor, permits
from apps.organizations.admin import ReadOnlyAdmin
from . import cases, media
from .models import Conversation, Message, Attachment, ReadState, Command, Report, CaseEvent, CaseAccess, PERMISSIONS


class CaseForm(forms.Form):
    version = forms.IntegerField(min_value=1, widget=forms.HiddenInput)
    action = forms.ChoiceField(label=_("Action"), choices=[], widget=UnfoldAdminSelectWidget)
    reason = forms.CharField(label=_("Decision reason"), min_length=3, max_length=1000, widget=UnfoldAdminTextareaWidget(attrs={"rows": 3}))
    assigned_to = forms.ModelChoiceField(
        label=_("Assigned reviewer"), queryset=cases.Account.objects.none(), required=False, widget=UnfoldAdminSelectWidget
    )


class TargetKindFilter(SimpleListFilter):
    """Filter reports by their polymorphic target kind (property, not DB field)."""
    title = _("Target kind")
    parameter_name = "target_kind"

    def lookups(self, request, model_admin):
        return [
            ("message", _("Message")),
            ("product", _("Product")),
            ("store", _("Store")),
            ("order", _("Order")),
        ]

    def queryset(self, request, queryset):
        value = self.value()
        if value is None:
            return queryset
        if value == "message":
            return queryset.filter(message__isnull=False)
        if value == "product":
            return queryset.filter(product__isnull=False)
        if value == "store":
            return queryset.filter(store__isnull=False)
        if value == "order":
            return queryset.filter(order__isnull=False)
        return queryset


class ReportAdmin(ReadOnlyAdmin):
    fields = ["id", "category", "status", "target_kind_display", "product", "store", "order", "version", "created_at", "case_workspace"]
    list_display = ["id", "category", "status", "target_kind_display", "version", "created_at", "case_workspace"]
    list_filter = ["status", "category", TargetKindFilter]
    search_fields = []
    ordering = ["-created_at", "pk"]

    def lookup_allowed(self, lookup, value, request=None):
        return lookup in {
            "id", "id__exact",
            "status", "status__exact",
            "category", "category__exact",
            "target_kind", "target_kind__exact",
        }

    def get_readonly_fields(self, request, obj=None):
        return self.fields

    def target_kind_display(self, obj):
        return obj.target_kind
    target_kind_display.short_description = _("Target kind")

    def staff_view(self, request, obj=None):
        if not permits(request, "messaging", *PERMISSIONS):
            return False
        return obj is None or cases.queryset(admin_actor(request)).filter(pk=obj.pk).exists()

    def staff_queryset(self, request, qs):
        return qs.filter(pk__in=cases.queryset(admin_actor(request)).values("pk"))

    def case_workspace(self, obj):
        return format_html('<a href="{}">{}</a>', reverse("admin:messaging_report_case", args=[obj.pk]), _("Case workspace"))

    def get_urls(self):
        return [
            path("<uuid:pk>/case/", self.admin_site.admin_view(self.workflow), name="messaging_report_case"),
            path(
                "<uuid:pk>/images/<uuid:image>/download/",
                self.admin_site.admin_view(self.download),
                name="messaging_report_image",
            ),
            *super().get_urls(),
        ]

    def workflow(self, request, pk):
        actor = admin_actor(request)
        report = get_object_or_404(cases.queryset(actor).select_related("message__conversation"), pk=pk)
        permissions = cases.rights(actor)
        choices = [("", _("Choose action"))]
        if "assign_message_case" in permissions and report.status == "open":
            choices.append(("assign", _("Assign independent reviewer")))
        if "resolve_message_case" in permissions and report.status == "open":
            choices.append(("resolve", _("Resolve with reason")))
        if "reopen_message_case" in permissions and report.status == "resolved":
            choices.append(("reopen", _("Reopen with reason")))
        form = CaseForm(request.POST if request.method == "POST" else None, initial={"version": report.version})
        form.fields["action"].choices = choices
        form.fields["assigned_to"].queryset = cases.reviewers(report)
        if "assign_message_case" not in permissions:
            form.fields.pop("assigned_to")
        status = 200
        if request.method == "POST" and form.is_valid():
            data = form.cleaned_data.copy()
            if data.get("assigned_to"):
                data["assigned_to"] = data["assigned_to"].pk
            try:
                cases.transition(actor, pk, **data)
            except APIException as error:
                form.add_error(None, _("The case changed or access ended. Review the current state."))
                status = error.status_code
            else:
                return HttpResponseRedirect(request.path)
        content = None
        # Unassigned/closed cases expose metadata and transition controls only.
        try:
            cases.require_read(actor, report)
        except APIException:
            pass
        else:
            before = request.GET.get("before")
            if set(request.GET) - {"before"} or before is not None and (not before.isdigit() or int(before) < 1):
                raise PermissionDenied
            content = cases.inspect(actor, pk, before=int(before) if before else None)
            for message in [content["reported_message"], *content["messages"]]:
                if message is None:
                    continue
                for image in message["images"]:
                    image["download"] = reverse("admin:messaging_report_image", args=[pk, image["id"]])
        return render(
            request,
            "messaging/case.html",
            {
                **self.admin_site.each_context(request),
                "title": "Message report case",
                "opts": Report._meta,
                "report": report,
                "form": form,
                "content": content,
            },
            status=status,
        )

    @transaction.atomic
    def download(self, request, pk, image):
        if request.method not in {"GET", "HEAD"}:
            raise PermissionDenied
        try:
            item = cases.attachment(admin_actor(request), pk, image)
        except APIException as error:
            if error.status_code == 404:
                raise cases.NotFound() from None
            raise PermissionDenied from None
        try:
            return media.response(item, head=request.method == "HEAD")
        except APIException:
            from apps.foundation.errors import error_data

            result = JsonResponse(
                error_data("storage_unavailable", "Image storage is temporarily unavailable.", request.request_id),
                status=503,
            )
            result["Cache-Control"] = "private, no-store"
            result["Referrer-Policy"] = "no-referrer"
            result["X-Content-Type-Options"] = "nosniff"
            return result


class MetadataAdmin(ReadOnlyAdmin):
    """Explicit root-only metadata; no body/file-key/outcome or relation browser."""

    search_fields = []
    list_display = ["identifier"]
    fields = ["identifier"]

    def identifier(self, obj):
        return str(obj.pk)

    def lookup_allowed(self, lookup, value, request=None):
        return lookup in {self.model._meta.pk.name, self.model._meta.pk.name + "__exact"}

    def get_readonly_fields(self, request, obj=None):
        return self.fields


owner_site.register(Report, ReportAdmin)
for model in (Conversation, Message, Attachment, ReadState, Command, CaseEvent, CaseAccess):
    owner_site.register(model, MetadataAdmin)
