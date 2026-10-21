"""Locked source publication and price changes never replay descriptive snapshot prices."""

import copy
import json
from django.db import transaction
from django.db.models import Max
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import PermissionDenied
from apps.organizations.access import Conflict, assert_version
from . import access
from .models import Product, Variant, SourceRevision, Category, ProductImage, PriceChange
from .validation import text, attribute_values, definition, prices, fail


def operation(item, revision=None):
    return {"id": item.pk, "version": item.version, "revision": revision.pk if revision else None}


def bump(item):
    item.version += 1
    item._allow_catalogue_transition = True
    try:
        item.save(update_fields=["version", "published"])
    finally:
        item._allow_catalogue_transition = False


@transaction.atomic
def create(actor, data):
    profile = access.seller(actor, data["seller"])
    item = Product.objects.create(seller=profile, currency=data["currency"], pricing_mode=data["pricing_mode"])
    access.audit(actor, item, "create")
    return operation(item)


@transaction.atomic
def save(actor, pk, data):
    item = access.resource(actor, pk, lock=True)
    if actor.context != "seller":
        raise PermissionDenied()
    assert_version(item, data["version"])
    body = copy.deepcopy(data["body"])
    category = get_object_or_404(Category, code=body["category"], active=True)
    body["title"] = text(body["title"], "body.title", 200)
    body["description"] = text(body["description"], "body.description", 6000)
    body["brand"] = text(body.get("brand", ""), "body.brand", 100, optional=True)
    body["attributes"] = attribute_values(body.get("attributes", {}), category.attributes, "body.attributes")
    body["category_labels"] = category.labels
    body["attribute_schema"] = category.attributes
    body["attribute_labels"] = {f["code"]: f["labels"] for f in category.attributes if f["code"] in body["attributes"]}
    seen, combinations, saved = set(), set(), []
    for i, row in enumerate(body["variants"]):
        path = f"body.variants.{i}"
        sku = row["sku"]
        if sku in seen:
            fail(path + ".sku", "duplicate")
        seen.add(sku)
        structure = definition(row, category, path)
        combination = json.dumps(structure["attributes"], sort_keys=True)
        if combination in combinations:
            fail(path + ".attributes", "duplicate")
        combinations.add(combination)
        variant = item.variants.filter(pk=row["id"]).first() if row.get("id") else None
        if row.get("id") and not variant:
            fail(path + ".id", "scope")
        if variant:
            if variant.sku != sku or variant.definition != structure:
                fail(path, "immutable_variant")
        else:
            if item.variants.filter(sku=sku).exists():
                fail(path + ".sku", "duplicate")
            variant = Variant.objects.create(
                product=item,
                sku=sku,
                definition=structure,
                unit_id=structure["unit"],
                quantity_increment=structure["increment"],
                minimum_wholesale=structure["minimum"],
                **prices(row, path),
            )
            PriceChange.objects.create(
                product=item,
                variant=variant,
                actor=actor.user,
                product_version=item.version + 1,
                retail=variant.retail,
                wholesale=variant.wholesale,
            )
        saved.append(
            {
                "id": str(variant.pk),
                "sku": sku,
                **structure,
                "active": row["active"],
                "unit_labels": category.units.get(code=structure["unit"]).labels,
                "attribute_labels": {
                    f["code"]: f["labels"] for f in category.attributes if f["code"] in structure["attributes"]
                },
            }
        )
    if not any(v["active"] for v in saved):
        fail("body.variants", "required")
    body["variants"] = saved
    image_ids = set()
    for i, image in enumerate(body["images"]):
        key = str(image["id"])
        if key in image_ids or not ProductImage.objects.filter(pk=key, product=item).exists():
            fail(f"body.images.{i}", "scope")
        image_ids.add(key)
        image["id"] = key
        image["alt"] = text(image["alt"], f"body.images.{i}.alt", 200)
        if image.get("variant") and str(image["variant"]) not in {v["id"] for v in saved}:
            fail(f"body.images.{i}.variant", "scope")
        image["variant"] = str(image["variant"]) if image.get("variant") else None
    revision = SourceRevision.objects.create(
        product=item,
        category=category,
        number=(item.revisions.aggregate(n=Max("number"))["n"] or 0) + 1,
        body=body,
        author=actor.user,
    )
    bump(item)
    access.audit(actor, item, "save", revision)
    return operation(item, revision)


