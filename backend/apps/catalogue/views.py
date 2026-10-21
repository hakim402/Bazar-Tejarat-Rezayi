from django.http import FileResponse
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.response import Response
from apps.content.views import PublicView
from apps.accounts.services import rate_limit
from apps.organizations.views import OrganizationView
from apps.organizations.access import visible_profiles
from apps.organizations.eligibility import require_seller_approval
from apps.foundation.storage import FileLocation
from apps.foundation.observability import log_failure
from . import access, contracts as c, queries, services, taxonomy, translations
from .models import ProductImage
from .media import upload, StorageUnavailable
from .validation import fail


class CatalogueView(OrganizationView):
    def actor(self, context):
        return access.actor_for(self.request, context)


class Products(CatalogueView):
    @extend_schema(operation_id="catalogue_list", responses=c.CatalogueList)
    def get(self, request, context):
        actor = self.actor(context)
        base = access.visible(actor).select_related("seller")
        try:
            page = int(request.query_params.get("page", "1"))
            if not 1 <= page <= 10000:
                raise ValueError
        except ValueError:
            fail("page", "invalid")
        state = request.query_params.get("state", "")
        if state == "live":
            base = base.filter(published__isnull=False)
        elif state in {"draft", "submitted", "rejected", "withdrawn"}:
            base = base.filter(revisions__state=state).distinct()
        elif state:
            fail("state", "choice")
        sellers = []
        if context == "seller":
            for profile in visible_profiles(actor):
                try:
                    require_seller_approval(actor, profile.pk, bundle="catalogue")
                except Exception:
                    continue
                sellers.append({"id": profile.pk, "name": profile.display_name})
        rows = []
        for item in base.order_by("-created_at")[(page - 1) * 30 : page * 30]:
            if context == "seller":
                try:
                    access.seller(actor, item.seller_id)
                except Exception:
                    continue
            latest = item.revisions.order_by("-number").first()
            rows.append(
                {
                    "id": item.pk,
                    "seller": item.seller.display_name,
                    "title": latest.body["title"] if latest else "",
                    "state": latest.state if latest else "draft",
                    "version": item.version,
                    "published": item.published_id,
                }
            )
        return Response(
            {
                "results": rows,
                "sellers": sellers,
                "permissions": access.permissions(actor),
                "count": base.count(),
                "page": page,
            }
        )

    @extend_schema(operation_id="catalogue_create", request=c.CatalogueCreate, responses=c.CatalogueOperation)
    def post(self, request, context):
        actor = self.actor(context)
        rate_limit(request, "catalogue_create", identity=str(actor.account.pk), limit=60)
        return Response(services.create(actor, self.data(c.CatalogueCreate)), status=201)


class Detail(CatalogueView):
    @extend_schema(operation_id="catalogue_detail", responses=c.CatalogueDetail)
    def get(self, request, context, pk):
        return Response(queries.detail(self.actor(context), pk))

    @extend_schema(operation_id="catalogue_save", request=c.CatalogueSave, responses=c.CatalogueOperation)
    def post(self, request, context, pk):
        return Response(services.save(self.actor(context), pk, self.data(c.CatalogueSave)))


class Action(CatalogueView):
    @extend_schema(operation_id="catalogue_action", request=c.CatalogueAction, responses=c.CatalogueOperation)
    def post(self, request, context, pk):
        return Response(services.transition(self.actor(context), pk, self.data(c.CatalogueAction)))


class Prices(CatalogueView):
    @extend_schema(operation_id="catalogue_prices", request=c.CataloguePrices, responses=c.CatalogueOperation)
    def post(self, request, context, pk):
        return Response(services.change_prices(self.actor(context), pk, self.data(c.CataloguePrices)))


class Images(CatalogueView):
    parser_classes = [MultiPartParser, FormParser]

    @extend_schema(
        operation_id="catalogue_upload",
        responses=c.CatalogueImage,
        request={
            "multipart/form-data": {
                "type": "object",
                "properties": {"file": {"type": "string", "format": "binary"}, "version": {"type": "integer"}},
            }
        },
    )
    def post(self, request, context, pk):
        try:
            version = int(request.data.get("version", ""))
        except ValueError:
            fail("version", "invalid")
        if len(request.FILES) != 1:
            fail("file", "image_count")
        return Response(upload(self.actor(context), pk, version, request.FILES.get("file")), status=201)


class ImageBytes(CatalogueView):
    @extend_schema(operation_id="catalogue_private_image", responses={(200, "image/jpeg"): bytes})
    def get(self, request, context, pk):
        actor = self.actor(context)
        image = get_object_or_404(ProductImage.objects.filter(product__in=access.visible(actor)), pk=pk)
        access.resource(actor, image.product_id)
        return image_response(image, request)


def image_response(image, request=None):
    try:
        response = FileResponse(
            FileLocation(image.storage_alias, image.key).open(),
            content_type=image.content_type,
            filename=f"product-{image.pk}.jpg",
        )
    except Exception as exc:
        log_failure(request, exc, operation="catalogue_image", dependency="storage")
        raise StorageUnavailable() from None
    response["Cache-Control"] = "private, no-store"
    response["X-Content-Type-Options"] = "nosniff"
    response["Content-Security-Policy"] = "default-src 'none'"
    return response


class PublicImage(PublicView):
    @extend_schema(operation_id="catalogue_public_image", responses={(200, "image/jpeg"): bytes})
    def get(self, request, pk):
        return image_response(queries.public_image(pk), request)


class PublicProduct(PublicView):
    @extend_schema(operation_id="catalogue_published", responses=c.CataloguePublic)
    def get(self, request, locale, pk):
        return Response(queries.public(pk, locale))


class Taxonomy(CatalogueView):
    @extend_schema(operation_id="catalogue_taxonomy", responses=c.CatalogueTaxonomy)
    def get(self, request, context):
        actor = self.actor(context)
        if context != "seller":
            access.staff(actor)
        return Response(taxonomy.taxonomy())

    @extend_schema(
        operation_id="catalogue_taxonomy_save", request=c.CatalogueTaxonomyInput, responses=c.CatalogueTaxonomy
    )
    def post(self, request, context):
        taxonomy.save_category(self.actor(context), self.data(c.CatalogueTaxonomyInput))
        return Response(taxonomy.taxonomy())


class Translations(CatalogueView):
    @extend_schema(
        operation_id="catalogue_translation", request=c.CatalogueTranslationInput, responses=c.CatalogueOperation
    )
    def post(self, request, context, pk, revision_id, locale):
        actor = self.actor(context)
        rate_limit(request, "catalogue_translation", identity=str(actor.account.pk), limit=100)
        return Response(translations.edit(actor, pk, revision_id, locale, self.data(c.CatalogueTranslationInput)))


class Units(CatalogueView):
    @extend_schema(operation_id="catalogue_unit_save", request=c.CatalogueUnitInput, responses=c.CatalogueTaxonomy)
    def post(self, request, context):
        taxonomy.save_unit(self.actor(context), self.data(c.CatalogueUnitInput))
        return Response(taxonomy.taxonomy())
