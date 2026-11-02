"""Atomic enquiry/message/read/report commands. No commerce or stock mutation."""

from apps.runtime.locks import lock as durable_lock

import hashlib
import json
from django.core import signing
from django.db import connection, transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import APIException, ValidationError
from apps.catalogue.models import Product
from apps.marketplace.queries import PublicGate
from apps.organizations.models import BusinessProfile
from . import access
from .models import Conversation, Message, Attachment, Command, ReadState, Report


class CommandConflict(APIException):
    status_code = 409
    default_code = "command_conflict"
    default_detail = "Review the command outcome before retrying."


class ConversationExists(CommandConflict):
    def __init__(self, pk):
        super().__init__({"code": "conversation_exists", "conversation": str(pk)})


def digest(data):
    return hashlib.sha256(json.dumps(data, sort_keys=True, separators=(",", ":"), default=str).encode()).hexdigest()


def replay(account, action, key, data):
    # Transaction-local command lock, scoped after participant/authority locks.
    token = int.from_bytes(hashlib.sha256(f"{account.pk}:{action}:{key}".encode()).digest()[:8], "big", signed=True)
    durable_lock(token)
    hashed = digest(data)
    old = Command.objects.filter(account=account, action=action, key=key).first()
    if old and old.digest != hashed:
        raise CommandConflict()
    return old.outcome if old else None


def outcome(account, action, key, data, value):
    Command.objects.create(account=account, action=action, key=key, digest=digest(data), outcome=value)
    return value


def bind_images(actor, item, message, ids):
    if len(ids) > 3 or len(ids) != len(set(ids)):
        raise ValidationError({"images": ["image_count"]})
    rows = list(Attachment.objects.select_for_update().filter(pk__in=ids).order_by("pk"))
    if len(rows) != len(ids):
        raise ValidationError({"images": ["image_unavailable"]})
    for image in rows:
        if (
            image.creator_id != actor.account.pk
            or image.product_id != item.product_id
            or image.message_id
            or image.conversation_id not in {None, item.pk}
            or not image.expires_at
            or image.expires_at <= timezone.now()
        ):
            raise ValidationError({"images": ["image_unavailable"]})
        image.message, image.conversation, image.expires_at = message, item, None
        image.save(update_fields=["message", "conversation", "expires_at"])


def append(actor, item, data):
    account = actor.account
    text = data.get("body", "")
    images = data.get("images", [])
    if len(text) > 6000 or not text.strip() and not images:
        raise ValidationError({"body": ["message_required"]})
    item.sequence += 1
    item.updated_at = timezone.now()
    item.save(update_fields=["sequence", "updated_at"])
    message = Message.objects.create(
        conversation=item,
        sequence=item.sequence,
        author=account,
        context=actor.context,
        author_label=account.user.display_name[:150],
        body=text,
    )
    bind_images(actor, item, message, images)
    if connection.vendor == "mysql":
        Message.construction.filter(pk=message.pk, published=False).update(published=True)
        message.published = True
    from apps.notifications.services import message_committed

    message_committed(item, message, account)
    return message


@transaction.atomic
def create_enquiry(actor, data):
    account = actor.account
    if actor.context != "buyer":
        from rest_framework.exceptions import PermissionDenied

        raise PermissionDenied()
    product = get_object_or_404(Product.objects.all(), pk=data["product"])
    access.lock_actor(actor, product.seller_id)
    product = get_object_or_404(Product.objects.select_for_update(), pk=data["product"])
    profile = BusinessProfile.objects.select_related("account").get(pk=product.seller_id)
    old = replay(account, "enquiry", data["command_id"], data)
    if old:
        access.conversation(actor, old["conversation"])
        return old
    access.not_self(profile, actor.account)
    public = PublicGate(data.get("locale", "fa-AF")).product(product.pk)
    existing = Conversation.objects.filter(buyer=account, seller=profile, product=product).first()
    if existing:
        raise ConversationExists(existing.pk)
    item = Conversation.objects.create(
        buyer=account,
        seller=profile,
        product=product,
        snapshot={
            "product": str(product.pk),
            "revision": str(product.published_id),
            "title": public["body"]["title"],
            "currency": public["currency"],
            "seller": public["store"]["name"],
        },
    )
    message = append(actor, item, data)
    return outcome(
        account,
        "enquiry",
        data["command_id"],
        data,
        {"conversation": str(item.pk), "message": str(message.pk), "sequence": message.sequence},
    )


@transaction.atomic
def send(actor, pk, data):
    item = access.conversation(actor, pk, lock=True)
    account = actor.account
    action = "send:" + str(item.pk)
    old = replay(account, action, data["command_id"], data)
    if old:
        return old
    access.require_write(item)
    message = append(actor, item, data)
    return outcome(
        account,
        action,
        data["command_id"],
        data,
        {"conversation": str(item.pk), "message": str(message.pk), "sequence": message.sequence},
    )


def read_receipt(actor, item, sequence):
    grant = actor.request.session["grants"][actor.context]["grant_id"]
    return signing.dumps(
        {
            "account": str(actor.account.pk),
            "context": actor.context,
            "conversation": str(item.pk),
            "sequence": sequence,
            "grant": str(grant),
        },
        salt="messaging-displayed",
        compress=True,
    )


@transaction.atomic
def acknowledge(actor, pk, data):
    item = access.conversation(actor, pk, lock=True)
    account = actor.account
    try:
        proof = signing.loads(data["receipt"], salt="messaging-displayed", max_age=3600)
    except signing.BadSignature:
        raise ValidationError({"receipt": ["invalid"]}) from None
    expected = {
        "account": str(account.pk),
        "context": actor.context,
        "conversation": str(item.pk),
        "grant": str(actor.request.session["grants"][actor.context]["grant_id"]),
    }
    if any(proof.get(k) != v for k, v in expected.items()) or data["sequence"] > min(
        proof.get("sequence", -1), item.sequence
    ):
        raise ValidationError({"sequence": ["not_displayed"]})
    row, _ = ReadState.objects.get_or_create(conversation=item, account=account)
    row.last_read = max(row.last_read, data["sequence"])
    row.save(update_fields=["last_read"])
    return {"last_read": row.last_read}


@transaction.atomic
def report(actor, message_id, data):
    preliminary = get_object_or_404(Message.objects.filter(conversation__in=access.scope(actor)), pk=message_id)
    item = access.conversation(actor, preliminary.conversation_id, lock=True)
    account = actor.account
    action = "report:" + str(message_id)
    old = replay(account, action, data["command_id"], data)
    if old:
        return old
    message = get_object_or_404(Message, pk=message_id, conversation=item)
    result = Report.objects.create(message=message, reporter=account, category=data["category"], reason=data["reason"])
    from .models import CaseEvent

    CaseEvent.objects.create(report=result, actor=actor.user, action="reported", reason=data["reason"], version=1)
    return outcome(
        account,
        action,
        data["command_id"],
        data,
        {"id": str(result.pk), "status": result.status, "version": result.version},
    )