def complete(item, revision):
    from apps.foundation.storage import FileLocation
    from .media import StorageUnavailable

    body = revision.body
    category = Category.objects.select_for_update().filter(code=body["category"], active=True).first()
    if not category:
        fail("body.category", "inactive")
    if category.attributes != body["attribute_schema"]:
        fail("body.category", "stale_taxonomy")
    if not body["images"]:
        fail("body.images", "required")
    for ref in body["images"]:
        image = ProductImage.objects.get(pk=ref["id"], product=item)
        try:
            with FileLocation(image.storage_alias, image.key).open() as stream:
                if not stream.read(1):
                    raise OSError
        except Exception:
            raise StorageUnavailable() from None
    for row in body["variants"]:
        if row["active"]:
            if not category.units.filter(code=row["unit"], active=True).exists():
                fail("body.variants", "category")
            variant = Variant.objects.get(pk=row["id"], product=item)
            prices(
                {
                    "retail": str(variant.retail) if variant.retail is not None else None,
                    "wholesale": str(variant.wholesale) if variant.wholesale is not None else None,
                }
            )


@transaction.atomic
def transition(actor, pk, data):
    action = data["action"]
    capability = {"publish": "review_source", "reject": "review_source", "unpublish": "moderate_catalogue"}.get(action)
    item = access.resource(actor, pk, lock=True, capability=capability)
    assert_version(item, data["version"])
    revision = get_object_or_404(item.revisions, pk=data["revision"])
    reason = text(data.get("reason", ""), "reason", 1000, optional=action in {"submit", "publish", "withdraw"})
    if action in {"submit", "withdraw"} and actor.context != "seller":
        raise PermissionDenied()
    if action in {"publish", "reject"} and actor.context == "seller":
        raise PermissionDenied()
    if action == "submit":
        if revision.state != "draft" or item.revisions.filter(state="submitted").exists():
            raise Conflict()
        complete(item, revision)
        revision.state = "submitted"
    elif action == "withdraw":
        if revision.state != "submitted":
            raise Conflict()
        revision.state = "withdrawn"
    elif action in {"publish", "reject"}:
        if revision.state != "submitted":
            raise Conflict()
        if action == "publish":
            if not access.public_eligible(Product(seller=item.seller, published=revision)):
                raise PermissionDenied()
            complete(item, revision)
            item.published = revision
            revision.state = "published"
        else:
            revision.state = "rejected"
    elif action == "unpublish":
        if item.published_id != revision.pk:
            raise Conflict()
        item.published = None
    revision.reason = reason
    revision._allow_catalogue_transition = True
    revision.save(update_fields=["state", "reason"])
    revision._allow_catalogue_transition = False
    bump(item)
    access.audit(actor, item, action, revision, reason)
    if action == "publish":
        from .translations import schedule_publication

        schedule_publication(item, revision)
    return operation(item, revision)


@transaction.atomic
def change_prices(actor, pk, data):
    item = access.resource(actor, pk, lock=True)
    if actor.context != "seller":
        raise PermissionDenied()
    assert_version(item, data["version"])
    seen = set()
    for index, row in enumerate(data["prices"]):
        path = f"prices.{index}"
        if row["id"] in seen:
            fail(path, "duplicate_price")
        seen.add(row["id"])
        variant = get_object_or_404(item.variants, pk=row["id"])
        values = prices(row, path)
        variant.retail, variant.wholesale = values["retail"], values["wholesale"]
        variant.save(update_fields=["retail", "wholesale"])
        PriceChange.objects.create(
            product=item, variant=variant, actor=actor.user, product_version=item.version + 1, **values
        )
    bump(item)
    access.audit(actor, item, "price_change")
    return operation(item)
