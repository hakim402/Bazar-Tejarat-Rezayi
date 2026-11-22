"""Sanitized operational metadata. Explicit retry uses a native guarded form."""

from django import forms
from django.contrib import admin, messages
from django.contrib.admin import SimpleListFilter
from django.core.exceptions import PermissionDenied
from django.http import Http404, HttpResponseRedirect
from django.utils import formats, timezone
from django.utils.html import format_html, format_html_join
from django.utils.translation import gettext_lazy as _
from rest_framework.exceptions import APIException
from unfold.widgets import UnfoldAdminTextareaWidget

from apps.accounts.admin import owner_site
from apps.accounts.admin.access import admin_actor, permits
from apps.accounts.admin.display import state_badge
from apps.accounts.admin.theme import DELIVERY_THEME as T
from apps.accounts.admin.theme import DELIVERY_TONES
from apps.catalogue.admin.presentation import identity
from apps.organizations.admin import ReadOnlyAdmin
from .delivery import retry
from .models import (
    DELIVERY_FAILURE_STATUSES,
    AftercareEmail,
    AftercareEmailAttempt,
    AftercareNoticeCursor,
    Attempt,
    Event,
    Notice,
    OrderNoticeCursor,
    Outbox,
    Preference,
)

# Only an uncertain or exhausted delivery may be retried.
RETRYABLE = {"delivery_unknown", "exhausted"}
ATTEMPT_HISTORY_LIMIT = 10
STATE_LABELS = {
    "queued": _("Queued"),
    "claimed": _("Claimed"),
    "dispatching": _("Dispatching"),
    "captured": _("Captured"),
    "smtp_accepted": _("Accepted by mail server"),
    "retry_due": _("Retry due"),
    "cancelled": _("Cancelled"),
    "exhausted": _("Exhausted"),
    "delivery_unknown": _("Delivery unknown"),
}
STATE_MEANING = {
    "queued": _("Waiting for the delivery worker to pick this message up."),
    "claimed": _("A worker holds this delivery and will send it shortly."),
    "dispatching": _("The send is in progress. Acceptance is not confirmed yet."),
    "captured": _("The mail adapter accepted the message. This is not proof the recipient received it."),
    "smtp_accepted": _("Accepted by the mail server. This is not proof the recipient received it."),
    "retry_due": _("A definite rejection happened. Another attempt is already scheduled."),
    "cancelled": _("The recipient is no longer eligible for this message."),
    "exhausted": _("Every attempt was used and failed. A guarded retry requeues the message from scratch."),
    "delivery_unknown": _(
        "The mail server may already have accepted this message. The outcome is unknown, so a retry can send it twice."
    ),
}
ACCEPTED_MEANING = _("Accepted by the mail server. This is not proof the recipient received it.")
CODE_LABELS = {
    "adapter_accepted": _("Accepted by the mail adapter"),
    "definite_rejection": _("Definite rejection"),
    "possible_acceptance": _("Possible acceptance, outcome unknown"),
    "no_longer_eligible": _("Recipient no longer eligible"),
    "preparation_failed": _("Preparation failed before sending"),
    "expired_dispatch_lease": _("Send lease expired"),
}


def state_label(status):
    """Readable delivery state instead of the stored status value."""
    return STATE_LABELS.get(status, status)


def code_label(code):
    """Readable delivery attempt outcome; unknown codes stay as recorded."""
    return CODE_LABELS.get(code, code)


def delivery_badge(status):
    """Delivery badge in the delivery tone palette, with a readable label."""
    return state_badge(status, state_label(status), DELIVERY_TONES.get(status))


def attempt_history(attempts):
    """Recorded attempts of one delivery, newest first, with honest truncation."""
    total = attempts.count()
    if not total:
        return _("No delivery attempt recorded yet.")
    rows = list(attempts.order_by("-created_at")[:ATTEMPT_HISTORY_LIMIT])
    body = format_html_join(
        "",
        '<p class="{}">{} · <bdi>{}</bdi> · <bdi>{}</bdi></p>',
        (
            (
                T["history"],
                delivery_badge(row.status),
                code_label(row.code),
                formats.localize(timezone.template_localtime(row.created_at)),
            )
            for row in rows
        ),
    )
    if total > len(rows):
        body += format_html(
            '<p class="{}">{}</p>',
            T["muted"],
            _("Showing the %(shown)s most recent of %(total)s recorded attempts.")
            % {"shown": len(rows), "total": total},
        )
    return format_html('<div class="flex flex-col gap-2">{}</div>', body)


