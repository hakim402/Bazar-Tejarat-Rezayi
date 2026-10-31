from drf_spectacular.utils import extend_schema
from rest_framework.response import Response
from apps.messaging.views import PrivateView, query, throttle
from apps.messaging.contracts import ListQuery
from . import contracts as c, services


class Notices(PrivateView):
    @extend_schema(operation_id="notifications_list", parameters=[ListQuery], responses=c.NoticePage)
    def get(self, request, context):
        actor = self.actor(context)
        data = query(request, ListQuery)
        return Response(c.NoticePage(services.notices(actor, **data)).data)


class Counts(PrivateView):
    @extend_schema(operation_id="notifications_unread", parameters=[ListQuery], responses=c.Counts)
    def get(self, request, context):
        actor = self.actor(context)
        data = query(request, ListQuery)
        from rest_framework.exceptions import ValidationError

        if data["page"] != 1 or data["unread"]:
            raise ValidationError({"query": ["unknown"]})
        return Response(c.Counts(services.counts(actor, data.get("seller"))).data)


class Read(PrivateView):
    @extend_schema(operation_id="notifications_read", request=c.EmptyCommand, responses=c.NoticeRead)
    def post(self, request, context, pk):
        actor = self.actor(context)
        query(request)
        self.data(c.EmptyCommand)
        throttle(actor, "notice_read", pk, limit=300)
        return Response(c.NoticeRead(services.read_notice(actor, pk)).data)


class Preferences(PrivateView):
    @extend_schema(operation_id="notifications_preferences", responses=c.EmailPreference)
    def get(self, request, context):
        actor = self.actor(context)
        query(request)
        return Response(c.EmailPreference(services.preference(actor)).data)

    @extend_schema(
        operation_id="notifications_preferences_save", request=c.PreferenceCommand, responses=c.EmailPreference
    )
    def patch(self, request, context):
        actor = self.actor(context)
        query(request)
        throttle(actor, "preference", limit=30)
        return Response(c.EmailPreference(services.set_preference(actor, self.data(c.PreferenceCommand))).data)


class Profiles(PrivateView):
    @extend_schema(
        operation_id="notifications_profiles",
        parameters=[ListQuery],
        responses=__import__("apps.messaging.contracts", fromlist=["MessagingProfiles"]).MessagingProfiles,
    )
    def get(self, request):
        from apps.messaging import access as ma
        from apps.orders import access as oa
        from apps.organizations.models import BusinessProfile
        from django.db.models import Q

        actor = self.actor("seller")
        data = query(request, ListQuery)
        if data.get("seller") or data["unread"]:
            from rest_framework.exceptions import ValidationError

            raise ValidationError({"query": ["unknown"]})
        messaging_ids = ma.seller_profiles_for(actor.account).values("pk")
        invoice_ids = oa.profiles(actor.account, invoices=True).values("pk")
        rows = BusinessProfile.objects.filter(Q(pk__in=messaging_ids) | Q(pk__in=invoice_ids)).order_by("pk")
        page = data["page"]
        return Response(
            {
                "results": [
                    {
                        "id": str(p.pk),
                        "name": p.display_name,
                        "kind": p.kind,
                        "messaging": ma.seller_profiles_for(actor.account).filter(pk=p.pk).exists(),
                    }
                    for p in rows[(page - 1) * 20 : page * 20]
                ],
                "page": page,
                "count": rows.count(),
            }
        )
