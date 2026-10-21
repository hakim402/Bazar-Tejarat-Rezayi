from django.db import transaction, IntegrityError
from django.shortcuts import get_object_or_404
from django.db.models import Max
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError
from apps.accounts.services import get_grant
from apps.organizations.access import Conflict
from .models import ContentItem, ContentRevision, ContentEvent, Publication, FIXED
from .validation import payload, structure, SLUG

SETTINGS = {"home", "shell", "support", "announcement"}


def authority(request, context, capability, item=None):
    if context not in {"owner", "staff"}:
        raise PermissionDenied()
    account = get_grant(request, context)
    if context == "owner":
        return
    required = {capability} | (
        {"manage_settings"} if item and item.kind in SETTINGS else set()
    )
    codes = set(
        account.permission_groups.filter(
            permissions__content_type__app_label="content"
        ).values_list("permissions__codename", flat=True)
    )
    if not required.issubset(codes):
        raise PermissionDenied()


def audit(request, context, item, revision, action, reason):
    ContentEvent.objects.create(
        item=item,
        revision=revision,
        actor=request.user,
        context=context,
        action=action,
        reason=reason,
    )


def versioned(key, version, request, context, capability):
    item = get_object_or_404(ContentItem.objects.select_for_update(), key=key)
    authority(request, context, capability, item)
    if item.version != version:
        raise Conflict()
    return item


def operation(item, revision=None):
    return {
        "id": item.pk,
        "version": item.version,
        "revision": revision.pk if revision else None,
        "state": revision.state if revision else "created",
    }


@transaction.atomic
def create(request, context, data):
    authority(request, context, "edit_content")
    if not SLUG.fullmatch(data["key"]) or data["key"] in {
        "help",
        "api",
        "admin",
        "auth",
        "account",
    }:
        raise ValidationError({"key": ["Use a stable lowercase editorial slug."]})
    if (data["key"] in FIXED and FIXED[data["key"]] != data["kind"]) or (
        data["key"] not in FIXED and data["kind"] != "article"
    ):
        raise ValidationError(
            {"kind": ["Use the reserved identity type or a help article."]}
        )
    if ContentItem.objects.filter(key=data["key"]).exists():
        raise Conflict()
    item = ContentItem(key=data["key"], kind=data["kind"])
    authority(request, context, "edit_content", item)
    try:
        with transaction.atomic():
            item.save()
    except IntegrityError:
        raise Conflict() from None
    audit(request, context, item, None, "create", "")
    return operation(item)


@transaction.atomic
def save(request, context, key, data):
    item = versioned(key, data["version"], request, context, "edit_content")
    content = payload(data["payload"], item.kind)
    source = None
    if data["locale"] != "fa-AF":
        source = item.revisions.filter(pk=data.get("source"), locale="fa-AF").first()
        if not source or structure(source.payload) != structure(content):
            raise ValidationError(
                {
                    "source": [
                        "Translate an exact source revision without changing its structure or support values."
                    ]
                },
                code="source_structure",
            )
    elif data.get("source"):
        raise ValidationError(
            {"source": ["Dari source has no translation parent."]},
            code="source_structure",
        )
    number = (item.revisions.aggregate(value=Max("number"))["value"] or 0) + 1
    revision = ContentRevision.objects.create(
        item=item,
        number=number,
        locale=data["locale"],
        source=source,
        payload=content,
        author=request.user,
    )
    item.version += 1
    item.save(update_fields=["version"])
    audit(request, context, item, revision, "save", "")
    return operation(item, revision)


@transaction.atomic
def transition(request, context, key, data):
    action = data["action"]
    item = versioned(
        key,
        data["version"],
        request,
        context,
        "edit_content" if action == "submit" else "publish_content",
    )
    revision = get_object_or_404(item.revisions, pk=data["revision"])
    if action == "unpublish":
        if item.kind == "legal" and context != "owner":
            raise PermissionDenied()
        selected = Publication.objects.filter(
            item=item, locale=revision.locale, revision=revision
        )
        if not selected.exists():
            raise Conflict()
        selected.delete()
    elif action in {"submit", "return"}:
        if revision.state not in (
            {"draft", "returned"} if action == "submit" else {"submitted"}
        ):
            raise Conflict()
        revision.state = "submitted" if action == "submit" else "returned"
        revision.save(update_fields=["state"])
    elif action == "publish":
        if revision.state != "submitted":
            raise Conflict()
        payload(revision.payload, item.kind)
        source = Publication.objects.filter(item=item, locale="fa-AF").first()
        if revision.locale != "fa-AF" and (
            not source or source.revision_id != revision.source_id
        ):
            raise Conflict("Translation does not match the current published source.")
        if item.kind == "legal":
            if context != "owner":
                raise PermissionDenied()
            effective = data.get("effective_date")
            if (
                not data.get("owner_approval")
                or not effective
                or effective > timezone.localdate()
            ):
                raise ValidationError(
                    {
                        "effective_date": [
                            "Explicit owner approval and an effective date no later than today are required."
                        ]
                    }
                )
            revision.effective_date = effective
        revision.state = "published"
        revision.save(update_fields=["state", "effective_date"])
        Publication.objects.update_or_create(
            item=item,
            locale=revision.locale,
            defaults={"revision": revision, "publisher": request.user},
        )
    item.version += 1
    item.save(update_fields=["version"])
    audit(request, context, item, revision, action, data["reason"])
    return operation(item, revision)