def delivery_summary(obj):
    """Readable delivery state for one outbox or aftercare email record."""
    return {
        "status": obj.status,
        "badge": delivery_badge(obj.status),
        "label": state_label(obj.status),
        "meaning": STATE_MEANING.get(obj.status, ""),
        "retryable": obj.status in RETRYABLE,
        "accepted": obj.status in {"smtp_accepted", "captured"},
    }


def recipient_name(account):
    return account.user.display_name or account.user.email


def enquiry_title(conversation):
    return (conversation.snapshot or {}).get("title") or _("Enquiry thread")


def aftercare_target(email):
    """Readable target of an aftercare email, without its payload."""
    if email.order_id:
        invoice = getattr(email.order, "invoice", None)
        return (invoice.number if invoice else str(email.order)), _("Reported order")
    return str(email.report_id)[:8], _("Reported case")


def event_target(event):
    if event.order_id:
        invoice = getattr(event.order, "invoice", None)
        return invoice.number if invoice else str(event.order)
    if event.report_id:
        return str(event.report_id)[:8]
    return ""


class DeliveryForm(forms.ModelForm):
    expected_version = forms.IntegerField(min_value=1, widget=forms.HiddenInput)
    retry_unknown = forms.BooleanField(
        required=False,
        label=_("Retry delivery (may duplicate an accepted email)"),
        help_text=_("Only an uncertain or exhausted delivery can be retried. The worker re-checks eligibility before sending."),
    )
    reason = forms.CharField(
        label=_("Reason"),
        min_length=3,
        max_length=1000,
        required=False,
        widget=UnfoldAdminTextareaWidget(attrs={"rows": 3}),
        help_text=_("Recorded with your identity in the delivery audit."),
    )
    acknowledge_risk = forms.BooleanField(
        required=False,
        label=_("I acknowledge the risk of duplicate delivery"),
        help_text=_("The mail server may already have accepted the message, so a retry can deliver it twice."),
    )

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


class DeliveryIssueFilter(SimpleListFilter):
    """Deliveries that need attention: uncertain outcome or no attempts left."""

    title = _("Delivery")
    parameter_name = "delivery"

    def lookups(self, request, model_admin):
        from apps.accounts.admin.review_queues import review_labels

        return (("issues", review_labels()["aftercare_email_issues"]),)

    def queryset(self, request, queryset):
        return queryset.filter(status__in=DELIVERY_FAILURE_STATUSES) if self.value() == "issues" else queryset


