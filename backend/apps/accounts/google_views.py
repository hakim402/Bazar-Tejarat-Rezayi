from urllib.parse import urlencode
from django.conf import settings
from django.http import HttpResponseRedirect
from django.middleware.csrf import get_token
from drf_spectacular.utils import extend_schema
from rest_framework.response import Response
from . import google, contracts as c
from .views import AuthView


class GoogleAvailability(AuthView):
    @extend_schema(responses=c.AuthResult)
    def get(self, request):
        return Response({"status": "google_available" if settings.GOOGLE_OAUTH_ENABLED else "google_unavailable"})


class GoogleStart(AuthView):
    @extend_schema(request=c.GoogleStartRequest, responses=c.AuthResult)
    def post(self, request):
        return Response(google.begin(request, self.data(c.GoogleStartRequest)))


class GoogleCallback(AuthView):
    @extend_schema(responses={302: None})
    def get(self, request):
        attempt, result = google.callback(request)
        if result == "signed_in":
            return HttpResponseRedirect(settings.FRONTEND_ORIGIN + attempt.return_path)
        query = urlencode(
            {"google": result, "attempt": str(attempt.pk), "context": attempt.context, "action": attempt.action}
        )
        return HttpResponseRedirect(f"{settings.FRONTEND_ORIGIN}/{attempt.locale}/auth/google-result?{query}")


class GoogleComplete(AuthView):
    @extend_schema(request=c.GoogleCompleteRequest, responses=c.AuthResult)
    def post(self, request):
        return Response(
            {**google.complete(request, self.data(c.GoogleCompleteRequest)), "csrf_token": get_token(request)}
        )
