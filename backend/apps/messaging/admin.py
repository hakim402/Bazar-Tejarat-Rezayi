"""Native metadata lists and one audited, related-case conversation workspace."""

from django import forms
from django.contrib import admin
from django.contrib.admin import SimpleListFilter
from django.core.exceptions import PermissionDenied
from django.db import transaction
from django.db.models import OuterRef, Subquery
from django.http import HttpResponseRedirect, JsonResponse
from django.shortcuts import get_object_or_404, render
from django.urls import path, reverse
from django.utils.html import format_html
from django.utils.translation import gettext_lazy as _
from rest_framework.exceptions import APIException, NotFound
from unfold.widgets import UnfoldAdminSelectWidget, UnfoldAdminTextareaWidget

from apps.accounts.admin import owner_site
from apps.accounts.admin.access import admin_actor, permits
from apps.accounts.admin.display import short_id, state_badge
from apps.accounts.admin.theme import MESSAGING_THEME as T
from apps.catalogue.admin.presentation import identity
from apps.organizations.admin import ReadOnlyAdmin
from . import cases, media
from .models import (
    PERMISSIONS,
    Attachment,
    CaseAccess,
    CaseEvent,
    Command,
    Conversation,
    Message,
    ReadState,
    Report,
)

TARGET_GLYPHS = {"message": "forum", "product": "inventory_2", "store": "storefront", "order": "receipt_long"}
TARGET_LABELS = {
    "message": _("Message"),
    "product": _("Product"),
    "store": _("Store"),
    "order": _("Order"),
}
AUTHOR_LABELS = {"buyer": _("Buyer"), "seller": _("Seller")}
CASE_ACTION_LABELS = {
    "assign": _("Reviewer assigned"),
    "resolve": _("Case resolved"),
    "reopen": _("Case reopened"),
}
ACCESS_ACTION_LABELS = {
    "inspect": _("Conversation inspection"),
    "image": _("Image download"),
}
COMMAND_LABELS = {
    "enquiry": _("Enquiry opened"),
    "send": _("Message sent"),
    "upload": _("Image uploaded"),
}
CASE_RELATED = (
    "message__conversation",
    "product__seller__account__user",
    "store__profile__account__user",
    "order__seller__account__user",
    "order__invoice",
    "assigned_to__user",
)


def identity_block(name, meta, glyph="flag"):
    """Compact readable identity: one title, one supporting line, one glyph."""
    return identity(name, meta, glyph=glyph)


class CaseForm(forms.Form):
    version = forms.IntegerField(min_value=1, widget=forms.HiddenInput)
    action = forms.ChoiceField(label=_("Action"), choices=[], widget=UnfoldAdminSelectWidget)
    reason = forms.CharField(
        label=_("Decision reason"), min_length=3, max_length=1000, widget=UnfoldAdminTextareaWidget(attrs={"rows": 3})
    )
    assigned_to = forms.ModelChoiceField(
        label=_("Assigned reviewer"), queryset=cases.Account.objects.none(), required=False, widget=UnfoldAdminSelectWidget
    )


class TargetKindFilter(SimpleListFilter):
    """Filter reports by their polymorphic target kind (property, not DB field)."""

    title = _("Target kind")
    parameter_name = "target_kind"

    def lookups(self, request, model_admin):
        return [(kind, label) for kind, label in TARGET_LABELS.items()]

    def queryset(self, request, queryset):
        value = self.value()
        if value == "message":
            return queryset.filter(message__isnull=False)
        if value == "product":
            return queryset.filter(product__isnull=False)
        if value == "store":
            return queryset.filter(store__isnull=False)
        if value == "order":
            return queryset.filter(order__isnull=False)
        return queryset


def product_title(product):
    """Current published title of a product, without opening a revision browser."""
    from apps.catalogue.models import SourceRevision
    from apps.catalogue.queries import working_revisions

    return (
        working_revisions(SourceRevision.objects.filter(product_id=product.pk))
        .order_by("-number")
        .values_list("body__title", flat=True)
        .first()
    )


