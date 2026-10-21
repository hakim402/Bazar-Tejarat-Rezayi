"""Bound evidence request size before CSRF/multipart parsing or temporary-file creation."""

import re
from django.http import JsonResponse
from apps.foundation.errors import error_data

LIMIT = 11 * 1024 * 1024


class EvidenceRequestLimitMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.method == "POST" and re.fullmatch(
            r"/api/v1/verification/[^/]+/profiles/[0-9a-f-]+/evidence/", request.path
        ):
            try:
                size = int(request.META.get("CONTENT_LENGTH") or 0)
                if size <= 0 or size > LIMIT:
                    return self.refuse(request)
                # Bounded read also lets us reject unsanitized incoming path filenames rather
                # than merely relying on Django's basename sanitization. Body is reused by Django.
                body = request.body
                if len(body) > LIMIT:
                    return self.refuse(request)
                names = re.findall(rb'filename="([^"\r\n]*)"', body[:LIMIT])
                if any(re.search(rb"[/\\\x00-\x1f]", name) for name in names):
                    return self.refuse(request)
            except (ValueError, OSError):
                return self.refuse(request)
        return self.get_response(request)

    @staticmethod
    def refuse(request):
        response = JsonResponse(
            error_data(
                "validation_error",
                "The upload could not be accepted.",
                request.request_id,
                {"file": ["Use one valid file within the upload limit."]},
            ),
            status=400,
        )
        response["Cache-Control"] = "private, no-store"
        return response
