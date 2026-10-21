import copy
from django.db.models import F
from .models import Publication
from .services import authority
from .validation import AUTH


def selections(keys=None):
    rows = Publication.objects.select_related("item", "revision").order_by(
        "item__key", "locale"
    )
    if keys is not None:
        rows = rows.filter(item__key__in=keys)
    return list(rows)


def public_targets():
    return {
        ("/help/" + key if kind == "article" else "/" + key)
        for key, kind in Publication.objects.filter(locale="fa-AF").values_list(
            "item__key", "item__kind"
        )
        if kind in {"article", "page", "legal"}
    }


def available_target(value, active):
    return value in AUTH or value in {"/", "/help"} or value in active


def resolved(key, locale, rows=None, *, filter_links=True, active=None):
    rows = selections([key]) if rows is None else rows
    matching = [r for r in rows if r.item.key == key]
    source = next((r for r in matching if r.locale == "fa-AF"), None)
    if not source:
        return None
    translations = [
        r
        for r in matching
        if r.locale != "fa-AF" and r.revision.source_id == source.revision_id
    ]
    chosen = next((r for r in translations if r.locale == locale), source)
    data = copy.deepcopy(chosen.revision.payload)
    if filter_links:
        if active is None:
            active = public_targets()
        for b in data["blocks"]:
            b["links"] = [
                link for link in b["links"] if available_target(link["target"], active)
            ]
        for group in data["navigation"]:
            group["links"] = [
                link
                for link in group["links"]
                if available_target(link["target"], active)
            ]
        data["navigation"] = [g for g in data["navigation"] if g["links"]]
        data["blocks"] = [b for b in data["blocks"] if b["enabled"]]
    return {
        "key": key,
        "kind": chosen.item.kind,
        "revision": chosen.revision_id,
        "number": chosen.revision.number,
        "requested_locale": locale,
        "content_locale": chosen.locale,
        "fallback": chosen.locale != locale,
        "available_locales": ["fa-AF", *[r.locale for r in translations]],
        "published_at": chosen.published_at,
        "effective_date": chosen.revision.effective_date,
        "payload": data,
    }


def editor_item(request, context, item):
    authority(request, context, "read_drafts", item)
    return {
        "id": item.pk,
        "key": item.key,
        "kind": item.kind,
        "version": item.version,
        "revisions": list(
            item.revisions.order_by("-number")
            .annotate(author_name=F("author__display_name"))
            .values(
                "id",
                "number",
                "locale",
                "source_id",
                "payload",
                "state",
                "effective_date",
                "created_at",
                "author_name",
            )
        ),
        "publications": {p.locale: p.revision_id for p in item.publications.all()},
        "history": list(
            item.events.order_by("-created_at")
            .annotate(actor_name=F("actor__display_name"))
            .values(
                "id", "action", "reason", "revision_id", "created_at", "actor_name"
            )[:100]
        ),
    }
