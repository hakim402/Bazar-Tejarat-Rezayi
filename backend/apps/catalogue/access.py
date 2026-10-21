"""Current catalogue authority; deliberately separate from verification staff permissions."""

from django.shortcuts import get_object_or_404
from django.db.models import Q
from rest_framework.exceptions import PermissionDenied
from apps.organizations.access import Actor, independent
from apps.organizations.eligibility import require_seller_approval
from apps.organizations.models import BusinessProfile
from apps.organizations.profiles import effective_entitlement
from .models import Product, PERMISSIONS, CatalogueEvent


def permissions(actor):
    account = actor.account
    if actor.context == "owner":
        return list(PERMISSIONS)
    if actor.context != "staff":
        return []
    return list(
        account.permission_groups.filter(permissions__content_type__app_label="catalogue")
        .values_list("permissions__codename", flat=True)
        .distinct()
    )


def staff(actor, permission=None, product=None):
    codes = permissions(actor)
    if not codes or permission and permission not in codes:
        raise PermissionDenied()
    if product is not None:
        independent(product.seller, actor)


def seller(actor, profile):
    if not BusinessProfile.objects.filter(pk=profile, kind__in=["individual", "company"]).exists():
        raise PermissionDenied()
    return require_seller_approval(actor, profile, bundle="catalogue")


def visible(actor):
    account = actor.account
    if actor.context == "seller":
        return Product.objects.filter(
            Q(seller__account=account, seller__kind="individual")
            | Q(
                seller__kind="company",
                seller__memberships__account=account,
                seller__memberships__active=True,
                seller__memberships__bundles__contains=["catalogue"],
            )
        ).distinct()
    staff(actor)
    if not set(permissions(actor)) & {"review_source", "review_translation", "moderate_catalogue"}:
        return Product.objects.none()
    return Product.objects.all()


def resource(actor, pk, lock=False, capability=None):
    base = visible(actor)
    # DISTINCT is not lockable; visibility is authorized first, then lock the identity.
    get_object_or_404(base, pk=pk)
    item = get_object_or_404(Product.objects.select_for_update() if lock else Product.objects.all(), pk=pk)
    if actor.context == "seller":
        seller(actor, item.seller_id)
    else:
        staff(actor, capability, item if capability else None)
    return item


def public_eligible(item):
    return item.published_id is not None and effective_entitlement(item.seller, item.seller.account)


def audit(actor, item, action, revision=None, reason="", translation=None, version=None):
    CatalogueEvent.objects.create(
        product=item,
        actor=actor.user,
        account=actor.account,
        context=actor.context,
        action=action,
        revision=revision,
        version=version if version is not None else item.version if item else 0,
        translation=translation,
        translation_version=translation.version if translation else 0,
        reason=reason,
    )


def actor_for(request, context):
    actor = Actor(request, context)
    actor.account
    if context not in {"seller", "staff", "owner"}:
        raise PermissionDenied()
    return actor
