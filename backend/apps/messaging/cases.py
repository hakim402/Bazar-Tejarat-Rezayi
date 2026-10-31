"""A participant report is the only case authority. No arbitrary case minting."""

from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import PermissionDenied, ValidationError, NotFound
from apps.accounts.admin_access import permission_codes
from apps.accounts.models import Account
from apps.organizations.models import Membership
from . import access
from .models import Report, CaseEvent, CaseAccess, Attachment, PERMISSIONS
from .services import CommandConflict
from .queries import message_row


def rights(actor):
    actor.account
    return (
        set(PERMISSIONS)
        if actor.context == "owner"
        else set(permission_codes(actor.account, "messaging"))
        if actor.context == "staff"
        else set()
    )


def independent(report, user):
    item = report.message.conversation
    if (
        report.reporter.user_id == user.pk
        or item.buyer.user_id == user.pk
        or item.seller.account.user_id == user.pk
        or Membership.objects.filter(company_id=item.seller_id, account__user=user).exists()
    ):
        raise PermissionDenied("Another independent reviewer must handle this case.")


def queryset(actor):
    permissions = rights(actor)
    qs = Report.objects.all()
    if not permissions:
        return qs.none()
    if actor.context == "owner":
        return qs
    qs = (
        qs.exclude(reporter__user=actor.user)
        .exclude(message__conversation__buyer__user=actor.user)
        .exclude(message__conversation__seller__account__user=actor.user)
        .exclude(message__conversation__seller__memberships__account__user=actor.user)
    )
    if "assign_message_case" not in permissions:
        qs = qs.filter(assigned_to=actor.account)
    return qs.distinct()


def require_read(actor, report):
    if (
        "read_message_case" not in rights(actor)
        or report.status != "open"
        or actor.context != "owner"
        and report.assigned_to_id != actor.account.pk
    ):
        raise NotFound()
    independent(report, actor.user)


def reviewers(report):
    item = report.message.conversation
    conflicts = Membership.objects.filter(company=item.seller).values("account__user_id")
    return (
        Account.objects.filter(
            context="staff",
            status="active",
            user__is_active=True,
            user__email_verified=True,
            user__is_staff=True,
            user__groups__permissions__content_type__app_label="messaging",
            user__groups__permissions__codename="read_message_case",
        )
        .exclude(user_id__in=conflicts)
        .exclude(user_id__in=[report.reporter.user_id, item.buyer.user_id, item.seller.account.user_id])
        .distinct()
    )


@transaction.atomic
def transition(actor, pk, *, version, action, reason, assigned_to=None):
    preliminary = get_object_or_404(queryset(actor).select_related("message__conversation"), pk=pk)
    access.lock_actor(actor, preliminary.message.conversation.seller_id)
    report = get_object_or_404(
        Report.objects.filter(pk__in=queryset(actor).values("pk")).select_for_update(of=("self",)), pk=pk
    )
    independent(report, actor.user)
    if report.version != version:
        raise CommandConflict()
    required = {
        "assign": "assign_message_case",
        "resolve": "resolve_message_case",
        "reopen": "reopen_message_case",
    }.get(action)
    if not required or required not in rights(actor):
        raise PermissionDenied()
    if len(reason.strip()) < 3 or len(reason) > 1000:
        raise ValidationError({"reason": ["required"]})
    if action == "assign":
        if report.status != "open":
            raise CommandConflict()
        if assigned_to is not None:
            get_object_or_404(reviewers(report), pk=assigned_to)
        report.assigned_to_id = assigned_to
    elif action == "resolve":
        require_read(actor, report)
        report.status = "resolved"
    elif action == "reopen":
        if report.status != "resolved":
            raise CommandConflict()
        report.status = "open"
        report.assigned_to = None
    report.version += 1
    report.save(update_fields=["assigned_to", "status", "version"])
    CaseEvent.objects.create(report=report, actor=actor.user, action=action, reason=reason, version=report.version)
    from apps.notifications.services import report_status

    report_status(report)
    return report


@transaction.atomic
def inspect(actor, pk, *, before=None):
    preliminary = get_object_or_404(queryset(actor).select_related("message__conversation"), pk=pk)
    access.lock_actor(actor, preliminary.message.conversation.seller_id)
    report = get_object_or_404(
        Report.objects.filter(pk__in=queryset(actor).values("pk"))
        .select_for_update(of=("self",))
        .select_related("message__conversation"),
        pk=pk,
    )
    require_read(actor, report)
    item = report.message.conversation
    rows = item.messages.all()
    if before:
        rows = rows.filter(sequence__lt=before)
    rows = list(rows.order_by("-sequence").prefetch_related("attachments")[:51])
    has_more = len(rows) > 50
    rows = rows[:50]
    rows.reverse()
    CaseAccess.objects.create(
        report=report, conversation=item, actor=actor.user, context=actor.context, action="inspect", target=item.pk
    )
    # Audit failure rolls back and no body projection escapes this function.
    return {
        "report": report,
        "snapshot": item.snapshot,
        "reason": report.reason,
        "reported_message": message_row(report.message),
        "messages": [message_row(row) for row in rows],
        "has_more": has_more,
        "oldest": rows[0].sequence if rows else None,
    }


@transaction.atomic
def attachment(actor, report_id, pk):
    preliminary = get_object_or_404(queryset(actor).select_related("message__conversation"), pk=report_id)
    access.lock_actor(actor, preliminary.message.conversation.seller_id)
    report = get_object_or_404(
        Report.objects.filter(pk__in=queryset(actor).values("pk"))
        .select_for_update(of=("self",))
        .select_related("message__conversation"),
        pk=report_id,
    )
    require_read(actor, report)
    item = get_object_or_404(Attachment, pk=pk, conversation_id=report.message.conversation_id, message__isnull=False)
    CaseAccess.objects.create(
        report=report,
        conversation_id=item.conversation_id,
        actor=actor.user,
        context=actor.context,
        action="image",
        target=item.pk,
    )
    return item
