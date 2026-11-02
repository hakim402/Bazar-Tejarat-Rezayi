"""Versioned seller drafts and independent native review, with a consistent business/store lock order."""

from apps.runtime.locks import lock as durable_lock

import uuid
from django.core.files.base import ContentFile
from django.core.files.storage import storages
from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import APIException, PermissionDenied
from apps.accounts.models import Account, AuditEvent
from apps.catalogue.media import decode, StorageUnavailable
from apps.catalogue.validation import fail
from apps.organizations.access import assert_version, Conflict
from apps.organizations.models import BusinessProfile
from apps.verification.models import ReviewCase
from . import access, validation as v
from .models import Store, StoreRevision, StoreMedia, StoreEvent, FeaturedStore


def persist(record, **kwargs):
    record._store_transition = True
    try:
        record.save(**kwargs)
    finally:
        record._store_transition = False
    return record


def locked_store(profile):
    store = Store.objects.select_for_update().filter(profile=profile).first()
    return store or persist(Store(profile=profile))


def bump(actor, store, action, revision=None, reason=""):
    store.version += 1
    persist(store)
    persist(StoreEvent(store=store, revision=revision, actor=actor.user, account=actor.account, context=actor.context, action=action, version=store.version, reason=reason))


def business_case(profile):
    return get_object_or_404(ReviewCase, profile=profile, revision=profile.revision, status="approved")


def media_references(store, body, *, check_bytes=True):
    ids = {body[key] for key in ("logo", "banner") if body.get(key)}
    media = list(StoreMedia.objects.filter(store=store, pk__in=ids))
    if {str(item.pk) for item in media} != ids:
        fail("body", "store_media_scope")
    if check_bytes:
        for item in media:
            try:
                if not storages[item.storage_alias].exists(item.key):
                    fail("body", "media_missing")
            except OSError:
                raise StorageUnavailable() from None
    return media


@transaction.atomic
def save(actor, profile_id, data):
    profile = access.seller(actor, profile_id, write=True, lock=True)
    store = locked_store(profile)
    assert_version(store, v.version(data.get("version")))
    if store.revisions.filter(state="submitted").exists():
        raise Conflict()
    body = v.body(data.get("body"))
    media_references(store, body)
    latest = store.revisions.order_by("-number").first()
    revision = persist(StoreRevision(store=store, number=(latest.number + 1 if latest else 1), business_case=business_case(profile), body=body, author=actor.user))
    bump(actor, store, "draft_saved", revision)
    return store


@transaction.atomic
def seller_action(actor, profile_id, data):
    profile = access.seller(actor, profile_id, write=True, lock=True)
    store = locked_store(profile)
    assert_version(store, v.version(data.get("version")))
    revision = get_object_or_404(store.revisions.select_for_update(), pk=v.identifier(data.get("revision"), "revision"))
    if data.get("action") == "submit":
        if revision.state != "draft" or store.revisions.order_by("-number").first().pk != revision.pk or store.revisions.filter(state="submitted").exists():
            raise Conflict()
        if revision.business_case_id != business_case(profile).pk:
            raise Conflict()
        media_references(store, revision.body)
        revision.state = "submitted"
    elif data.get("action") == "withdraw" and revision.state == "submitted":
        revision.state = "withdrawn"
    else:
        fail("action", "transition")
    persist(revision)
    bump(actor, store, "seller_" + data["action"], revision)
    return store


def reviewers(profile):
    return Account.objects.filter(context="staff", status="active", user__is_active=True, user__is_staff=True, user__email_verified=True,
        user__groups__permissions__content_type__app_label="marketplace", user__groups__permissions__codename="review_store"
    ).filter(user__groups__permissions__content_type__app_label="marketplace", user__groups__permissions__codename="read_store_submission").exclude(user_id=profile.account.user_id).exclude(user_id__in=profile.memberships.values("account__user_id")).distinct()


@transaction.atomic
def review(actor, revision_id, data):
    reference = get_object_or_404(StoreRevision.objects.select_related("store"), pk=revision_id)
    profile = BusinessProfile.objects.select_for_update().get(pk=reference.store_id)
    store = Store.objects.select_for_update().get(pk=profile.pk)
    revision = StoreRevision.objects.select_for_update().select_related("store__profile__account").get(pk=revision_id)
    assert_version(store, v.version(data.get("version")))
    action = data.get("action")
    reason = v.plain(data.get("reason", ""), "reason", 1000)
    if action == "assign":
        access.staff(actor, "assign_store_review", revision)
        if revision.state != "submitted":
            raise Conflict()
        revision.assigned_to = get_object_or_404(reviewers(profile), pk=v.identifier(data.get("assigned_to"), "assigned_to"))
    elif action in {"approve", "reject"}:
        access.staff(actor, "review_store", revision, assigned=True)
        access.staff(actor, "read_store_submission", revision, assigned=True)
        if revision.state != "submitted":
            raise Conflict()
        if action == "approve":
            if not access.eligible_profiles().filter(pk=profile.pk).exists() or revision.business_case_id != business_case(profile).pk:
                raise Conflict()
            media_references(store, revision.body)
            store.published = revision
            revision.state = "approved"
        else:
            if not reason:
                fail("reason", "required")
            revision.state = "rejected"
        revision.reason = reason
    elif action == "withdraw_content":
        access.staff(actor, "moderate_store", revision)
        if not reason:
            fail("reason", "required")
        if store.published_id != revision.pk:
            raise Conflict()
        store.published = None
        revision.state = "withdrawn"
        revision.reason = reason
    else:
        fail("action", "choice")
    persist(revision)
    bump(actor, store, action, revision, reason)
    return store


def upload(actor, profile_id, version, file):
    backend = None
    created_key = None
    try:
        with transaction.atomic():
            profile = access.seller(actor, profile_id, write=True, lock=True)
            store = locked_store(profile)
            assert_version(store, v.version(version))
            if store.media.count() >= 100:
                fail("file", "image_count")
            data, width, height = decode(file)
            backend = storages["marketplace_local"]
            created_key = backend.save(f"{profile.pk}/{uuid.uuid4().hex}.jpg", ContentFile(data))
            item = persist(StoreMedia(store=store, storage_alias="marketplace_local", key=created_key, content_type="image/jpeg", width=width, height=height, size=len(data)))
            bump(actor, store, "media_uploaded")
            return item, store
    except Exception as exc:
        if created_key and backend:
            try:
                backend.delete(created_key)
            except OSError:
                pass
        if isinstance(exc, APIException):
            raise
        raise StorageUnavailable() from None


@transaction.atomic
def feature(actor, profile_id, version, reason):
    if actor.context != "owner":
        raise PermissionDenied()
    actor.account
    # A fixed advisory lock serializes initially absent singleton creation too.
    durable_lock(83008001)
    current = FeaturedStore.objects.select_for_update().first() or FeaturedStore()
    assert_version(current, v.version(version))
    reason = v.plain(reason, "reason", 1000)
    if not reason:
        fail("reason", "required")
    profile = get_object_or_404(access.eligible_profiles(), pk=v.identifier(profile_id, "profile")) if profile_id else None
    current.profile = profile
    current.version += 1
    persist(current)
    AuditEvent.objects.create(actor=actor.user, context="owner", action="marketplace_feature_configured", reason=reason,
        resource_type="marketplace.feature", resource_id=profile.pk if profile else None, state={"version": current.version}, request_id=getattr(actor.request, "request_id", None))
    return current
