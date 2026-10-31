import uuid
from django.conf import settings
from drf_spectacular.utils import extend_schema
from rest_framework.response import Response
from rest_framework.exceptions import PermissionDenied
from apps.accounts.views import AuthView
from apps.accounts.services import get_grant, AuthFailure, rate_limit
from apps.organizations.access import Actor
from apps.messaging.views import query
from . import services, contracts as c


class CartView(AuthView):
    parser_classes = [c.BoundedJSONParser]

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        if getattr(request, "_commerce_guest_key", None):
            response.set_cookie(
                services.SESSION_KEY,
                request._commerce_guest_key,
                max_age=30 * 86400,
                httponly=True,
                secure=settings.SESSION_COOKIE_SECURE,
                samesite="Lax",
                path="/api/v1/cart/",
            )
        return response

    def selected(self, context):
        if context == "buyer":
            actor = Actor(self.request, "buyer")
            actor.account
            return actor
        if self.request.user.is_authenticated:
            try:
                get_grant(self.request, "buyer")
            except (AuthFailure, PermissionDenied):
                pass
            else:
                raise PermissionDenied("Use the buyer cart.")
        return None

    def rate(self, context):
        if context in {"buyer", "merge", "merge_preview"}:
            identity = str(Actor(self.request, "buyer").account.pk)
        else:
            identity = str(services.guest_key(self.request) or self.request.META.get("REMOTE_ADDR", "unknown"))
        rate_limit(
            self.request,
            "cart_" + context,
            identity=identity,
            limit=100,
            seconds=900,
        )

    @extend_schema(operation_id="cart_read", parameters=[c.CartQuery], responses=c.CartResult)
    def get(self, request, context):
        data = query(request, c.CartQuery)
        actor = self.selected(context)
        self.rate(context)
        row = services.buyer(actor) if actor else services.guest(request)
        result = services.projection(row, data["locale"])
        result["initialized"] = bool(actor) or services.guest_initialized(request)
        result["guest_scope"] = None if actor else services.guest_scope(request)
        return Response(c.CartResult(result).data)

    @extend_schema(operation_id="cart_mutate", request=c.CartMutation, responses=c.MutationResult)
    def post(self, request, context):
        query(request)
        actor = self.selected(context)
        self.rate(context)
        return Response(c.MutationResult(services.mutate(request, actor, self.data(c.CartMutation))).data)


class Merge(CartView):
    @extend_schema(operation_id="cart_merge_preview", parameters=[c.CartQuery], responses=c.CartResult)
    def get(self, request):
        actor = Actor(request, "buyer")
        actor.account
        self.rate("merge_preview")
        data = query(request, c.CartQuery)
        return Response(c.CartResult(services.projection(services.guest(request), data["locale"])).data)

    @extend_schema(operation_id="cart_merge", request=c.MergeCommand, responses=c.MergeResult)
    def post(self, request):
        query(request)
        actor = Actor(request, "buyer")
        actor.account
        self.rate("merge")
        return Response(c.MergeResult(services.merge(request, actor, self.data(c.MergeCommand))).data)


class Initialize(CartView):
    @extend_schema(operation_id="cart_guest_initialize", request=c.InitializeCommand, responses=c.Initialization)
    def post(self, request):
        query(request)
        self.selected("guest")
        self.rate("guest_initialize")
        self.data(c.InitializeCommand)
        if not services.guest_initialized(request):
            request._commerce_guest_key = str(uuid.uuid4())
        return Response(c.Initialization({"initialized": True}).data)

    # This endpoint has no read or general mutation surface.
    http_method_names = ["post", "options"]


class Reconcile(CartView):
    @extend_schema(operation_id="cart_command_reconcile", request=c.ReconcileCommand, responses=c.Reconciliation)
    def post(self, request, context):
        query(request)
        actor = self.selected(context)
        self.rate(context)
        return Response(c.Reconciliation(services.reconcile(request, actor, self.data(c.ReconcileCommand))).data)

    http_method_names = ["post", "options"]
