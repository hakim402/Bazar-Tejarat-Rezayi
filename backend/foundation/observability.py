import json
import logging
from time import monotonic
from traceback import walk_tb
from uuid import UUID, uuid4

from django.http import JsonResponse

logger = logging.getLogger("foundation.requests")


def request_id_for(request):
    try:
        return str(UUID(getattr(request, "request_id", "")))
    except (ValueError, AttributeError, TypeError):
        value = str(uuid4())
        if request is not None:
            request.request_id = value
        return value


def log_failure(request, exc, *, operation="api_request", dependency=None):
    if operation == "api_request" and getattr(request, "_failure_logged", False):
        return
    frames = [
        {"module": frame.f_globals.get("__name__", "unknown"), "function": frame.f_code.co_name, "line": line}
        for frame, line in walk_tb(exc.__traceback__)
    ]
    event = {
        "event": "server_failure",
        "request_id": request_id_for(request),
        "operation": operation,
        "route": getattr(getattr(request, "resolver_match", None), "view_name", "unmatched"),
        "exception_type": type(exc).__name__,
        "frames": frames[-10:],
    }
    if dependency is not None:
        event["dependency"] = dependency
    # Never attach exc_info: formatters could otherwise serialize messages, locals or request contents.
    logging.getLogger("foundation.errors").error(json.dumps(event))
    if request is not None and operation == "api_request":
        request._failure_logged = True


class SanitizedSecurityHandler(logging.Handler):
    def emit(self, record):
        reasons = {
            "DisallowedHost": "invalid_host",
            "csrf": "csrf_rejected",
            "SuspiciousOperation": "suspicious_request",
            "SuspiciousFileOperation": "unsafe_file_path",
        }
        event = {
            "event": "security_event",
            "request_id": request_id_for(getattr(record, "request", None)),
            "reason": reasons.get(record.name.rsplit(".", 1)[-1], "request_rejected"),
        }
        # Do not call record.getMessage() or forward the raw record/exception to another handler.
        logging.getLogger("foundation.security").warning(json.dumps(event))


class SanitizedRequestErrorHandler(logging.Handler):
    def emit(self, record):
        if record.exc_info and record.exc_info[1] is not None:
            log_failure(getattr(record, "request", None), record.exc_info[1])


class RequestContextMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        try:
            request.request_id = str(UUID(request.headers.get("X-Request-ID", "")))
        except (ValueError, AttributeError):
            request.request_id = str(uuid4())
        start = monotonic()
        response = self.get_response(request)
        if request.path.startswith("/api/") and response.status_code in {400, 403, 500}:
            if "application/json" not in response.get("Content-Type", ""):
                from .errors import error_data

                response = JsonResponse(
                    error_data("request_failed", "The request could not be completed.", request.request_id),
                    status=response.status_code,
                )
        response["X-Request-ID"] = request.request_id
        logger.info(
            json.dumps(
                {
                    "event": "http_request",
                    "request_id": request.request_id,
                    "method": request.method,
                    "route": getattr(request.resolver_match, "view_name", "unmatched"),
                    "status": response.status_code,
                    "duration_ms": round((monotonic() - start) * 1000),
                }
            )
        )
        return response

    def process_exception(self, request, exception):
        log_failure(request, exception)
        if request.path.startswith("/api/"):
            from .errors import error_data

            return JsonResponse(
                error_data("internal_error", "The request could not be completed.", request.request_id), status=500
            )


def audit_event(*, actor_id, context, resource_type, resource_id, action, reason_code, request_id, case_id=None):
    from datetime import datetime, timezone

    # IDs and controlled codes only. Durable transactional audit storage belongs to identity/business phases.
    event = {
        "event": "audit",
        "actor_id": str(actor_id),
        "context": context,
        "resource_type": resource_type,
        "resource_id": str(resource_id),
        "action": action,
        "reason_code": reason_code,
        "request_id": str(request_id),
        "time": datetime.now(timezone.utc).isoformat(),
    }
    if action == "case_read" and not case_id:
        raise ValueError("Case-scoped reads require a related case identifier.")
    if case_id is not None:
        event["case_id"] = str(case_id)
    if context not in {"buyer", "seller", "staff", "owner", "system"}:
        raise ValueError("Invalid audit context.")
    for value in (resource_type, action, reason_code):
        if not value or not all(c.isalnum() or c in "_.-" for c in value):
            raise ValueError("Audit actions and reasons must be controlled codes.")
    logging.getLogger("foundation.audit").info(json.dumps(event))
