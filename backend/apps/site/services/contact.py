"""Deliver only to the owner's configured support address, never to user-selected recipients."""
from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.mail import EmailMessage
from django.core.validators import validate_email
from rest_framework.exceptions import APIException

from apps.foundation.observability import log_failure
from ..models import SiteSettings


class ContactUnavailable(APIException):
    status_code = 503
    default_detail = "Contact delivery is unavailable."


def deliver_contact(request, locale, data):
    recipient = SiteSettings.objects.filter(pk=1).values_list("email", flat=True).first()
    try:
        validate_email(recipient or "")
    except ValidationError:
        raise ContactUnavailable() from None
    # Never claim an email was sent when the existing runtime is in local capture mode.
    # Provider activation remains a separate owner-controlled operation.
    if getattr(settings, "ACCOUNT_EMAIL_TRANSPORT", "capture") != "smtp":
        raise ContactUnavailable()
    topics = {
        "general": "General enquiry", "selling": "Selling", "order": "Order or delivery",
        "payment": "Payment", "feedback": "Feedback",
    }
    body = (
        f"Website contact message\nLanguage: {locale}\n"
        f"Name: {data['name']}\nReply email: {data['email']}\n"
        f"Topic: {topics[data['topic']]}\nReference: {data['reference'] or '-'}\n\n"
        f"{data['message']}\n"
    )
    message = EmailMessage(
        subject=f"Bazar Rezayi contact: {topics[data['topic']]}",
        body=body,
        from_email=settings.DEFAULT_FROM_EMAIL,
        to=[recipient],
        reply_to=[data["email"]],
    )
    try:
        sent = message.send(fail_silently=False)
    except Exception as error:
        # Sanitized logging records exception type/frames, never message content or addresses.
        log_failure(request, error, operation="site_contact", dependency="email")
        raise ContactUnavailable() from None
    if sent != 1:
        raise ContactUnavailable()
