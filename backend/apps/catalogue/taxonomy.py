from apps.runtime.locks import lock as durable_lock
from django.db import transaction
from django.db.models import Q
from django.db.models.deletion import ProtectedError
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import PermissionDenied
from . import access
from .models import Category, SaleUnit
from .validation import labels, schema, fail
from apps.organizations.access import assert_version


def lock_taxonomy():
    # Also serializes the empty-table/new-identity case, where row locks cannot help.
    durable_lock(720062106)


@transaction.atomic
def delete_taxonomy(actor, model, code, version):
    access.staff(actor, "manage_taxonomy")
    if actor.context != "owner":
        raise PermissionDenied()
    lock_taxonomy()
    item = get_object_or_404(model.objects.select_for_update(), pk=code)
    assert_version(item, version)
    if model is SaleUnit and Category.objects.filter(units=item).exists():
        fail("record", "protected_history")
    cover = item.image_id if model is Category else None
    try:
        item.delete()
    except ProtectedError:
        fail("record", "protected_history")
    access.audit(actor, None, f"{model._meta.model_name}_deleted", reason=code, version=version)
    if cover:
        from apps.site.media import schedule_media_cleanup

        schedule_media_cleanup([cover])


@transaction.atomic
def save_category(actor, data):
    access.staff(actor, "manage_taxonomy")
    lock_taxonomy()
    # Serialize hierarchy edits, including cycles created by competing administrators.
    list(Category.objects.select_for_update().order_by("code"))
    category = Category.objects.filter(pk=data["code"]).first()
    if category:
        assert_version(category, data["version"])
    elif data["version"] != 0:
        fail("version", "invalid")
    parent = get_object_or_404(Category, pk=data["parent"]) if data["parent"] else None
    cursor, depth = parent, 1
    while cursor:
        if cursor.pk == data["code"] or depth >= 4:
            fail("parent", "cycle")
        cursor, depth = cursor.parent, depth + 1

    # Preserve bounded depth also for existing descendants.
    def subtree_depth(code, visited):
        if code in visited:
            fail("parent", "cycle")
        children = list(Category.objects.filter(parent_id=code).values_list("code", flat=True))
        return 1 + max([subtree_depth(c, visited | {code}) for c in children], default=0)

    if depth + subtree_depth(data["code"], set()) - 1 > 4:
        fail("parent", "cycle")
    assigned_units = category.units.values("pk") if category else SaleUnit.objects.none().values("pk")
    units = SaleUnit.objects.filter(code__in=data["units"]).filter(Q(active=True) | Q(pk__in=assigned_units))
    if len(set(data["units"])) != units.count():
        fail("units", "choice")
    # Resolve the optional cover against the shared site media library (images only).
    image = None
    if data.get("image"):
        from apps.site.models import SiteMedia

        image = SiteMedia.objects.filter(pk=data["image"], kind="image").first()
        if image is None:
            fail("image", "choice")
    values = {
        "labels": labels(data["labels"]),
        "attributes": schema(data["attributes"]),
        "parent": parent,
        "active": data["active"],
        "icon": data.get("icon", ""),
        "image": image,
    }
    if category:
        for k, v in values.items():
            setattr(category, k, v)
        category.version += 1
        category.save()
    else:
        category = Category.objects.create(code=data["code"], **values)
    category.units.set(units)
    access.audit(actor, None, "taxonomy_change", reason=category.code, version=category.version)
    return {"code": category.code, "version": category.version}


def taxonomy():
    return {
        "categories": [
            {
                "code": c.code,
                "labels": c.labels,
                "attributes": c.attributes,
                "units": list(c.units.values_list("code", flat=True)),
                "active": c.active,
                "parent": c.parent_id,
                "version": c.version,
                "icon": c.icon,
                "image": f"/api/v1/site/media/{c.image_id}/" if c.image_id else None,
            }
            for c in Category.objects.prefetch_related("units").order_by("code")
        ],
        "units": [
            {"code": u.code, "labels": u.labels, "fractional": u.fractional, "version": u.version, "active": u.active}
            for u in SaleUnit.objects.order_by("code")
        ],
    }


@transaction.atomic
def save_unit(actor, data):
    access.staff(actor, "manage_taxonomy")
    lock_taxonomy()
    unit = SaleUnit.objects.select_for_update().filter(pk=data["code"]).first()
    if unit:
        assert_version(unit, data["version"])
    elif data["version"] != 0:
        fail("version", "invalid")
    if unit and unit.fractional != data["fractional"]:
        # Precision is part of existing variant semantics; define a new unit instead.
        fail("fractional", "immutable_variant")
    value = labels(data["labels"])
    if unit:
        unit.labels, unit.active = value, data["active"]
        unit.version += 1
        unit.save(update_fields=["labels", "active", "version"])
    else:
        SaleUnit.objects.create(**{**data, "version": 1, "labels": value})
    access.audit(actor, None, "unit_change", reason=data["code"], version=unit.version if unit else 1)
