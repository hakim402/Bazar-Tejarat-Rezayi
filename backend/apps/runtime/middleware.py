from django.conf import settings
from django.db import connection
from django.http import JsonResponse


class TargetSchemaMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if settings.PRODUCTION and connection.vendor == "mysql" and request.path_info != "/api/v1/health/live/":
            try:
                from .mariadb.schema import ready
                available = ready()
            except Exception:
                available = False
            if not available:
                response = JsonResponse({"status": "not_ready"}, status=503)
                response["Cache-Control"] = "no-store"
                response["Retry-After"] = "60"
                return response
        return self.get_response(request)
