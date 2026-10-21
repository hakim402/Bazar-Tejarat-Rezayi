import copy
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import NotFound
from . import access
from .models import Product, ProductImage, Translation
from .translation_provider import provider_status


def image_url(image_id, context=None):
    return f"/api/v1/catalogue/{context + '/' if context else ''}images/{image_id}/"


def detail(actor, pk):
    item = access.resource(actor, pk)
    revisions = list(item.revisions.order_by("-number")[:100])
    if item.published_id and not any(r.pk == item.published_id for r in revisions):
        revisions.append(item.published)
    return {
        "id": item.pk,
        "seller": item.seller_id,
        "seller_name": item.seller.display_name,
        "currency": item.currency,
        "pricing_mode": item.pricing_mode,
        "version": item.version,
        "published": item.published_id,
        "revisions": [
            {"id": r.pk, "number": r.number, "body": r.body, "state": r.state, "reason": r.reason} for r in revisions
        ],
        "images": [
            {"id": i.pk, "width": i.width, "height": i.height, "url": image_url(i.pk, actor.context)}
            for i in item.images.order_by("created_at")
        ],
        "prices": [
            {
                "id": v.pk,
                "sku": v.sku,
                "retail": str(v.retail) if v.retail is not None else None,
                "wholesale": str(v.wholesale) if v.wholesale is not None else None,
            }
            for v in item.variants.all()
        ],
        "price_history": [
            {
                "variant": p.variant_id,
                "retail": str(p.retail) if p.retail is not None else None,
                "wholesale": str(p.wholesale) if p.wholesale is not None else None,
                "version": p.product_version,
                "at": p.created_at.isoformat(),
            }
            for p in item.price_history.order_by("-created_at")[:200]
        ],
        "translations": [
            {
                "id": t.pk,
                "revision": t.revision_id,
                "locale": t.locale,
                "title": t.title,
                "description": t.description,
                "image_alts": t.image_alts,
                "version": t.version,
                "state": t.state,
                "human_edited": t.human_edited,
                "has_approved": bool(t.approved_body),
                "job": {"status": t.job.status, "attempts": t.job.attempts, "error_code": t.job.error_code}
                if hasattr(t, "job")
                else None,
            }
            for t in Translation.objects.filter(revision__product=item).select_related("job")
        ],
        "permissions": access.permissions(actor),
        "provider": provider_status(),
    }


def public(pk, locale):
    from .models import LOCALES

    if locale not in LOCALES:
        raise NotFound()
    item = get_object_or_404(Product.objects.select_related("published", "seller__account__user"), pk=pk)
    if not access.public_eligible(item):
        raise NotFound()
    revision = item.published
    body = copy.deepcopy(revision.body)
    translated = revision.translations.filter(locale=locale, approved_body__isnull=False).first()
    resolved = body["locale"]
    if translated:
        body.update({k: translated.approved_body[k] for k in ("title", "description")})
        for ref in body["images"]:
            ref["alt"] = translated.approved_body["image_alts"].get(ref["id"], ref["alt"])
        resolved = locale
    # Return deliberately narrow reviewed fields, no schema/internal paths/private profile.
    projection = {
        k: body[k]
        for k in ("title", "description", "brand", "category", "category_labels", "attributes", "attribute_labels")
    }
    prices = {str(v.pk): v for v in item.variants.all()}
    variants = []
    for row in body["variants"]:
        if row["active"]:
            variant = prices[row["id"]]
            variants.append(
                {
                    **row,
                    "retail": str(variant.retail) if variant.retail is not None else None,
                    "wholesale": str(variant.wholesale) if variant.wholesale is not None else None,
                }
            )
    return {
        "id": item.pk,
        "revision": revision.pk,
        "seller_name": item.seller.display_name,
        "currency": item.currency,
        "pricing_mode": item.pricing_mode,
        "requested_locale": locale,
        "resolved_locale": resolved,
        "source_fallback": resolved != locale,
        "body": projection,
        "variants": variants,
        "images": [{**row, "url": image_url(row["id"])} for row in body["images"]],
    }


def public_image(pk):
    image = get_object_or_404(
        ProductImage.objects.select_related("product__seller__account__user", "product__published"), pk=pk
    )
    item = image.product
    if not access.public_eligible(item) or not any(row["id"] == str(pk) for row in item.published.body["images"]):
        raise NotFound()
    return image
