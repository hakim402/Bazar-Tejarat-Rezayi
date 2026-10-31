from django.db import OperationalError
from django.http import FileResponse
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema, OpenApiTypes
from rest_framework.exceptions import APIException
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.response import Response
from apps.accounts.services import rate_limit
from apps.accounts.views import AuthView
from apps.catalogue.media import StorageUnavailable
from apps.catalogue.validation import fail
from apps.foundation.observability import log_failure
from apps.foundation.storage import FileLocation
from apps.foundation.views import PublicView
from apps.organizations.access import Actor
from . import access, contracts as c, queries, services, validation as v
from .models import StoreMedia


def no_parameters(request):
    if request.query_params:
        fail("query", "unsupported")


def media_response(item):
    try:
        response = FileResponse(FileLocation(item.storage_alias, item.key).open(), content_type=item.content_type)
    except OSError:
        raise StorageUnavailable() from None
    response["Cache-Control"] = "private, no-store"
    response["X-Content-Type-Options"] = "nosniff"
    response["Content-Disposition"] = 'inline; filename="store-image.jpg"'
    return response


class MarketplacePublic(PublicView):
    def handle_exception(self, exc):
        if isinstance(exc, (OperationalError, OSError)):
            log_failure(self.request, exc, operation="marketplace_dependency", dependency="database_or_storage")
            error = APIException("Marketplace temporarily unavailable.")
            error.status_code = 503
            return super().handle_exception(error)
        return super().handle_exception(exc)


class Home(MarketplacePublic):
    @extend_schema(operation_id="marketplace_home", responses=c.MarketplaceHome, auth=[])
    def get(self, request, locale):
        no_parameters(request)
        return Response(c.MarketplaceHome(queries.PublicGate(locale).home()).data)


class Categories(MarketplacePublic):
    @extend_schema(operation_id="marketplace_categories", responses=c.MarketplaceCategories, auth=[])
    def get(self, request, locale):
        filters = v.query(request.query_params, page_only=True)
        return Response(c.MarketplaceCategories(queries.PublicGate(locale).categories(filters["page"])).data)


class Category(MarketplacePublic):
    @extend_schema(operation_id="marketplace_category_products", responses=c.MarketplaceProducts, auth=[])
    def get(self, request, locale, code):
        gate = queries.PublicGate(locale)
        result = gate.products_page(v.query(request.query_params, category=code))
        result["category"] = gate.category(code)
        return Response(c.MarketplaceProducts(result).data)


class Products(MarketplacePublic):
    @extend_schema(operation_id="marketplace_products", responses=c.MarketplaceProducts, auth=[])
    def get(self, request, locale):
        return Response(c.MarketplaceProducts(queries.PublicGate(locale).products_page(v.query(request.query_params))).data)


class Product(MarketplacePublic):
    @extend_schema(operation_id="marketplace_product", responses=c.MarketplaceProduct, auth=[])
    def get(self, request, locale, pk):
        no_parameters(request)
        return Response(c.MarketplaceProduct(queries.PublicGate(locale).product(pk)).data)


class Stores(MarketplacePublic):
    @extend_schema(operation_id="marketplace_stores", responses=c.MarketplaceStores, auth=[])
    def get(self, request, locale):
        return Response(c.MarketplaceStores(queries.PublicGate(locale).stores_page(v.query(request.query_params, scope="stores"))).data)


class Store(MarketplacePublic):
    @extend_schema(operation_id="marketplace_store", responses=c.MarketplaceStore, auth=[])
    def get(self, request, locale, pk):
        no_parameters(request)
        return Response(c.MarketplaceStore(queries.PublicGate(locale).store(pk)).data)


class StoreProducts(MarketplacePublic):
    @extend_schema(operation_id="marketplace_store_products", responses=c.MarketplaceProducts, auth=[])
    def get(self, request, locale, pk):
        return Response(c.MarketplaceProducts(queries.PublicGate(locale).products_page(v.query(request.query_params), seller_id=pk)).data)


class PublicMedia(MarketplacePublic):
    @extend_schema(operation_id="marketplace_public_store_media", responses=OpenApiTypes.BINARY, auth=[])
    def get(self, request, pk):
        no_parameters(request)
        return media_response(queries.public_media(pk))


class Sitemap(MarketplacePublic):
    @extend_schema(operation_id="marketplace_sitemap", responses=c.MarketplaceSitemap, auth=[])
    def get(self, request, locale):
        return Response(c.MarketplaceSitemap(queries.PublicGate(locale).sitemap(v.query(request.query_params, page_only=True)["page"])).data)


class SellerProfiles(AuthView):
    @extend_schema(operation_id="marketplace_seller_stores", responses=c.StoreProfiles)
    def get(self, request):
        no_parameters(request)
        return Response(c.StoreProfiles({"results": queries.seller_profiles(Actor(request, "seller"))}).data)


class SellerStore(AuthView):
    @extend_schema(operation_id="marketplace_seller_store", responses=c.StorePrivate)
    def get(self, request, pk):
        no_parameters(request)
        return Response(c.StorePrivate(queries.private_store(Actor(request, "seller"), pk)).data)

    @extend_schema(operation_id="marketplace_store_save", request=c.StoreSave, responses=c.StorePrivate)
    def post(self, request, pk):
        no_parameters(request)
        rate_limit(request, "store_write", limit=30)
        actor = Actor(request, "seller")
        services.save(actor, pk, self.data(c.StoreSave))
        return Response(c.StorePrivate(queries.private_store(actor, pk)).data)


class SellerAction(AuthView):
    @extend_schema(operation_id="marketplace_store_action", request=c.StoreAction, responses=c.StorePrivate)
    def post(self, request, pk):
        no_parameters(request)
        rate_limit(request, "store_write", limit=30)
        actor = Actor(request, "seller")
        services.seller_action(actor, pk, self.data(c.StoreAction))
        return Response(c.StorePrivate(queries.private_store(actor, pk)).data)


class SellerUpload(AuthView):
    parser_classes = [MultiPartParser, FormParser]

    @extend_schema(operation_id="marketplace_store_upload", request=c.StoreUpload, responses=c.StoreUploadResult)
    def post(self, request, pk):
        no_parameters(request)
        rate_limit(request, "store_upload", limit=20)
        data = self.data(c.StoreUpload)
        item, store = services.upload(Actor(request, "seller"), pk, data["version"], data["file"])
        return Response(c.StoreUploadResult({"id": item.pk, "url": queries.image_url(item.pk, private=True), "width": item.width, "height": item.height, "version": store.version}).data, status=201)


class SellerMedia(AuthView):
    @extend_schema(operation_id="marketplace_seller_store_media", responses=OpenApiTypes.BINARY)
    def get(self, request, pk):
        no_parameters(request)
        item = get_object_or_404(StoreMedia, pk=pk)
        access.seller(Actor(request, "seller"), item.store_id)
        return media_response(item)
