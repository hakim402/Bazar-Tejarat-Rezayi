from drf_spectacular.utils import OpenApiTypes, extend_schema
from rest_framework.response import Response

from apps.messaging.views import query, throttle
from apps.orders.views import OrderView, ProtectedDocumentView

from . import contracts as c, exports, queries


def window(data):
    return queries.period(data.get("start"), data.get("end"))


class Profiles(OrderView):
    @extend_schema(operation_id="reports_seller_profiles", responses=c.ReportProfiles)
    def get(self, request):
        actor = self.actor("seller")
        query(request)
        rows = [
            {"id": profile.pk, "name": profile.display_name, "kind": profile.kind,
             "sections": queries.sections(actor.account, profile)}
            for profile in queries.report_profiles(actor.account)[:100]
        ]
        return Response(c.ReportProfiles({"results": rows}).data)


class SellerSummary(OrderView):
    @extend_schema(operation_id="reports_seller_summary", parameters=[c.SellerQuery], responses=c.SellerSummary)
    def get(self, request):
        actor = self.actor("seller")
        data = query(request, c.SellerQuery)
        return Response(c.SellerSummary(queries.seller_summary(actor.account, data["seller"], window(data))).data)


class BuyerSummary(OrderView):
    @extend_schema(operation_id="reports_buyer_summary", parameters=[c.PeriodQuery], responses=c.BuyerSummary)
    def get(self, request):
        actor = self.actor("buyer")
        data = query(request, c.PeriodQuery)
        return Response(c.BuyerSummary(queries.buyer_summary(actor.account, window(data))).data)


class SellerExport(ProtectedDocumentView):
    @extend_schema(operation_id="reports_seller_export", parameters=[c.ExportQuery], responses=OpenApiTypes.BINARY)
    def get(self, request):
        actor = self.actor("seller")
        data = query(request, c.ExportQuery)
        throttle(actor, "report_export", data["seller"], limit=30)
        profile, rights = queries.seller_scope(actor.account, data["seller"])
        return exports.seller_export(actor, profile, rights, data["kind"], window(data))
