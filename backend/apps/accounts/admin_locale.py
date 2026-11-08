"""Scoped admin language: English default, Dari (fa-AF) optional; marketplace/API stay independent."""

from django.http import HttpResponseRedirect
from django.utils import translation
from django.utils.http import url_has_allowed_host_and_scheme
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.http import require_POST

SESSION_KEY = "admin_language"
ADMIN_LANGUAGES = ("en", "fa-af")


def admin_language(request):
    try:
        language = request.session.get(SESSION_KEY, "en")
    except AttributeError:
        language = "en"
    return language if language in ADMIN_LANGUAGES else "en"


def frontend_locale(language):
    return "fa-AF" if language == "fa-af" else "en"


class AdminLanguageMiddleware:
    """Runs after the session middleware; only /admin paths get the override."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.path_info == "/admin" or request.path_info.startswith("/admin/"):
            language = admin_language(request)
            with translation.override(language):
                request.LANGUAGE_CODE = language
                response = self.get_response(request)
                response.headers["Content-Language"] = language
                return response
        return self.get_response(request)


@require_POST
@csrf_protect
def set_language(request):
    language = request.POST.get("language", "")
    if language in ADMIN_LANGUAGES:
        request.session[SESSION_KEY] = language
    next_url = request.POST.get("next", "")
    if not url_has_allowed_host_and_scheme(next_url, allowed_hosts={request.get_host()}, require_https=request.is_secure()):
        next_url = "/admin/"
    if not (next_url == "/admin" or next_url.startswith("/admin/")):
        next_url = "/admin/"
    return HttpResponseRedirect(next_url)