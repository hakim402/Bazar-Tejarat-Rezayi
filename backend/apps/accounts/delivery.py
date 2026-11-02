"""Encrypted durable account-mail outbox. No raw token in task arguments or diagnostics."""

import hashlib
import json
import secrets
import smtplib
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
        AccountMail.objects.create(
            token=token, encrypted_payload=protect({"raw": raw, "locale": locale}), expires_at=token.expires_at
        )
        # Commit first; worker sweep recovers a crash or ambiguous send. Same token on every retry.
        from apps.runtime.jobs import enqueue
        enqueue("account_sweep")
    return "queued"


def message_for(token, payload):
    locale = payload["locale"] if payload["locale"] in COPY else "fa-AF"
    route = "reset-password" if token.purpose == "reset" else "verify-email"
    url = f"{settings.FRONTEND_ORIGIN}/{locale}/auth/{route}#token={payload['raw']}"
    subject, text, html = render_account_mail(token.purpose, locale, token.user.display_name, url)
    return assemble_message((subject, text, html), token.user.email, locale)


def assemble_message(rendered, recipient, locale):
    subject, text, html = rendered
    message = EmailMultiAlternatives(
        subject,
        text,
        settings.DEFAULT_FROM_EMAIL,
        [recipient],
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
        user_id = AccountMail.objects.values_list("token__user_id", flat=True).get(pk=pk)
        User.objects.select_for_update().get(pk=user_id)
        item = AccountMail.objects.select_for_update().select_related("token__user").get(pk=pk)
        now = timezone.now()
        if item.status == "dispatching":
            if item.next_attempt_at <= now:
                item.status = "delivery_unknown"
                item.save(update_fields=["status", "updated_at"])
            return item.status
        if item.status not in {"queued", "delivery_failed"} or item.next_attempt_at > now:
            return item.status
        token = item.token
        if (item.expires_at <= now or token.used_at or not token.user.is_active
                or token.credential_state != credential_state(token.user)):
            item.status, item.encrypted_payload = "expired", ""
            item.save()
            return item.status
        if item.attempts >= 3:
            item.status, item.encrypted_payload = "exhausted", ""
            item.save()
            return item.status
        # Persist the send boundary BEFORE contacting a provider. A lost worker
        # cannot roll attempts back or silently resend an uncertain acceptance.
        message = message_for(token, reveal(item.encrypted_payload))
        item.attempts += 1
        attempt = item.attempts
        item.status = "dispatching"
        item.next_attempt_at = now + timedelta(seconds=90)
        item.save()
    try:
        accepted = message.send() == 1
        status = ("smtp_accepted" if settings.ACCOUNT_EMAIL_TRANSPORT == "smtp" else "captured") if accepted else "delivery_failed"
    except (smtplib.SMTPRecipientsRefused, smtplib.SMTPSenderRefused, smtplib.SMTPDataError):
        status = "delivery_failed"
    except Exception:
        status = "delivery_unknown"
    with transaction.atomic():
        User.objects.select_for_update().get(pk=user_id)
        item = AccountMail.objects.select_for_update().get(pk=pk)
        if item.status != "dispatching" or item.attempts != attempt:
            return item.status
        item.status = status
        if status in {"captured", "smtp_accepted"}:
            item.encrypted_payload = ""
        elif status == "delivery_failed":
            item.next_attempt_at = timezone.now() + timedelta(seconds=60 * attempt)
        item.save()
        MailAttempt.objects.create(user_id=user_id, purpose=token.purpose,
                                  status="sent" if status in {"captured", "smtp_accepted"} else "failed")
        audit("mail_" + status, user=token.user)
        return status


def sweep_mail():
    from apps.organizations.mail import sweep_invitations
    sweep_invitations()
    from .models import GoogleAttempt

    now = timezone.now()
    GoogleAttempt.objects.filter(expires_at__lte=now).exclude(encrypted_payload="").update(encrypted_payload="")
    # Remove protected payloads for all expired entries, including exhausted attempts.
    AccountMail.objects.filter(expires_at__lte=now).exclude(encrypted_payload="").update(
        encrypted_payload="", status="expired"
    )
    for pk in AccountMail.objects.filter(
        status__in=["queued", "delivery_failed", "dispatching"], next_attempt_at__lte=now, expires_at__gt=now
    ).values_list("pk", flat=True)[:50]:
        dispatch_one(pk)
