"""Process-settings-only fault boundary for owned browser availability checks."""
from pathlib import Path
from django.http import JsonResponse
from config.testing import ownership_manifest


class SiteFaultMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.path.startswith("/api/v1/site/public/"):
            marker = ownership_manifest()
            path = Path(marker["root"]) / "site-fault"
            if path.exists():
                fault = path.read_text()
                return JsonResponse({"maintenance": {"enabled": "invalid"}}, status=503 if fault == "unavailable" else 200, headers={"Cache-Control": "no-store"})
        return self.get_response(request)
