from django.shortcuts import get_object_or_404
from django.db.models import Prefetch
from drf_spectacular.utils import extend_schema
from rest_framework.views import APIView
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError, NotFound
from apps.organizations.views import OrganizationView
from . import contracts as c
from .models import ContentItem, ContentRevision, Publication, LOCALES
from .queries import resolved, selections, editor_item, public_targets
from .services import authority, create, save, transition


class PublicView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "no-store"
        return response

    def locale(self, locale):
        if locale not in LOCALES:
            raise NotFound()


class PublicPage(PublicView):
    @extend_schema(operation_id="content_page", responses=c.PublicContent)
    def get(self, request, locale, key="home"):
        self.locale(locale)
        item = resolved(key, locale)
        if not item:
            raise NotFound()
        return Response(item)


class PublicHome(PublicPage):
    @extend_schema(operation_id="content_home", responses=c.PublicContent)
    def get(self, request, locale):
        return super().get(request, locale, "home")


class PublicShell(PublicView):
    @extend_schema(operation_id="content_shell", responses=c.PublicShell)
    def get(self, request, locale):
        self.locale(locale)
        rows = selections(["navigation", "support", "announcement"])
        active = public_targets()
        return Response(
            {
                name: resolved(key, locale, rows, active=active)
                for name, key in [
                    ("navigation", "navigation"),
                    ("support", "support"),
                    ("announcement", "announcement"),
                ]
            }
        )


class PublicHelp(PublicView):
    @extend_schema(operation_id="content_help", responses=c.PublicList)
    def get(self, request, locale):
        self.locale(locale)
        try:
            page = int(request.query_params.get("page", 1))
            if not 1 <= page <= 10000:
                raise ValueError
        except ValueError:
            raise ValidationError({"page": ["Use a valid page."]}) from None
        published = Publication.objects.filter(locale="fa-AF")
        keys = list(published.filter(item__kind="article").order_by("item__key").values_list("item__key", flat=True))
        selected = keys[(page - 1) * 12 : page * 12]
        rows = selections(selected)
        active = public_targets()
        return Response(
            {"results": [resolved(k, locale, rows, active=active) for k in selected], "page": page, "count": len(keys)}
        )


class EditorItems(OrganizationView):
    @extend_schema(operation_id="content_editor_list", responses=c.EditorList)
    def get(self, request, context):
        authority(request, context, "read_drafts")
        from apps.accounts.services import get_grant

        account = get_grant(request, context)
        codes = (
            ["read_drafts", "edit_content", "publish_content", "manage_settings"]
            if context == "owner"
            else list(
                account.permission_groups.filter(permissions__content_type__app_label="content")
                .values_list("permissions__codename", flat=True)
                .distinct()
            )
        )
        try:
            page = int(request.query_params.get("page", 1))
            if not 1 <= page <= 10000:
                raise ValueError
        except ValueError:
            raise ValidationError({"page": ["Use a valid page."]}) from None
        items = ContentItem.objects.prefetch_related(
            "publications", Prefetch("revisions", queryset=ContentRevision.objects.only("item_id", "locale", "state"))
        ).order_by("key")
        if context != "owner" and "manage_settings" not in codes:
            items = items.exclude(kind__in=["home", "shell", "support", "announcement"])
        return Response(
            {
                "results": [
                    {
                        "id": item.pk,
                        "key": item.key,
                        "kind": item.kind,
                        "version": item.version,
                        "locales": sorted({r.locale for r in item.revisions.all()}),
                        "states": sorted({r.state for r in item.revisions.all()}),
                        "publications": {p.locale: p.revision_id for p in item.publications.all()},
                    }
                    for item in items[(page - 1) * 50 : page * 50]
                ],
                "permissions": codes,
                "page": page,
                "count": items.count(),
            }
        )

    @extend_schema(operation_id="content_editor_create", request=c.Create, responses=c.Operation)
    def post(self, request, context):
        return Response(create(request, context, self.data(c.Create)), status=201)


class EditorDetail(OrganizationView):
    @extend_schema(operation_id="content_editor_get", responses=c.EditorItem)
    def get(self, request, context, key):
        return Response(editor_item(request, context, get_object_or_404(ContentItem, key=key)))

    @extend_schema(operation_id="content_editor_save", request=c.Save, responses=c.Operation)
    def post(self, request, context, key):
        return Response(save(request, context, key, self.data(c.Save)))


class EditorAction(OrganizationView):
    @extend_schema(operation_id="content_editor_action", request=c.Action, responses=c.Operation)
    def post(self, request, context, key):
        return Response(transition(request, context, key, self.data(c.Action)))


class Preview(OrganizationView):
    @extend_schema(operation_id="content_preview", responses=c.RevisionData)
    def get(self, request, context, pk):
        revision = get_object_or_404(ContentRevision.objects.select_related("item"), pk=pk)
        authority(request, context, "read_drafts", revision.item)
        return Response(c.RevisionData(revision).data)
