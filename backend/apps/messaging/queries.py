"""Narrow projections; message bodies are never in inboxes, notices or metadata."""

from django.db.models import F, OuterRef, Subquery, Value
from django.db.models.functions import Coalesce
from django.shortcuts import get_object_or_404
from . import access
from .models import Message, ReadState, Report
from .services import read_receipt


def inbox(actor, *, seller=None, page=1, unread=False):
    account = actor.account
    state = ReadState.objects.filter(account=account, conversation_id=OuterRef("pk"))
    rows = access.scope(actor, seller).annotate(
        personal_read=Coalesce(Subquery(state.values("last_read")[:1]), Value(0)),
        personal_incoming=Coalesce(Subquery(state.values("latest_incoming")[:1]), Value(0)),
    )
    if unread:
        rows = rows.filter(personal_incoming__gt=F("personal_read"))
    count = rows.count()
    items = list(rows.order_by("-updated_at", "pk")[(page - 1) * 20 : page * 20])
    return {
        "count": count,
        "page": page,
        "results": [
            {
                "id": str(x.pk),
                "snapshot": x.snapshot,
                "updated_at": x.updated_at,
                "unread": x.personal_incoming > x.personal_read,
                "sequence": x.sequence,
                "seller": str(x.seller_id),
            }
            for x in items
        ],
    }


def detail(actor, pk):
    item = access.conversation(actor, pk)
    row = ReadState.objects.filter(conversation=item, account=actor.account).first()
    return {
        "id": str(item.pk),
        "snapshot": item.snapshot,
        "seller": str(item.seller_id),
        "sequence": item.sequence,
        "can_send": access.writable(item),
        "last_read": row.last_read if row else 0,
        "unread": bool(row and row.latest_incoming > row.last_read),
    }


def message_row(row, account=None):
    return {
        "id": str(row.pk),
        "sequence": row.sequence,
        "body": row.body,
        "author": row.author_label,
        "context": row.context,
        "own": bool(account and row.author_id == account.pk),
        "created_at": row.created_at,
        "images": [
            {"id": str(a.pk), "width": a.width, "height": a.height, "size": a.size} for a in row.attachments.all()
        ],
    }


def history(actor, pk, *, before=None, after=None, limit=50):
    item = access.conversation(actor, pk)
    account = actor.account
    rows = Message.objects.filter(conversation=item)
    if before is not None:
        rows = rows.filter(sequence__lt=before)
    if after is not None:
        rows = rows.filter(sequence__gt=after)
    rows = rows.order_by("sequence" if after is not None else "-sequence").prefetch_related("attachments")
    result = list(rows[: limit + 1])
    more = len(result) > limit
    result = result[:limit]
    result.sort(key=lambda x: x.sequence)
    # Recheck company/grant scope after history hydration, before disclosure.
    access.conversation(actor, pk)
    maximum = max([x.sequence for x in result], default=0)
    return {
        "results": [message_row(x, account) for x in result],
        "has_more": more,
        "oldest": result[0].sequence if result else None,
        "latest": maximum,
        "receipt": read_receipt(actor, item, maximum),
    }


def reports(actor, message_id):
    message = get_object_or_404(Message.objects.filter(conversation__in=access.scope(actor)), pk=message_id)
    return {
        "results": [
            {"id": str(r.pk), "status": r.status, "version": r.version, "created_at": r.created_at}
            for r in Report.objects.filter(message=message, reporter=actor.account).order_by("-created_at")[:20]
        ]
    }


def target_reports(actor, kind, target_id):
    get_object_or_404(access.target_scope(actor, kind), pk=target_id)
    return {
        "results": [
            {"id": str(r.pk), "status": r.status, "version": r.version, "created_at": r.created_at}
            for r in Report.objects.filter(reporter=actor.account, **{kind + "_id": target_id})
            .order_by("-created_at")[:20]
        ]
    }


def own_reports(actor, *, page=1):
    qs = Report.objects.filter(reporter=actor.account).order_by("-created_at", "pk")
    count = qs.count()
    items = list(qs[(page - 1) * 20 : page * 20])
    return {
        "count": count,
        "page": page,
        "results": [
            {
                "id": str(r.pk),
                "status": r.status,
                "version": r.version,
                "created_at": r.created_at,
                "target_kind": r.target_kind,
                "target": str(getattr(r, r.target_kind + "_id")),
            }
            for r in items
        ],
    }


def profile_choices(actor, page=1):
    account = actor.account
    from rest_framework.exceptions import PermissionDenied

    if actor.context != "seller":
        raise PermissionDenied()
    qs = access.seller_profiles_for(account).order_by("created_at", "pk")
    return {
        "results": [
            {"id": str(x.pk), "name": x.display_name, "kind": x.kind, "messaging": True}
            for x in qs[(page - 1) * 20 : page * 20]
        ],
        "count": qs.count(),
        "page": page,
    }


def unread_count(actor, seller=None):
    return ReadState.objects.filter(
        account=actor.account, conversation__in=access.scope(actor, seller), latest_incoming__gt=F("last_read")
    ).count()
