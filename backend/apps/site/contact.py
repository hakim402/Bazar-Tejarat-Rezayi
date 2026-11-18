"""Anonymous, CSRF-protected contact form; no public message lookup."""
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.parsers import JSONParser
from rest_framework.response import Response

from apps.accounts.api.views import AuthView
from apps.accounts.services import rate_limit
from .services.contact import deliver_contact
from .validation import text


class ContactSubmission(serializers.Serializer):
    name = serializers.CharField(min_length=2, max_length=120, validators=[text])
    email = serializers.EmailField(max_length=254)
    topic = serializers.ChoiceField(choices=["general", "selling", "order", "payment", "feedback"])
    reference = serializers.CharField(max_length=100, allow_blank=True, default="", validators=[text])
    message = serializers.CharField(min_length=10, max_length=4000, validators=[text])
    website = serializers.CharField(max_length=200, allow_blank=True, default="")


class ContactResult(serializers.Serializer):
    status = serializers.ChoiceField(choices=["sent"])


class ContactView(AuthView):
    parser_classes = [JSONParser]

    @extend_schema(operation_id="site_contact", request=ContactSubmission, responses={200: ContactResult})
    def post(self, request, locale):
        from apps.foundation.contracts import LOCALES
        from rest_framework.exceptions import NotFound, ValidationError

        if locale not in LOCALES:
            raise NotFound()
        # Existing primitive hashes identifiers and ignores untrusted proxy headers.
        rate_limit(request, "site_contact", identity=request.META.get("REMOTE_ADDR", "unknown"), limit=5)
        data = self.data(ContactSubmission)
        if data.pop("website"):
            raise ValidationError({"website": ["invalid"]})
        deliver_contact(request, locale, data)
        return Response({"status": "sent"})
