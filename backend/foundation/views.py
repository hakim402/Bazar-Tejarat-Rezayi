import redis
from django.conf import settings
from django.db import connections
from drf_spectacular.utils import extend_schema
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .contracts import BRAND_NAMES, LOCALES, BootstrapSerializer, ErrorSerializer, StatusSerializer
from .observability import log_failure


class PublicView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]


class BootstrapView(PublicView):
    @extend_schema(
        responses={200: BootstrapSerializer, 400: ErrorSerializer, 405: ErrorSerializer, 500: ErrorSerializer},
        operation_id="bootstrap",
        auth=[],
    )
    def get(self, request):
        response = Response(
            BootstrapSerializer(
                {
                    "default_locale": "fa-AF",
                    "supported_locales": LOCALES,
                    "brand_names": BRAND_NAMES,
                    "currencies": ["AFN", "USD"],
                }
            ).data
        )
        response["Cache-Control"] = "public, max-age=60"
        return response


class LiveView(PublicView):
    @extend_schema(responses=StatusSerializer, operation_id="liveness", auth=[])
    def get(self, request):
        response = Response({"status": "alive"})
        response["Cache-Control"] = "no-store"
        return response


class ReadyView(PublicView):
    @extend_schema(responses={200: StatusSerializer, 503: StatusSerializer}, operation_id="readiness", auth=[])
    def get(self, request):
        healthy = True
        try:
            with connections["default"].cursor() as cursor:
                cursor.execute("SELECT 1")
                healthy = cursor.fetchone() == (1,)
        except Exception as exc:
            log_failure(request, exc, operation="dependency_readiness", dependency="postgresql")
            healthy = False
        broker = redis.Redis.from_url(settings.CELERY_BROKER_URL, socket_connect_timeout=2, socket_timeout=2)
        try:
            healthy = bool(broker.ping()) and healthy
        except Exception as exc:
            log_failure(request, exc, operation="dependency_readiness", dependency="redis")
            healthy = False
        finally:
            broker.close()
        response = Response({"status": "ready" if healthy else "not_ready"}, status=200 if healthy else 503)
        response["Cache-Control"] = "no-store"
        return response
