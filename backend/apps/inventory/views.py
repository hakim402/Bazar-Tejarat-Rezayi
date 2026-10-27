from drf_spectacular.utils import extend_schema, OpenApiParameter
from rest_framework.response import Response
from apps.organizations.views import OrganizationView
from apps.accounts.services import rate_limit
from . import contracts as c, queries, services
from .validation import identifier
from apps.catalogue.validation import fail


def seller_scope(request):
    if set(request.query_params) != {"seller"} or len(request.query_params.getlist("seller")) != 1:
        fail("seller")
    return identifier(request.query_params["seller"], "seller")


SCOPE = [OpenApiParameter("seller", str, required=True)]
PAGE = OpenApiParameter("page", int)
SEARCH = OpenApiParameter("q", str)
OVERVIEW_FILTERS = SCOPE + [
    PAGE,
    SEARCH,
    OpenApiParameter("state", str, enum=["unconfigured", "inactive", "zero", "low", "available", "expired", "held"]),
    OpenApiParameter("sort", str, enum=["sku", "-sku", "available", "-available"]),
]
HISTORY_FILTERS = SCOPE + [
    PAGE,
    SEARCH,
    OpenApiParameter("action", str, enum=["receive", "adjust", "reserve", "consume", "release", "cod"]),
    OpenApiParameter("variant", str),
    OpenApiParameter("batch", str),
]


class Profiles(OrganizationView):
    @extend_schema(operation_id="inventory_profiles", responses=c.Profiles)
    def get(self, request):
        return Response({"profiles": queries.profiles(self.actor("seller"))})


class Overview(OrganizationView):
    @extend_schema(
        operation_id="inventory_overview",
        responses=c.Overview,
        parameters=OVERVIEW_FILTERS,
    )
    def get(self, request):
        return Response(
            queries.overview(
                self.actor("seller"), identifier(request.query_params.get("seller"), "seller"), request.query_params
            )
        )


class Detail(OrganizationView):
    @extend_schema(
        operation_id="inventory_detail",
        responses=c.Position,
        parameters=SCOPE,
    )
    def get(self, request, pk):
        return Response(queries.detail(self.actor("seller"), seller_scope(request), pk))


class Configure(OrganizationView):
    @extend_schema(
        operation_id="inventory_configure",
        request=c.Configure,
        responses=c.Operation,
        parameters=SCOPE,
    )
    def post(self, request, pk):
        actor = self.actor("seller")
        rate_limit(request, "inventory_write", identity=str(actor.account.pk), limit=120)
        return Response(services.configure(actor, seller_scope(request), pk, self.data(c.Configure)))


class Receipt(OrganizationView):
    @extend_schema(
        operation_id="inventory_receive",
        request=c.Receipt,
        responses=c.Operation,
        parameters=SCOPE,
    )
    def post(self, request, pk):
        return self.write(request, pk, False)

    def write(self, request, pk, adjustment):
        actor = self.actor("seller")
        rate_limit(request, "inventory_write", identity=str(actor.account.pk), limit=120)
        data = self.data(c.Receipt)
        if data.get("expires_on"):
            data["expires_on"] = data["expires_on"].isoformat()
        return Response(services.manual(actor, seller_scope(request), pk, data, adjustment=adjustment))


class Adjustment(Receipt):
    @extend_schema(
        operation_id="inventory_adjust",
        request=c.Receipt,
        responses=c.Operation,
        parameters=SCOPE,
    )
    def post(self, request, pk):
        return self.write(request, pk, True)


class History(OrganizationView):
    @extend_schema(
        operation_id="inventory_movements",
        responses=c.History,
        parameters=HISTORY_FILTERS,
    )
    def get(self, request):
        return Response(
            queries.history(
                self.actor("seller"), identifier(request.query_params.get("seller"), "seller"), request.query_params
            )
        )
