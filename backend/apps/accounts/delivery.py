"""Encrypted durable account-mail outbox. No raw token in task arguments or diagnostics."""

import hashlib
import json
import secrets
from datetime import timedelta
from email.mime.image import MIMEImage
from pathlib import Path

from cryptography.fernet import Fernet
from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.db import transaction
from django.template.loader import render_to_string
from django.utils import timezone

from .email_copy import COPY
from .models import AccountMail, ActionToken, MailAttempt, User


def protect(payload):
    return Fernet(settings.MFA_ENCRYPTION_KEY.encode()).encrypt(json.dumps(payload).encode()).decode()


def reveal(value):
    return json.loads(Fernet(settings.MFA_ENCRYPTION_KEY.encode()).decrypt(value.encode()))


def render_account_mail(purpose, locale, name, url):
    locale = locale if locale in COPY else "fa-AF"
    t = COPY[locale]
    context = dict(
        t,
        locale=locale,
        direction="ltr" if locale == "en" else "rtl",
        name=name,
        url=url,
        title=t[purpose],
        preheader=t[purpose + "_body"],
        instructions=t[purpose + "_body"],
        cta=t[purpose + "_cta"],
        expiry=t["expiry"].format(minutes=settings.ACCOUNT_MAIL_TTL_MINUTES[purpose]),
    )
    return (
        f"{t['brand']} — {t[purpose]}",
        render_to_string("accounts/email/action.txt", context),
        render_to_string("accounts/email/action.html", context),
    )


def queue_account_mail(user, purpose, locale):
    from .services import credential_state

    with transaction.atomic():
        user = User.objects.select_for_update().get(pk=user.pk)
        if ActionToken.objects.filter(
            user=user, purpose=purpose, created_at__gt=timezone.now() - timedelta(seconds=60), used_at__isnull=True
        ).exists():
            return "cooldown"
        raw = secrets.token_urlsafe(32)
        ActionToken.objects.filter(user=user, purpose=purpose, used_at__isnull=True).update(used_at=timezone.now())
        token = ActionToken.objects.create(
            user=user,
            purpose=purpose,
            digest=hashlib.sha256(raw.encode()).hexdigest(),
            credential_state=credential_state(user),
            expires_at=timezone.now() + timedelta(minutes=settings.ACCOUNT_MAIL_TTL_MINUTES[purpose]),
        )
        item = AccountMail.objects.create(
            token=token, encrypted_payload=protect({"raw": raw, "locale": locale}), expires_at=token.expires_at
        )
        # Commit first; worker sweep recovers a crash or ambiguous send. Same token on every retry.
        transaction.on_commit(lambda: dispatch_one(item.pk))
    return "queued"


def message_for(token, payload):
    locale = payload["locale"] if payload["locale"] in COPY else "fa-AF"
    route = "reset-password" if token.purpose == "reset" else "verify-email"
    url = f"{settings.FRONTEND_ORIGIN}/{locale}/auth/{route}#token={payload['raw']}"
    subject, text, html = render_account_mail(token.purpose, locale, token.user.display_name, url)
    message = EmailMultiAlternatives(
        subject,
        text,
        settings.DEFAULT_FROM_EMAIL,
        [token.user.email],
        reply_to=[settings.ACCOUNT_REPLY_TO] if settings.ACCOUNT_REPLY_TO else None,
    )
    message.attach_alternative(html, "text/html")
    logo = MIMEImage((Path(__file__).parent / "email_assets" / f"{locale}.png").read_bytes(), _subtype="png")
    logo.add_header("Content-ID", "<rezayi-brand>")
    logo.add_header("Content-Disposition", "inline", filename="rezayi.png")
    message.mixed_subtype = "related"
    message.attach(logo)
    return message


def dispatch_one(pk):
    from .services import audit, credential_state

    with transaction.atomic():
        # Match issuance/reset lock order: identity first, then outbox/token.
        user_id = AccountMail.objects.values_list("token__user_id", flat=True).get(pk=pk)
        User.objects.select_for_update().get(pk=user_id)
        item = AccountMail.objects.select_for_update().select_related("token__user").get(pk=pk)
        if item.status not in {"queued", "delivery_failed"} or item.next_attempt_at > timezone.now():
            return item.status
        token = item.token
        if (
            item.expires_at <= timezone.now()
            or token.used_at
            or not token.user.is_active
            or token.credential_state != credential_state(token.user)
        ):
            item.status, item.encrypted_payload = "expired", ""
        elif item.attempts >= 3:
            item.status, item.encrypted_payload = "exhausted", ""
        else:
            item.attempts += 1
            try:
                if message_for(token, reveal(item.encrypted_payload)).send() != 1:
                    raise RuntimeError("adapter_rejected")
                item.status = "smtp_accepted" if settings.ACCOUNT_EMAIL_TRANSPORT == "smtp" else "captured"
                item.encrypted_payload = ""
            except Exception:
                # Provider exception text can contain credentials/recipients. Never persist or log it.
                item.status = "delivery_failed"
                item.next_attempt_at = timezone.now() + timedelta(seconds=60 * item.attempts)
            MailAttempt.objects.create(
                user=token.user, purpose=token.purpose, status="failed" if item.status == "delivery_failed" else "sent"
            )
            audit("mail_" + item.status, user=token.user)
        item.save()
        return item.status


def sweep_mail():
    from .models import GoogleAttempt

    now = timezone.now()
    GoogleAttempt.objects.filter(expires_at__lte=now).exclude(encrypted_payload="").update(encrypted_payload="")
    # Remove protected payloads for all expired entries, including exhausted attempts.
    AccountMail.objects.filter(expires_at__lte=now).exclude(encrypted_payload="").update(
        encrypted_payload="", status="expired"
    )
    for pk in AccountMail.objects.filter(
        status__in=["queued", "delivery_failed"], next_attempt_at__lte=now, expires_at__gt=now
    ).values_list("pk", flat=True)[:50]:
        dispatch_one(pk)