def report_target(report):
    """Readable summary of the reported target and the record behind it.

    Product and store reports are reviewed on their own target; they never
    borrow a conversation, so no message history is implied here.
    """
    kind = report.target_kind
    if kind == "message":
        conversation = report.message.conversation
        snapshot = conversation.snapshot or {}
        name = snapshot.get("title") or _("Untitled product")
        meta = snapshot.get("seller") or _("Reported message")
        url = reverse("admin:catalogue_product_change", args=[conversation.product_id])
        link = _("Open the reported product")
    elif kind == "product":
        product = report.product
        name = getattr(product, "admin_product_title", None) or product_title(product) or _("Untitled product")
        meta = product.seller.display_name
        url = reverse("admin:catalogue_product_change", args=[product.pk])
        link = _("Open the reported product")
    elif kind == "store":
        store = report.store
        name = store.profile.display_name
        meta = _("Reported store")
        url = reverse("admin:marketplace_store_change", args=[store.pk])
        link = _("Open the reported store")
    else:
        order = report.order
        invoice = getattr(order, "invoice", None)
        name = invoice.number if invoice else str(order)
        meta = order.seller.display_name
        url = reverse("admin:orders_sellerorder_change", args=[order.pk])
        link = _("Open the reported order")
    return {
        "kind": kind,
        "kind_label": TARGET_LABELS[kind],
        "name": name,
        "meta": meta,
        "url": url,
        "link": link,
        "glyph": TARGET_GLYPHS[kind],
    }


def case_activity(report):
    """Recorded case decisions, newest first."""
    rows = []
    for event in report.events.select_related("actor").order_by("-created_at", "-version")[:50]:
        label = CASE_ACTION_LABELS.get(event.action, event.action)
        rows.append(
            {
                "action": label,
                "badge": state_badge(event.action, label),
                "actor": event.actor.display_name or event.actor.email,
                "version": event.version,
                "created_at": event.created_at,
                "reason": event.reason,
            }
        )
    return rows


