"""English-only owner interface; marketplace/API localization stays independent."""

from django.utils import translation


class AdminEnglishMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.path_info == "/admin" or request.path_info.startswith("/admin/"):
            with translation.override("en"):
                request.LANGUAGE_CODE = "en"
                response = self.get_response(request)
                response.headers["Content-Language"] = "en"
                return response
        return self.get_response(request)