class OutboxAdmin(ReadOnlyAdmin):
    change_form_outer_before_template = "notifications/includes/delivery_state.html"
    list_display = ["delivery_identity", "delivery_state", "attempts", "due_at", "accepted_at"]
    list_display_links = ["delivery_identity"]
    list_filter = ["status", DeliveryIssueFilter]
    search_fields = []
    ordering = ["-created_at", "pk"]
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
        "delivery_attempts",
    ]
    readonly_fields = [
        "id",
        "status",
        "attempts",
        "due_at",
        "lease_until",
        "accepted_at",
        "version",
        "delivery_attempts",
    ]
    fieldset_groups = (
        (
            _("Delivery state"),
            _("The state of this message and when the worker will act on it."),
            ["id", "status", "attempts", "due_at", "lease_until", "accepted_at", "version"],
        ),
        (
            _("Retry delivery"),
            _("Only uncertain or exhausted deliveries can be retried, with a reason and a duplicate-risk acknowledgement."),
            ["expected_version", "retry_unknown", "reason", "acknowledge_risk"],
        ),
        (
            _("Delivery attempts"),
            _("Technical history of this delivery."),
            ["delivery_attempts"],
        ),
    )

    def lookup_allowed(self, lookup, value, request=None):
        return lookup in {"id", "id__exact", "status", "status__exact", "delivery"}

    def get_readonly_fields(self, request, obj=None):
        return self.readonly_fields

    def get_form(self, request, obj=None, **kwargs):
        form = super().get_form(request, obj, **kwargs)
        if "expected_version" in form.base_fields:
            form.base_fields["expected_version"].initial = obj.version if obj else 1
        return form

    def get_queryset(self, request):
        return super().get_queryset(request).select_related("account__user", "conversation")

    def staff_view(self, request, obj=None):
        return permits(request, "notifications", "view_delivery", "retry_delivery")

    def staff_change(self, request, obj=None):
        return permits(request, "notifications", "retry_delivery")

    def has_change_permission(self, request, obj=None):
        return permits(request, "notifications", "retry_delivery")

    def get_fields(self, request, obj=None):
        return self.fields if self.has_change_permission(request, obj) else self.readonly_fields

    def render_change_form(self, request, context, add=False, change=False, form_url="", obj=None):
        if obj is not None:
            context["delivery_state"] = delivery_summary(obj)
            context["delivery_target"] = {
                "recipient": recipient_name(obj.account),
                "enquiry": enquiry_title(obj.conversation),
            }
        return super().render_change_form(request, context, add, change, form_url, obj)

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

    @admin.display(description=_("Delivery"))
    def delivery_identity(self, obj):
        return identity(recipient_name(obj.account), enquiry_title(obj.conversation), glyph="outgoing_mail")

    @admin.display(description=_("Delivery state"))
    def delivery_state(self, obj):
        return delivery_badge(obj.status)

    @admin.display(description=_("Delivery attempts"))
    def delivery_attempts(self, obj):
        return attempt_history(obj.delivery_attempts)


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
    fields = ["attempt_identity", "delivery_state", "code_label", "created_at"]
    list_display = ["attempt_identity", "delivery_state", "code_label", "created_at"]
    list_display_links = ["attempt_identity"]
    list_filter = ["status", "code"]
    ordering = ["-created_at", "-pk"]

    def lookup_allowed(self, lookup, value, request=None):
        return lookup in {"id", "id__exact", "status", "status__exact", "code", "code__exact"}

    def get_queryset(self, request):
        return super().get_queryset(request).select_related("outbox__account__user", "outbox__conversation")

    @admin.display(description=_("Delivery attempt"))
    def attempt_identity(self, obj):
        return identity(recipient_name(obj.outbox.account), enquiry_title(obj.outbox.conversation), glyph="history")

    @admin.display(description=_("Delivery state"))
    def delivery_state(self, obj):
        return delivery_badge(obj.status)

    @admin.display(description=_("Outcome"))
    def code_label(self, obj):
        return code_label(obj.code)


class PrivateMetadataAdmin(DiagnosticAdmin):
    def staff_view(self, request, obj=None):
        return False


class AftercareEmailAdmin(PrivateMetadataAdmin):
    fields = [
        "email_identity", "delivery_state", "attempts", "due_at", "accepted_at", "created_at",
        "delivery_attempts",
    ]
    list_display = ["email_identity", "delivery_state", "attempts", "due_at", "accepted_at"]
    list_display_links = ["email_identity"]
    list_filter = ["status", DeliveryIssueFilter]
    ordering = ["-created_at", "-pk"]

    def lookup_allowed(self, lookup, value, request=None):
        return lookup in {"id", "id__exact", "status", "status__exact", "delivery"}

    def get_queryset(self, request):
        return super().get_queryset(request).select_related("account__user", "order__invoice", "report")

    @admin.display(description=_("Aftercare email"))
    def email_identity(self, obj):
        name, kind = aftercare_target(obj)
        return identity(recipient_name(obj.account), _("%(kind)s · %(reference)s") % {"kind": kind, "reference": name}, glyph="mail")

    @admin.display(description=_("Delivery state"))
    def delivery_state(self, obj):
        return delivery_badge(obj.status)

    @admin.display(description=_("Delivery attempts"))
    def delivery_attempts(self, obj):
        return attempt_history(obj.delivery_attempts)


