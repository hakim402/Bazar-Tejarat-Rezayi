"""Profile photo and delivery address book, guarded by the same context grant as the profile."""
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from rest_framework.exceptions import NotFound, ValidationError

from . import audit, get_grant, rate_limit
from ..models import Address, User

ADDRESS_FIELDS = ("label", "recipient_name", "phone", "province", "city", "area", "street_address", "landmark", "is_default")


def _locked_user(request, context):
    user = User.objects.select_for_update().get(pk=request.user.pk)
    request.user = user
    get_grant(request, context)
    return user


def set_avatar(request, context, upload):
    from apps.site.media import discard_created, schedule_media_cleanup, store_upload

    account = get_grant(request, context)
    rate_limit(request, "avatar_upload", identity=str(request.user.pk), limit=10)
    created = []
    try:
        with transaction.atomic():
            user = _locked_user(request, context)
            previous = user.avatar_id
            try:
                asset = store_upload(upload, "image", created)
            except DjangoValidationError as exc:
                raise ValidationError({"file": exc.messages}) from None
            user.avatar = asset
            user.save(update_fields=["avatar"])
            if previous:
                schedule_media_cleanup([previous])
            audit("profile_avatar_updated", request=request, user=user, account=account, context=context, fields=["avatar"])
    except Exception:
        discard_created(created)
        raise
    return user


def clear_avatar(request, context):
    from apps.site.media import schedule_media_cleanup

    account = get_grant(request, context)
    with transaction.atomic():
        user = _locked_user(request, context)
        previous = user.avatar_id
        if previous:
            user.avatar = None
            user.save(update_fields=["avatar"])
            schedule_media_cleanup([previous])
            audit("profile_avatar_removed", request=request, user=user, account=account, context=context, fields=["avatar"])
    return user


def list_addresses(request, context):
    get_grant(request, context)
    return list(Address.objects.filter(user=request.user))


def _clear_other_defaults(user, keep_pk=None):
    query = Address.objects.filter(user=user, is_default=True)
    if keep_pk is not None:
        query = query.exclude(pk=keep_pk)
    query.update(is_default=False)


def create_address(request, context, data):
    account = get_grant(request, context)
    if not (data.get("recipient_name") or "").strip() or not (data.get("street_address") or "").strip():
        raise ValidationError({"recipient_name": ["Recipient name and street address are required."]})
    with transaction.atomic():
        user = _locked_user(request, context)
        address = Address(user=user, **{key: data[key] for key in ADDRESS_FIELDS if key in data})
        if address.is_default:
            _clear_other_defaults(user)
        address.save()
        audit("address_created", request=request, user=user, account=account, context=context, fields=["addresses"])
    return address


def _owned_address(user, pk):
    address = Address.objects.select_for_update().filter(pk=pk, user=user).first()
    if not address:
        raise NotFound()
    return address


def update_address(request, context, pk, data):
    account = get_grant(request, context)
    with transaction.atomic():
        user = _locked_user(request, context)
        address = _owned_address(user, pk)
        for key in ADDRESS_FIELDS:
            if key in data:
                setattr(address, key, data[key])
        if address.is_default:
            _clear_other_defaults(user, keep_pk=address.pk)
        address.save()
        audit("address_updated", request=request, user=user, account=account, context=context, fields=["addresses"])
    return address


def delete_address(request, context, pk):
    account = get_grant(request, context)
    with transaction.atomic():
        user = _locked_user(request, context)
        address = _owned_address(user, pk)
        address.delete()
        audit("address_deleted", request=request, user=user, account=account, context=context, fields=["addresses"])