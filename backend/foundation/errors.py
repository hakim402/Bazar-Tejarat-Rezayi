from uuid import uuid4

from django.http import JsonResponse
from rest_framework.response import Response
from rest_framework.views import exception_handler

from .observability import log_failure


def error_data(code, message, request_id, fields=None):
    error = {"code": code, "message": message, "request_id": str(request_id)}
    if fields is not None:
        error["fields"] = fields
    return {"error": error}


def api_exception_handler(exc, context):
    response = exception_handler(exc, context)
    request_id = getattr(context["request"], "request_id", uuid4())
    if response is None:
        log_failure(context["request"], exc)
        return Response(error_data("internal_error", "The request could not be completed.", request_id), status=500)
    code = {
        400: "validation_error",
        401: "unauthenticated",
        403: "forbidden",
        404: "not_found",
        405: "method_not_allowed",
        415: "unsupported_media_type",
        429: "rate_limited",
    }.get(response.status_code, "request_failed")
    fields = response.data if response.status_code == 400 else None
    response.data = error_data(code, "The request could not be completed.", request_id, fields)
    return response


def not_found(request, exception=None):
    return JsonResponse(
        error_data("not_found", "The requested resource was not found.", request.request_id), status=404
    )


def server_error(request):
    import sys

    exception = sys.exc_info()[1]
    if exception is not None:
        log_failure(request, exception)
    return JsonResponse(
        error_data("internal_error", "The request could not be completed.", request.request_id), status=500
    )