class AftercareEmailAttemptAdmin(PrivateMetadataAdmin):
    fields = ["attempt_identity", "delivery_state", "code_label", "created_at"]
    list_display = ["attempt_identity", "delivery_state", "code_label", "created_at"]
    list_display_links = ["attempt_identity"]
    ordering = ["-created_at", "-pk"]

    def get_queryset(self, request):
        return super().get_queryset(request).select_related("email__account__user", "email__order__invoice")

    @admin.display(description=_("Aftercare email attempt"))
    def attempt_identity(self, obj):
        name, kind = aftercare_target(obj.email)
        return identity(
            recipient_name(obj.email.account),
            _("%(kind)s · %(reference)s") % {"kind": kind, "reference": name},
            glyph="history",
        )

    @admin.display(description=_("Delivery state"))
    def delivery_state(self, obj):
        return delivery_badge(obj.status)

    @admin.display(description=_("Outcome"))
    def code_label(self, obj):
        return code_label(obj.code)


class NoticeEventAdmin(PrivateMetadataAdmin):
    """Notification events, kept readable but secondary to reports and delivery."""

    fields = ["event_identity", "kind_label", "created_at"]
    list_display = ["event_identity", "kind_label", "created_at"]
    list_display_links = ["event_identity"]
    ordering = ["-created_at", "-pk"]

    def get_queryset(self, request):
        return super().get_queryset(request).select_related("order__invoice")

    @admin.display(description=_("Notification event"))
    def event_identity(self, obj):
        target = event_target(obj)
        return identity(obj.get_kind_display(), target or _("Personal notice"), glyph="notifications")

    @admin.display(description=_("Event kind"))
    def kind_label(self, obj):
        return obj.get_kind_display()


class NoticeAdmin(PrivateMetadataAdmin):
    """Personal notices: who was told and whether they read it."""

    fields = ["notice_identity", "kind_label", "read_state", "created_at"]
    list_display = ["notice_identity", "kind_label", "read_state", "created_at"]
    list_display_links = ["notice_identity"]
    ordering = ["-created_at", "-pk"]

    def get_queryset(self, request):
        return super().get_queryset(request).select_related("account__user", "event")

    @admin.display(description=_("Notice"))
    def notice_identity(self, obj):
        return identity(recipient_name(obj.account), obj.event.get_kind_display(), glyph="notifications")

    @admin.display(description=_("Event kind"))
    def kind_label(self, obj):
        return obj.event.get_kind_display()

    @admin.display(description=_("Read state"))
    def read_state(self, obj):
        return state_badge("read" if obj.read_at else "unread")


class PreferenceAdmin(PrivateMetadataAdmin):
    """Notification preferences per account."""

    fields = ["preference_identity", "channels", "locale", "version"]
    list_display = ["preference_identity", "channels", "locale"]
    list_display_links = ["preference_identity"]

    def get_queryset(self, request):
        return super().get_queryset(request).select_related("account__user")

    @admin.display(description=_("Preference"))
    def preference_identity(self, obj):
        return identity(recipient_name(obj.account), _("Notification preferences"), glyph="tune")

    @admin.display(description=_("Email channels"))
    def channels(self, obj):
        return _(
            "Message %(message)s · Payment %(payment)s · Aftercare %(aftercare)s"
        ) % {
            "message": _("on") if obj.message_email else _("off"),
            "payment": _("on") if obj.payment_email else _("off"),
            "aftercare": _("on") if obj.aftercare_email else _("off"),
        }


class CursorAdmin(PrivateMetadataAdmin):
    """Bounded fan-out cursors; technical progress only."""

    fields = ["cursor_identity", "complete_label", "version"]
    list_display = ["cursor_identity", "complete_label", "version"]
    list_display_links = ["cursor_identity"]

    def get_queryset(self, request):
        return super().get_queryset(request).select_related("event")

    @admin.display(description=_("Cursor"))
    def cursor_identity(self, obj):
        return identity(obj.event.get_kind_display(), _("Notice fan-out"), glyph="sync")

    @admin.display(description=_("Complete"))
    def complete_label(self, obj):
        return state_badge("complete" if obj.complete else "pending")


owner_site.register(Outbox, OutboxAdmin)
owner_site.register(Attempt, AttemptAdmin)
owner_site.register(AftercareEmail, AftercareEmailAdmin)
owner_site.register(AftercareEmailAttempt, AftercareEmailAttemptAdmin)
owner_site.register(Event, NoticeEventAdmin)
owner_site.register(Notice, NoticeAdmin)
owner_site.register(Preference, PreferenceAdmin)
owner_site.register(OrderNoticeCursor, CursorAdmin)
owner_site.register(AftercareNoticeCursor, CursorAdmin)
