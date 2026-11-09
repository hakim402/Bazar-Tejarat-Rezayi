"""Bounded retained report validation before native guard/schema publication.

Do not use live scope/reviewer helpers: revoked accounts, groups and memberships
are valid history. CaseEvent retains action/version but not assignment targets;
we can prove assignment/reset structure and the final Account identity, not
reconstruct an earlier assignee or their then-current permission grants.
"""

from uuid import UUID
from django.db.models import F, Q
from apps.accounts.models import Account
from apps.runtime.transfer import TransferError
from apps.organizations.models import Membership
from . import models as m

CHUNK = 100
TARGETS = ("message", "product", "store", "order")


def seller_identity(business, account, at):
    return account.context == "seller" and (
        business.account_id == account.pk
        or Membership.objects.filter(company=business, account=account, created_at__lte=at).exists()
    )


def participant(business, buyer_id, account, at):
    return (account.context == "buyer" and account.pk == buyer_id) or seller_identity(business, account, at)


def conversation_snapshot(room):
    # Product/revision identity is retained; publication and titles may change.
    from apps.catalogue.models import SourceRevision

    try:
        revision = UUID(str(room.snapshot.get("revision"))) if isinstance(room.snapshot, dict) else None
    except (ValueError, TypeError, AttributeError):
        raise TransferError("Restored report conversation revision identity is invalid.") from None
    if (
        room.buyer.context != "buyer" or room.product.seller_id != room.seller_id
        or not isinstance(room.snapshot, dict) or room.snapshot.get("product") != str(room.product_id)
        or not SourceRevision.objects.filter(product_id=room.product_id, pk=revision).exists()
    ):
        raise TransferError("Restored report conversation differs from its retained product/scope snapshot.")


def report_scope(report):
    kinds = [kind for kind in TARGETS if getattr(report, kind + "_id") is not None]
    if len(kinds) != 1:
        raise TransferError("Restored report does not have exactly one typed target.")
    kind = kinds[0]
    if kind == "message":
        message = report.message
        room = message.conversation
        conversation_snapshot(room)
        if (
            not message.published or message.sequence < 1 or message.sequence > room.sequence
            or message.author.context != message.context
            or not participant(room.seller, room.buyer_id, message.author, message.created_at)
            or message.created_at > report.created_at
            or not participant(room.seller, room.buyer_id, report.reporter, report.created_at)
        ):
            raise TransferError("Restored message report differs from retained participant/message scope.")
        return kind, room.seller, room.buyer_id
    if kind == "order":
        order = report.order
        if order.accepted_at > report.created_at or not participant(
            order.seller, order.buyer_id, report.reporter, report.created_at,
        ):
            raise TransferError("Restored order report differs from retained buyer/seller scope.")
        return kind, order.seller, order.buyer_id
    if report.reporter.context != "buyer":
        raise TransferError("Restored product/store report lacks its retained buyer identity.")
    business = report.product.seller if kind == "product" else report.store.profile
    return kind, business, None


def independent(report, business, buyer_id, actor_id, at):
    if (
        actor_id in {report.reporter.user_id, business.account.user_id}
        or (buyer_id is not None and Account.objects.filter(
            pk=buyer_id, user_id=actor_id,
        ).exists())
        or Membership.objects.filter(
            Q(company=business) | Q(company__account_id=buyer_id),
            account__user_id=actor_id, created_at__lte=at,
        ).exists()
    ):
        raise TransferError("Restored report action conflicts with its retained participant identities.")


