"""Keep delayed read responses from erasing a concurrently rotated login cookie."""

from django.conf import settings
from django.contrib.sessions.middleware import SessionMiddleware


class ReadSafeSessionMiddleware(SessionMiddleware):
    def process_response(self, request, response):
        # A stale GET cannot tell whether another request already replaced its
        # cookie. Server-side session/grant validation still rejects stale keys;
        # explicit POST logout retains Django's normal cookie deletion.
        session = getattr(request, "session", None)
        empty_read = request.method in {"GET", "HEAD"} and session is not None and session.is_empty()
        response = super().process_response(request, response)
        cookie = response.cookies.get(settings.SESSION_COOKIE_NAME)
        if empty_read and cookie is not None and cookie.value == "" and str(cookie["max-age"]) == "0":
            del response.cookies[settings.SESSION_COOKIE_NAME]
        return response