class ReportAdmin(ReadOnlyAdmin):
    fields = [
        "report_reference",
        "category_label",
        "status_label",
        "target_kind_display",
        "target_summary",
        "reason",
        "reviewer_label",
        "version",
        "created_at",
        "case_workspace",
    ]
    list_display = [
        "report_identity",
        "category_label",
        "status",
        "target_kind_display",
        "reviewer_label",
        "created_at",
        "case_workspace",
    ]
    list_display_links = ["report_identity"]
    list_filter = ["status", "category", TargetKindFilter]
    search_fields = []
    ordering = ["-created_at", "pk"]
    badge_fields = ("status",)
    fieldset_groups = (
        (
            _("Report"),
            _("What the participant reported, and the state the case currently holds."),
            ["report_reference", "category_label", "status_label", "target_kind_display", "version", "created_at"],
        ),
        (
            _("Reported target"),
            _("The reported item and the record it points at."),
            ["target_summary", "reason"],
        ),
        (
            _("Review"),
            _("Only an assigned independent reviewer can decide this case."),
            ["reviewer_label", "case_workspace"],
        ),
    )

    def lookup_allowed(self, lookup, value, request=None):
        return lookup in {
            "id",
            "id__exact",
            "status",
            "status__exact",
            "category",
            "category__exact",
            "target_kind",
            "target_kind__exact",
        }

    def get_readonly_fields(self, request, obj=None):
        return self.fields

    def get_queryset(self, request):
        from apps.catalogue.models import SourceRevision
        from apps.catalogue.queries import working_revisions

        return super().get_queryset(request).select_related(*CASE_RELATED).annotate(
            admin_product_title=Subquery(
                working_revisions(SourceRevision.objects.filter(product_id=OuterRef("product_id")))
                .order_by("-number")
                .values("body__title")[:1]
            )
        )

    def staff_view(self, request, obj=None):
        if not permits(request, "messaging", *PERMISSIONS):
            return False
        return obj is None or cases.queryset(admin_actor(request)).filter(pk=obj.pk).exists()

    def staff_queryset(self, request, qs):
        return qs.filter(pk__in=cases.queryset(admin_actor(request)).values("pk"))

    @admin.display(description=_("Target kind"))
    def target_kind_display(self, obj):
        return TARGET_LABELS[obj.target_kind]

    @admin.display(description=_("Report"))
    def report_reference(self, obj):
        return short_id(obj.pk)

    @admin.display(description=_("Category"))
    def category_label(self, obj):
        return obj.get_category_display()

    @admin.display(description=_("Status"))
    def status_label(self, obj):
        return state_badge(obj.status)

    @admin.display(description=_("Reported target"))
    def target_summary(self, obj):
        target = report_target(obj)
        return format_html(
            '<div class="flex flex-wrap items-center gap-3">{}{}</div>',
            identity(target["name"], target["meta"], glyph=target["glyph"]),
            format_html('<a class="{}" href="{}">{}</a>', T["action"], target["url"], target["link"]),
        )

    @admin.display(description=_("Assigned reviewer"))
    def reviewer_label(self, obj):
        if obj.assigned_to_id is None:
            return _("Unassigned")
        from apps.orders.admin_presentation import account_cell

        return account_cell(obj.assigned_to)

    @admin.display(description=_("Report"))
    def report_identity(self, obj):
        target = report_target(obj)
        meta = _("%(kind)s · %(reference)s") % {"kind": target["kind_label"], "reference": str(obj.pk)[:8]}
        return identity_block(target["name"], meta, target["glyph"])

    @admin.display(description=_("Case workspace"))
    def case_workspace(self, obj):
        return format_html(
            '<a href="{}">{}</a>', reverse("admin:messaging_report_case", args=[obj.pk]), _("Open case workspace")
        )

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
        report = get_object_or_404(cases.queryset(actor).select_related(*CASE_RELATED), pk=pk)
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
            except APIException:
                form.add_error(None, _("The case changed or access ended. Review the current state."))
            else:
                return HttpResponseRedirect(request.path)
        content = None
        inspection = "locked"
        # Product and store reports grant no conversation access. They are read
        # on their own target instead of asking for a message history.
        if report.target_kind in {"message", "order"}:
            try:
                cases.require_read(actor, report)
            except APIException:
                inspection = "locked"
            else:
                before = request.GET.get("before")
                if set(request.GET) - {"before"} or (before is not None and (not before.isdigit() or int(before) < 1)):
                    raise PermissionDenied
                try:
                    content = cases.inspect(actor, pk, before=int(before) if before else None)
                except NotFound:
                    inspection = "unavailable"
                else:
                    inspection = "granted"
                    for message in [content["reported_message"], *content["messages"]]:
                        if message is None:
                            continue
                        message["context_label"] = AUTHOR_LABELS.get(message["context"], message["context"])
                        for image in message["images"]:
                            image["download"] = reverse("admin:messaging_report_image", args=[pk, image["id"]])
                    if not content["messages"]:
                        inspection = "empty"
        else:
            inspection = "target"
        target = report_target(report)
        activities = case_activity(report)
        return render(
            request,
            "messaging/case.html",
            {
                **self.admin_site.each_context(request),
                "title": _("Message report case"),
                "opts": Report._meta,
                "report": report,
                "form": form,
                "can_act": len(choices) > 1,
                "content": content,
                "inspection": inspection,
                "target": target,
                "category": report.get_category_display(),
                "status_badge": state_badge(report.status),
                "reviewer": report.assigned_to.user.display_name if report.assigned_to_id else None,
                "activities": activities[:5],
                "more_activities": activities[5:],
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


class ConversationMetadataAdmin(MetadataAdmin):
    """Enquiry thread identity without any message content."""

    fields = ["conversation_identity", "sequence", "created_at", "updated_at"]
    list_display = ["conversation_identity", "sequence", "updated_at"]
    ordering = ["-updated_at", "-pk"]

    @admin.display(description=_("Enquiry"))
    def conversation_identity(self, obj):
        snapshot = obj.snapshot or {}
        return identity_block(snapshot.get("title") or _("Untitled product"), snapshot.get("seller") or _("Enquiry thread"), "forum")


class MessageMetadataAdmin(MetadataAdmin):
    """Message position and author label only; bodies stay out of the list."""

    fields = ["message_identity", "context_label", "created_at"]
    list_display = ["message_identity", "context_label", "created_at"]
    ordering = ["-created_at", "-pk"]

    @admin.display(description=_("Message"))
    def message_identity(self, obj):
        return identity_block(
            _("Message %(sequence)s") % {"sequence": obj.sequence}, obj.author_label or _("Enquiry thread"), "chat"
        )

    @admin.display(description=_("Author side"))
    def context_label(self, obj):
        return AUTHOR_LABELS.get(obj.context, obj.context)


class AttachmentMetadataAdmin(MetadataAdmin):
    """Image size and age only; the storage key and digest stay hidden."""

    fields = ["attachment_identity", "created_at"]
    list_display = ["attachment_identity", "created_at"]
    ordering = ["-created_at", "-pk"]

    @admin.display(description=_("Image"))
    def attachment_identity(self, obj):
        return identity_block(
            _("Image %(width)s × %(height)s") % {"width": obj.width, "height": obj.height},
            _("Attached image"),
            "image",
        )


class ReadStateMetadataAdmin(MetadataAdmin):
    """Participant read counters; inspecting a case never changes them."""

    fields = ["read_state_identity", "last_read", "latest_incoming", "episode"]
    list_display = ["read_state_identity", "last_read", "latest_incoming"]
    ordering = ["-pk"]

    @admin.display(description=_("Read state"))
    def read_state_identity(self, obj):
        name = obj.account.user.display_name or obj.account.user.email
        meta = _("%(read)s read · %(incoming)s received") % {
            "read": obj.last_read,
            "incoming": obj.latest_incoming,
        }
        return identity_block(name, meta, "done_all")

    def get_queryset(self, request):
        return super().get_queryset(request).select_related("account__user")


class CommandMetadataAdmin(MetadataAdmin):
    """Replay ledger without its payload, key or digest."""

    fields = ["command_identity", "created_at"]
    list_display = ["command_identity", "created_at"]
    ordering = ["-created_at", "-pk"]

    @admin.display(description=_("Command"))
    def command_identity(self, obj):
        # The stored action carries a record id after the verb; only the verb is shown.
        verb = str(obj.action).split(":", 1)[0]
        return identity_block(COMMAND_LABELS.get(verb, verb), _("Accepted command"), "bolt")


class CaseEventMetadataAdmin(MetadataAdmin):
    """Decision history recorded against a report."""

    fields = ["case_event_identity", "version", "created_at"]
    list_display = ["case_event_identity", "version", "created_at"]
    ordering = ["-created_at", "-pk"]

    @admin.display(description=_("Case activity"))
    def case_event_identity(self, obj):
        meta = _("Version %(version)s · %(actor)s") % {
            "version": obj.version,
            "actor": obj.actor.display_name or obj.actor.email,
        }
        return identity_block(CASE_ACTION_LABELS.get(obj.action, obj.action), meta, "history")

    def get_queryset(self, request):
        return super().get_queryset(request).select_related("actor")


class CaseAccessMetadataAdmin(MetadataAdmin):
    """Recorded inspections and image downloads."""

    fields = ["case_access_identity", "context", "created_at"]
    list_display = ["case_access_identity", "context", "created_at"]
    ordering = ["-created_at", "-pk"]

    @admin.display(description=_("Case access"))
    def case_access_identity(self, obj):
        meta = _("%(context)s · recorded access") % {"context": obj.context}
        return identity_block(ACCESS_ACTION_LABELS.get(obj.action, obj.action), meta, "visibility")


owner_site.register(Report, ReportAdmin)
owner_site.register(Conversation, ConversationMetadataAdmin)
owner_site.register(Message, MessageMetadataAdmin)
owner_site.register(Attachment, AttachmentMetadataAdmin)
owner_site.register(ReadState, ReadStateMetadataAdmin)
owner_site.register(Command, CommandMetadataAdmin)
owner_site.register(CaseEvent, CaseEventMetadataAdmin)
owner_site.register(CaseAccess, CaseAccessMetadataAdmin)
