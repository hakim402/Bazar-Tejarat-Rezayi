"""Single-use email codes backed by the existing encrypted mail outbox."""
import hashlib
import hmac

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from ..models import ActionToken, User, normalize_email
from . import audit, credential_state


def code_digest(user_id, challenge, code):
    return hmac.new(
        settings.SECRET_KEY.encode(),
        f"email-code:{user_id}:{challenge}:{code}".encode(),
        hashlib.sha256,
    ).hexdigest()


def consume_code(email, code, request):
    invalid = True
    with transaction.atomic():
        user = User.objects.select_for_update().filter(email=normalize_email(email), is_active=True).first()
        if user:
            token = ActionToken.objects.select_for_update().filter(
                user=user, purpose="verify", used_at__isnull=True,
            ).order_by("-created_at", "-pk").first()
            if (
                token and token.code_digest and token.failed_attempts < 5
                and token.expires_at > timezone.now()
                and not user.email_verified
                and hmac.compare_digest(token.credential_state, credential_state(user))
            ):
                if hmac.compare_digest(token.code_digest, code_digest(user.pk, token.digest, code)):
                    user.email_verified = True
                    user.save(update_fields=["email_verified"])
                    token.used_at = timezone.now()
                    token.save(update_fields=["used_at"])
                    audit("email_verified", request=request, user=user)
                    invalid = False
                else:
                    token.failed_attempts += 1
                    token.save(update_fields=["failed_attempts"])
    # Failed attempts must commit before validation exits the request.
    if invalid:
        raise ValidationError({"code": ["The code is invalid, expired or already used."]})
