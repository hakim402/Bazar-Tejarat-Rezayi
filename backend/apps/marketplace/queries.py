"""Narrow public projections. SQL filters/counts/paginates before bounded page hydration."""

import copy
from django.db.models import Case, CharField, Count, Exists, F, JSONField, OuterRef, Q, Subquery, Value, When
from django.db.models.fields.json import KeyTextTransform, KeyTransform
from django.db.models.functions import Coalesce, Lower
from apps.runtime.expressions import JsonPathText, Normalized, VariantReference, prepare_search
from django.shortcuts import get_object_or_404
from django.utils.functional import cached_property
from rest_framework.exceptions import NotFound, PermissionDenied
from apps.catalogue.models import Category, LOCALES, Product, ProductImage, Translation, Variant
from apps.inventory.models import Position, Bucket
from apps.inventory.services import today
from apps.organizations.access import manage_profile, visible_profiles
from apps.organizations.profiles import effective_entitlement
from apps.verification.models import ReviewCase
from . import access
from .models import Store, StoreRevision, StoreMedia, FeaturedStore

PAGE_SIZE = 20


def normalized(expression):
    return Normalized(expression)

def image_url(pk, *, private=False):
    return f"/api/v1/marketplace/{'seller' if private else 'public'}/store-media/{pk}/"


def identity_profiles(base, locale):
    name = ReviewCase.objects.filter(pk=OuterRef("approved_case")).annotate(public_name=KeyTextTransform("display_name", "snapshot"))
    revision = StoreRevision.objects.filter(store_id=OuterRef("pk"), pk=OuterRef("public_store__published_id"), business_case_id=OuterRef("approved_case"), state="approved")
    profiles = base.annotate(public_name=Coalesce(Subquery(name.values("public_name")[:1], output_field=CharField()), Value("")), optional_body=Subquery(revision.values("body")[:1], output_field=JSONField()))
    profiles = profiles.annotate(public_country=KeyTextTransform("country", "optional_body"), public_city=KeyTextTransform("city", "optional_body"), optional_source=KeyTextTransform("source_locale", "optional_body"))
    requested = KeyTransform(locale, KeyTransform("editions", "optional_body"))
    return profiles.annotate(public_description=Coalesce(KeyTextTransform("description", requested), JsonPathText(F("optional_body"), Value("editions"), F("optional_source"), Value("description")), Value(""), output_field=CharField()))