def validate_history():
    for report in m.Report.objects.select_related(
        "reporter", "assigned_to", "message__author", "message__conversation__buyer",
        "message__conversation__seller__account", "message__conversation__product",
        "product__seller__account", "store__profile__account", "order__seller__account",
    ).iterator(chunk_size=CHUNK):
        kind, business, buyer_id = report_scope(report)
        target = getattr(report, kind + "_id")
        action = "report:" + (str(target) if kind == "message" else kind + ":" + str(target))
        opening_command = False
        for command in m.Command.objects.filter(outcome__id=str(report.pk)).iterator(chunk_size=CHUNK):
            outcome = command.outcome
            if (
                command.account_id != report.reporter_id or command.action != action
                or not isinstance(outcome, dict) or outcome.get("status") != "open"
                or type(outcome.get("version")) is not int or not 1 <= outcome["version"] <= report.version
            ):
                raise TransferError("Restored report target differs from its retained typed command identity.")
            opening_command |= outcome["version"] == 1
        if not opening_command:
            raise TransferError("Restored report lacks its retained opening target command.")
        state, version, last_at, assignments = None, 0, report.created_at, 0
        for event in report.events.order_by("version", "created_at", "pk").iterator(chunk_size=CHUNK):
            version += 1
            if event.version != version or event.created_at < last_at or not 3 <= len(event.reason.strip()) <= 1000:
                raise TransferError("Restored report event version/chronology/reason is incomplete.")
            if version == 1:
                if event.action != "reported" or event.actor_id != report.reporter.user_id or event.reason != report.reason:
                    raise TransferError("Restored report opening differs from its retained reporter/event.")
                state = "open"
            else:
                independent(report, business, buyer_id, event.actor_id, event.created_at)
                if event.action == "assign" and state == "open":
                    assignments += 1
                elif event.action == "resolve" and state == "open":
                    state = "resolved"
                elif event.action == "reopen" and state == "resolved":
                    state, assignments = "open", 0
                else:
                    raise TransferError("Restored report contains an invalid chronological transition.")
            last_at = event.created_at
        if version != report.version or state != report.status or version == 0:
            raise TransferError("Restored report state/version differs from its retained event chain.")
        if report.assigned_to_id is not None:
            if assignments == 0 or report.assigned_to.context != "staff":
                raise TransferError("Restored report assignment lacks its retained action/staff identity.")
            independent(report, business, buyer_id, report.assigned_to.user_id, last_at)
        if report.category not in {"abuse", "fraud", "spam", "privacy", "other"} or not 3 <= len(report.reason.strip()) <= 1000:
            raise TransferError("Restored report category/reason is invalid.")
        for access in report.accesses.select_related(
            "conversation__buyer", "conversation__seller", "conversation__product",
        ).iterator(chunk_size=CHUNK):
            room = access.conversation
            if (
                kind not in {"message", "order"} or access.context not in {"owner", "staff"}
                or (access.context == "staff" and not Account.objects.filter(user_id=access.actor_id, context="staff").exists())
            ):
                raise TransferError("Restored report access grants an unsupported target/context.")
            conversation_snapshot(room)
            if kind == "message":
                scoped = room.pk == report.message.conversation_id
            else:
                order = report.order
                scoped = (
                    room.buyer_id == order.buyer_id and room.seller_id == order.seller_id
                    and order.lines.filter(variant__product_id=room.product_id).exists()
                )
            if not scoped or room.created_at > access.created_at:
                raise TransferError("Restored case access conversation crosses its retained report target.")
            independent(report, business, buyer_id, access.actor_id, access.created_at)
            access_state = None
            for event in report.events.filter(created_at__lte=access.created_at).order_by("version").iterator(chunk_size=CHUNK):
                if event.action in {"reported", "reopen"}:
                    access_state = "open"
                elif event.action == "resolve":
                    access_state = "resolved"
            if access_state != "open":
                raise TransferError("Restored report disclosure lacks an open historical case.")
            if access.action == "inspect":
                valid = access.target == room.pk
            elif access.action == "image":
                valid = m.Attachment.objects.filter(
                    pk=access.target, conversation_id=room.pk, product_id=room.product_id,
                    message__conversation_id=room.pk, message__published=True,
                    message__author_id=F("creator_id"), message__created_at__lte=access.created_at,
                    created_at__lte=access.created_at,
                ).exists()
            else:
                valid = False
            if not valid:
                raise TransferError("Restored case access target differs from its retained conversation/image.")
