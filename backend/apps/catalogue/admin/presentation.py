"""Compact, shared catalogue identities; presentation never changes seller data."""

from django.contrib import admin
from django.db.models import OuterRef, Subquery
from django.template.defaultfilters import truncatechars
from django.urls import reverse
from django.utils.html import format_html
from django.utils.translation import gettext_lazy as _

from apps.accounts.admin.theme import CATALOGUE_THEME as T
from ..models import ProductImage, SourceRevision
from ..queries import working_revisions


def identity(name, secondary, image=None, glyph="inventory_2", icon="", owner=""):
    picture = format_html('<img src="{}" alt="" width="40" height="40" class="{}" loading="lazy">', image, T["image"]) if image else format_html(
        '<span class="material-symbols-outlined" aria-hidden="true">{}</span>', glyph,
    )
    return format_html(
        '<div class="{}">{}{}<div class="{}"><bdi class="{}" title="{}">{}</bdi>'
        '<bdi class="{}" title="{}">{}</bdi>{}</div></div>',
        T["identity"], picture, icon, T["text"], T["name"], name, truncatechars(name, 36),
        T["meta"], secondary, truncatechars(secondary, 42),
        format_html('<bdi class="{}" title="{}">{}</bdi>', T["meta"], owner, truncatechars(owner, 36)) if owner else "",
    )


def seller_cell(seller):
    user = seller.account.user
    image = reverse("site_media", args=[user.avatar_id]) if user.avatar_id else None
    return identity(seller.display_name, user.email, image, "person", owner=user.display_name)


def product_cell(obj, secondary=""):
    image = reverse("admin:catalogue_private_image", args=[obj.admin_cover]) if obj.admin_cover else None
    return identity(obj.admin_title or _("Untitled product"), secondary, image)


class ProductIdentityMixin:
    """Annotate once per listing, avoiding a query per thumbnail or seller."""

    product_path = "product"

    def get_queryset(self, request):
        path = self.product_path
        key = f"{path}__pk" if path else "pk"
        prefix = f"{path}__" if path else ""
        return super().get_queryset(request).select_related(prefix + "seller__account__user").annotate(
            admin_title=Subquery(working_revisions(SourceRevision.objects.filter(product_id=OuterRef(key))).order_by("-number").values("body__title")[:1]),
            admin_cover=Subquery(ProductImage.objects.filter(product_id=OuterRef(key)).order_by("created_at", "pk").values("pk")[:1]),
        )

    def related_product(self, obj):
        value = obj
        for part in self.product_path.split("__") if self.product_path else ():
            value = getattr(value, part)
        return value

    @admin.display(description=_("Product"))
    def product_identity(self, obj):
        variant = getattr(obj, "variant", None)
        return product_cell(obj, getattr(obj, "sku", "") or (variant.sku if variant else ""))

    @admin.display(description=_("Seller"))
    def seller_identity(self, obj):
        return seller_cell(self.related_product(obj).seller)