class PublicGate:
    def __init__(self, locale, *, profile_ids=None):
        if locale not in LOCALES:
            raise NotFound()
        self.locale = locale
        self.profile_ids = profile_ids

    @cached_property
    def profiles(self):
        # Resolve request scope before evidence I/O; cache only on this gate instance.
        return identity_profiles(access.eligible_profiles(self.profile_ids), self.locale)

    @cached_property
    def products(self):
        translated = Translation.objects.filter(revision_id=OuterRef("published_id"), locale=self.locale, approved_body__isnull=False)
        return Product.objects.filter(published__isnull=False, seller_id__in=Subquery(self.profiles.values("pk"))).annotate(
            public_title=Coalesce(Subquery(translated.annotate(text=KeyTextTransform("title", "approved_body")).values("text")[:1]), KeyTextTransform("title", "published__body")),
            public_description=Coalesce(Subquery(translated.annotate(text=KeyTextTransform("description", "approved_body")).values("text")[:1]), KeyTextTransform("description", "published__body")),
            public_resolved=Case(When(Exists(translated), then=Value(self.locale)), default=KeyTextTransform("locale", "published__body"), output_field=CharField()),
        )

    def variants(self):
        reference = VariantReference(F("pk"))
        available = Bucket.objects.filter(position_id=OuterRef("pk"), physical__gt=F("held")).filter(Q(batch__isnull=True) | Q(batch__expires_on__isnull=True) | Q(batch__expires_on__gte=today()))
        return Variant.objects.filter(product__published__body__variants__contains=reference).annotate(
            public_available=Exists(available), public_configured=Exists(Position.objects.filter(pk=OuterRef("pk"))))

    def filtered_products(self, filters, *, seller_id=None):
        if seller_id is not None and self.profile_ids is None:
            return PublicGate(self.locale, profile_ids=[seller_id]).filtered_products(filters, seller_id=seller_id)
        base = self.products
        if seller_id:
            get_object_or_404(self.profiles, pk=seller_id)
            base = base.filter(seller_id=seller_id)
        category = filters.get("category")
        if category:
            get_object_or_404(Category.objects.filter(Q(active=True) | Q(pk__in=self.products.values("published__category_id"))), pk=category)
            base = base.filter(published__category_id=category)
        if filters.get("q"):
            prepare_search(base.values_list("public_title", "public_description", "published__body__category_labels"))
            prepare_search(self.profiles.values_list("public_name", "public_description"))
            category_label = Coalesce(KeyTextTransform(self.locale, KeyTransform("category_labels", "published__body")), KeyTextTransform("fa-AF", KeyTransform("category_labels", "published__body")), output_field=CharField())
            base = base.alias(search_title=normalized(F("public_title")), search_description=normalized(F("public_description")), search_category=normalized(category_label)).filter(
                Q(search_title__icontains=filters["q"]) | Q(search_description__icontains=filters["q"]) | Q(search_category__icontains=filters["q"]) | Q(
                    seller_id__in=self.profiles.alias(search_name=normalized(F("public_name")), search_about=normalized(F("public_description"))).filter(Q(search_name__icontains=filters["q"]) | Q(search_about__icontains=filters["q"])).values("pk")))
        for key in ("currency", "pricing_mode"):
            if filters.get(key):
                base = base.filter(**{key: filters[key]})
        for key in ("country", "city"):
            if filters.get(key):
                base = base.filter(seller_id__in=self.profiles.filter(**{"public_" + key + "__iexact": filters[key]}).values("pk"))
        matching = self.variants().filter(product_id=OuterRef("pk"))
        tier = filters.get("tier")
        if tier:
            matching = matching.filter(**{tier + "__isnull": False})
            for key, lookup in (("min_price", "gte"), ("max_price", "lte")):
                if filters.get(key) is not None:
                    matching = matching.filter(**{tier + "__" + lookup: filters[key]})
        availability = filters.get("availability")
        if availability == "available":
            matching = matching.filter(public_available=True)
        elif availability == "unavailable":
            matching = matching.filter(public_configured=True, public_available=False)
        elif availability == "unknown":
            matching = matching.filter(public_configured=False)
        if tier or availability or filters.get("min_price") is not None or filters.get("max_price") is not None:
            base = base.filter(Exists(matching))
        sort = filters.get("sort", "newest")
        if sort.startswith("price_"):
            base = base.annotate(public_price=Subquery(matching.order_by(tier, "pk").values(tier)[:1]))
            return base.order_by("-public_price" if sort == "price_desc" else "public_price", "pk")
        return base.order_by(Lower("public_title"), "pk") if sort == "name" else base.order_by("-created_at", "pk")

    def store_rows(self, profiles):
        profiles = list(profiles)
        media_ids = {body[key] for profile in profiles if (body := profile.optional_body) for key in ("logo", "banner") if body.get(key)}
        media = {str(item.pk): item for item in StoreMedia.objects.filter(pk__in=media_ids)}
        counts = dict(self.products.filter(seller_id__in=[p.pk for p in profiles]).order_by().values("seller_id").annotate(total=Count("pk")).values_list("seller_id", "total"))
        featured = FeaturedStore.objects.values_list("profile_id", flat=True).first()
        result = []
        for profile in profiles:
            body = profile.optional_body
            source = body["source_locale"] if body else self.locale
            resolved = self.locale if body and self.locale in body["editions"] else source
            edition = body["editions"][resolved] if body else {}
            item = {"id": str(profile.pk), "name": profile.public_name, "kind": profile.kind,
                "country": profile.public_country or "", "city": profile.public_city or "", "description": profile.public_description,
                "requested_locale": self.locale, "resolved_locale": resolved, "source_fallback": resolved != self.locale,
                "product_count": counts.get(profile.pk, 0), "featured": featured == profile.pk, "logo": None, "banner": None}
            for role in ("logo", "banner"):
                ref = body.get(role) if body else None
                asset = media.get(ref)
                if asset:
                    item[role] = {"id": str(asset.pk), "url": image_url(asset.pk), "width": asset.width, "height": asset.height, "alt": edition.get(role + "_alt") or body["editions"][source].get(role + "_alt", "")}
            result.append(item)
        return result

    def product_rows(self, products):
        products = list(products)
        image_ids = {row["id"] for item in products for row in item.published.body["images"]}
        images = {str(image.pk): image for image in ProductImage.objects.filter(pk__in=image_ids, product_id__in=[item.pk for item in products])}
        profiles = {row["id"]: row for row in self.store_rows(self.profiles.filter(pk__in={item.seller_id for item in products}))}
        prices = {str(v.pk): v for v in Variant.objects.filter(product_id__in=[item.pk for item in products])}
        positions = set(Position.objects.filter(pk__in=[v.pk for v in prices.values()]).values_list("pk", flat=True))
        available = set(Bucket.objects.filter(position_id__in=positions, physical__gt=F("held")).filter(
            Q(batch__isnull=True) | Q(batch__expires_on__isnull=True) | Q(batch__expires_on__gte=today())).values_list("position_id", flat=True))
        translations = {t.revision_id: t.approved_body for t in Translation.objects.filter(revision_id__in=[item.published_id for item in products], locale=self.locale, approved_body__isnull=False)}
        result = []
        for item in products:
            body = copy.deepcopy(item.published.body)
            translated = translations.get(item.published_id)
            if translated:
                body.update({key: translated[key] for key in ("title", "description")})
                for row in body["images"]:
                    row["alt"] = translated["image_alts"].get(row["id"], row["alt"])
            variants = []
            for row in body["variants"]:
                variant = prices.get(row["id"])
                if not row["active"] or not variant:
                    continue
                variants.append({**{key: row[key] for key in ("id", "sku", "attributes", "unit", "increment", "minimum", "contents", "active", "unit_labels", "attribute_labels")}, "retail": str(variant.retail) if variant.retail is not None else None,
                    "wholesale": str(variant.wholesale) if variant.wholesale is not None else None,
                    "availability": "unknown" if variant.pk not in positions else "available" if variant.pk in available else "unavailable"})
            result.append({"id": str(item.pk), "revision": str(item.published_id), "currency": item.currency, "pricing_mode": item.pricing_mode,
                "requested_locale": self.locale, "resolved_locale": item.public_resolved, "source_fallback": item.public_resolved != self.locale,
                "body": {key: body[key] for key in ("title", "description", "brand", "category", "category_labels", "attributes", "attribute_labels")},
                "variants": variants, "images": [{"id": row["id"], "alt": row["alt"], "variant": row.get("variant"), "width": images[row["id"]].width, "height": images[row["id"]].height, "url": f"/api/v1/catalogue/images/{row['id']}/"} for row in body["images"] if row["id"] in images],
                "store": profiles[str(item.seller_id)]})
        return result

    def products_page(self, filters, *, seller_id=None):
        gate = PublicGate(self.locale, profile_ids=[seller_id]) if seller_id is not None else self
        base = gate.filtered_products(filters, seller_id=seller_id)
        page = filters["page"]
        return {"results": gate.product_rows(base.select_related("published")[(page - 1) * PAGE_SIZE:page * PAGE_SIZE]),
            "count": base.count(), "page": page, "page_size": PAGE_SIZE,
            "facets": {"currencies": list(base.order_by().values_list("currency", flat=True).distinct()),
                "categories": list(base.order_by().values_list("published__category_id", flat=True).distinct())}}

    def product(self, pk):
        candidates = Product.objects.filter(pk=pk, published__isnull=False).values("seller_id")
        gate = PublicGate(self.locale, profile_ids=candidates)
        return gate.product_rows([get_object_or_404(gate.products.select_related("published"), pk=pk)])[0]

    def category(self, code):
        item = get_object_or_404(Category.objects.filter(Q(active=True) | Q(pk__in=self.products.values("published__category_id"))), pk=code)
        return {"code": item.pk, "name": item.labels.get(self.locale) or item.labels.get("fa-AF") or item.pk, "labels": item.labels, "count": self.products.filter(published__category_id=code).count()}

    def store(self, pk):
        gate = PublicGate(self.locale, profile_ids=[pk])
        return gate.store_rows([get_object_or_404(gate.profiles, pk=pk)])[0]

    def stores_page(self, filters):
        base = self.profiles
        if filters.get("q"):
            prepare_search(base.values_list("public_name", "public_description", "public_country", "public_city"))
            base = base.alias(search_name=normalized(F("public_name")), search_about=normalized(F("public_description")), search_country=normalized(F("public_country")), search_city=normalized(F("public_city"))).filter(Q(search_name__icontains=filters["q"]) | Q(search_about__icontains=filters["q"]) | Q(search_country__icontains=filters["q"]) | Q(search_city__icontains=filters["q"]))
        for key in ("country", "city"):
            if filters.get(key):
                base = base.filter(**{"public_" + key + "__iexact": filters[key]})
        base = base.order_by(Lower("public_name"), "pk") if filters.get("sort") == "name" else base.order_by("-created_at", "pk")
        page = filters["page"]
        return {"results": self.store_rows(base[(page - 1) * PAGE_SIZE:page * PAGE_SIZE]), "count": base.count(), "page": page, "page_size": PAGE_SIZE,
            "facets": {"locations": list(base.order_by().exclude(public_country__isnull=True).values("public_country", "public_city").distinct()[:100])}}

    def categories(self, page=1):
        counts = self.products.order_by().values("published__category_id").annotate(total=Count("pk"))
        directory = Category.objects.filter(Q(active=True) | Q(pk__in=counts.values("published__category_id"))).annotate(
            public_count=Coalesce(Subquery(counts.filter(published__category_id=OuterRef("pk")).values("total")[:1]), Value(0))).order_by("code")
        return {"results": [{"code": cat.pk, "name": cat.labels.get(self.locale) or cat.labels.get("fa-AF") or cat.pk,
            "labels": cat.labels, "count": cat.public_count} for cat in directory[(page - 1) * PAGE_SIZE:page * PAGE_SIZE]],
            "count": directory.count(), "page": page, "page_size": PAGE_SIZE, "facets": {}}

    def home(self):
        featured_id = FeaturedStore.objects.values_list("profile_id", flat=True).first()
        featured = self.store_rows(self.profiles.filter(pk=featured_id)[:1]) if featured_id else []
        return {"categories": self.categories()["results"][:12], "products": self.product_rows(self.products.order_by("-created_at", "pk").select_related("published")[:8]),
            "stores": self.store_rows(self.profiles.order_by("-created_at", "pk")[:6]), "featured_store": featured[0] if featured else None}

    def sitemap(self, page):
        products = self.products.order_by("pk")
        profiles = self.profiles.order_by("pk")
        categories = Category.objects.filter(Q(active=True) | Q(pk__in=products.values("published__category_id"))).order_by("pk")
        offset = (page - 1) * 500
        return {"products": [str(pk) for pk in products.values_list("pk", flat=True)[offset:offset + 500]],
            "categories": list(categories.values_list("pk", flat=True)[offset:offset + 500]),
            "stores": [str(pk) for pk in profiles.values_list("pk", flat=True)[offset:offset + 500]],
            "page": page, "page_size": 500, "pages": max(1, (max(products.count(), profiles.count(), categories.count()) + 499) // 500)}


def seller_profiles(actor):
    rows = []
    for profile in visible_profiles(actor):
        if profile.kind not in {"individual", "company"} or not effective_entitlement(profile, actor.account):
            continue
        try:
            manage_profile(profile, actor)
            editable = True
        except PermissionDenied:
            editable = False
        rows.append({"id": str(profile.pk), "name": profile.display_name, "kind": profile.kind, "can_edit": editable})
    return rows


def private_store(actor, pk):
    profile = access.seller(actor, pk)
    store = Store.objects.filter(pk=pk).first()
    try:
        manage_profile(profile, actor)
        editable = True
    except PermissionDenied:
        editable = False
    revisions = list(store.revisions.order_by("-number")[:30]) if store else []
    if store and store.published_id and not any(row.pk == store.published_id for row in revisions):
        revisions.append(store.published)
    return {"id": str(pk), "name": profile.display_name, "version": store.version if store else 0,
        "can_edit": editable, "published": str(store.published_id) if store and store.published_id else None,
        "revisions": [{"id": str(row.pk), "number": row.number, "body": row.body, "state": row.state, "reason": row.reason} for row in revisions],
        "media": [{"id": str(item.pk), "url": image_url(item.pk, private=True), "width": item.width, "height": item.height} for item in store.media.order_by("created_at")[:100]] if store else []}


def public_media(pk):
    item = get_object_or_404(StoreMedia.objects.select_related("store__published"), pk=pk)
    if not access.eligible_profiles([item.store_id]).exists():
        raise NotFound()
    revision = item.store.published
    if not revision or revision.business_case_id != ReviewCase.objects.get(profile_id=item.store_id, revision=revision.store.profile.revision).pk or str(item.pk) not in {revision.body.get("logo"), revision.body.get("banner")}:
        raise NotFound()
    return item
