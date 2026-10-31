"""Leased optional email delivery. Possible SMTP acceptance is never auto-retried."""

import uuid
import smtplib
from datetime import timedelta
from django.conf import settings
from django.db import transaction
from django.utils import timezone
from django.utils.html import escape
from apps.accounts.delivery import assemble_message
from apps.accounts.models import Account, User, AuditEvent
from apps.messaging import access
from apps.messaging.models import Conversation, ReadState
from apps.organizations.models import BusinessProfile
from .models import Preference, Outbox, Attempt
from .services import identity_digest

TERMINAL = {"captured", "smtp_accepted", "cancelled", "exhausted", "delivery_unknown"}
COPY = {
    "en": (
        "Unread message activity",
        "You have unread activity in a product enquiry. Sign in to view it.",
        "Open messages",
    ),
    "fa-AF": (
        "پیام خوانده‌نشده",
        "در گفت‌وگوی پرسش محصول پیام خوانده‌نشده دارید. برای دیدن آن وارد حساب شوید.",
        "دیدن پیام‌ها",
    ),
    "ps": (
        "نا لوستل شوی پیغام",
        "د محصول د پوښتنې په خبرو کې نا لوستل شوی پیغام لرئ. د لیدلو لپاره خپل حساب ته ننوځئ.",
        "پیغامونه وګورئ",
    ),
    "ar": ("نشاط رسائل غير مقروء", "لديك نشاط غير مقروء في استفسار عن منتج. سجّل الدخول لعرضه.", "فتح الرسائل"),
}


class DefiniteDeliveryFailure(Exception):
    """The adapter knows no external acceptance occurred."""


def before_dispatch(_pk):
    # Explicit test seam before the final authority check, not a bypass adapter.
    return None


def rendered(account, item, locale):
    locale = locale if locale in COPY else "fa-AF"
    title, text, cta = COPY[locale]
    suffix = f"?seller={item.seller_id}" if account.context == "seller" else ""
    url = f"{settings.FRONTEND_ORIGIN}/{locale}/account/{account.context}/messages/{item.pk}{suffix}"
    from apps.accounts.email_copy import COPY as BRAND

    brand = BRAND[locale]["brand"]
    direction = "ltr" if locale == "en" else "rtl"
    plain = f"{brand}\n\n{title}\n{text}\n{url}"
    html = f'<html lang="{locale}" dir="{direction}"><body style="font-family:sans-serif"><img src="cid:rezayi-brand" alt="{escape(brand)}" width="180"><h1>{escape(title)}</h1><p>{escape(text)}</p><a href="{escape(url)}">{escape(cta)}</a></body></html>'
    return (f"{brand} — {title}", plain, html)


def claim(pk):
    with transaction.atomic():
        row = Outbox.objects.select_for_update().get(pk=pk)
        now = timezone.now()
        if row.status in TERMINAL or row.due_at > now:
            return None
        if row.status in {"claimed", "dispatching"}:
            if row.lease_until and row.lease_until > now:
                return None
            # Claim-only crashes are safe; crossing the dispatch boundary is not.
            if row.status == "dispatching":
                row.status = "delivery_unknown"
                row.version += 1
                row.save(update_fields=["status", "version"])
                Attempt.objects.create(outbox=row, status=row.status, code="expired_dispatch_lease")
                return None
        if row.attempts >= 3:
            row.status = "exhausted"
            row.version += 1
            row.save(update_fields=["status", "version"])
            return None
        row.status = "claimed"
        row.claim = uuid.uuid4()
        row.lease_until = now + timedelta(minutes=2)
        row.version += 1
        row.save()
        return row.claim


def prepare(pk, token):
    preliminary = Outbox.objects.select_related("conversation").get(pk=pk)
    with transaction.atomic():
        # Shared mutation order: profile -> recipient identity/account -> thread/state -> outbox.
        BusinessProfile.objects.select_for_update().get(pk=preliminary.conversation.seller_id)
        account_id = preliminary.account_id
        user_id = Account.objects.values_list("user_id", flat=True).get(pk=account_id)
        User.objects.select_for_update().get(pk=user_id)
        account = Account.objects.select_for_update().select_related("user").get(pk=account_id)
        item = Conversation.objects.select_for_update().select_related("seller").get(pk=preliminary.conversation_id)
        state = ReadState.objects.select_for_update().filter(account=account, conversation=item).first()
        preference = Preference.objects.select_for_update().filter(account=account).first()
        row = Outbox.objects.select_for_update().get(pk=pk)
        if row.status != "claimed" or row.claim != token:
            return None
        obsolete = (
            not access.recipient_allowed(item, account)
            or row.identity_digest != identity_digest(account, item)
            or not state
            or state.episode != row.episode
            or state.latest_incoming <= state.last_read
            or preference is not None
            and not preference.message_email
        )
        if obsolete:
            row.status = "cancelled"
            row.version += 1
            row.save()
            Attempt.objects.create(outbox=row, status=row.status, code="no_longer_eligible")
            return None
        if state.last_emailed_at and state.last_emailed_at + timedelta(minutes=15) > timezone.now():
            row.status = "queued"
            row.due_at = state.last_emailed_at + timedelta(minutes=15)
            row.version += 1
            row.save()
            return None
        row.status = "dispatching"
        row.attempts += 1
        row.version += 1
        row.save()
        locale = preference.locale if preference and preference.locale in COPY else "fa-AF"
        message = assemble_message(rendered(account, item, locale), account.user.email, locale)
        message.extra_headers = {"Message-ID": f"<message-activity-{row.pk}@notifications.rezayi.invalid>"}
        return message


def finish(pk, token, status, code):
    # Read/message updates take conversation first; preserve that ordering here.
    preliminary = Outbox.objects.get(pk=pk)
    with transaction.atomic():
        Conversation.objects.select_for_update().get(pk=preliminary.conversation_id)
        state = ReadState.objects.select_for_update().get(
            account=preliminary.account_id, conversation=preliminary.conversation_id
        )
        row = Outbox.objects.select_for_update().get(pk=pk)
        if row.claim != token or row.status != "dispatching":
            return row.status
        row.status = status
        row.version += 1
        if status in {"captured", "smtp_accepted"}:
            row.accepted_at = timezone.now()
            state.last_emailed_at = row.accepted_at
            state.save(update_fields=["last_emailed_at"])
        elif status == "retry_due":
            row.status = "exhausted" if row.attempts >= 3 else "retry_due"
            row.due_at = timezone.now() + timedelta(minutes=[1, 5, 15][min(row.attempts - 1, 2)])
        row.save()
        Attempt.objects.create(outbox=row, status=row.status, code=code)
        return row.status


def dispatch(pk):
    token = claim(pk)
    if token is None:
        return Outbox.objects.get(pk=pk).status
    before_dispatch(pk)
    try:
        message = prepare(pk, token)
    except Exception:
        # Preparation did not cross the external-send boundary; release the lease safely.
        with transaction.atomic():
            row = Outbox.objects.select_for_update().get(pk=pk)
            if row.status == "claimed" and row.claim == token:
                row.status = "retry_due"
                row.attempts += 1
                row.due_at = timezone.now() + timedelta(minutes=1)
                row.version += 1
                row.save()
                Attempt.objects.create(outbox=row, status=row.status, code="preparation_failed")
        return "retry_due"
    if message is None:
        return Outbox.objects.get(pk=pk).status
    try:
        if message.send() != 1:
            raise DefiniteDeliveryFailure()
    except (DefiniteDeliveryFailure, smtplib.SMTPRecipientsRefused, smtplib.SMTPSenderRefused, smtplib.SMTPDataError):
        return finish(pk, token, "retry_due", "definite_rejection")
    except Exception:
        # Timeouts/disconnects can happen after acceptance. No exception/recipient text retained.
        return finish(pk, token, "delivery_unknown", "possible_acceptance")
    return finish(
        pk, token, "smtp_accepted" if settings.ACCOUNT_EMAIL_TRANSPORT == "smtp" else "captured", "adapter_accepted"
    )


def sweep():
    now = timezone.now()
    rows = (
        Outbox.objects.filter(status__in=["queued", "retry_due", "claimed", "dispatching"], due_at__lte=now)
        .order_by("due_at", "pk")
        .values_list("pk", flat=True)[:50]
    )
    for pk in rows:
        dispatch(pk)


@transaction.atomic
def retry(actor, pk, version, reason, acknowledge):
    from apps.accounts.admin_access import permission_codes
    from apps.messaging.services import CommandConflict
    from rest_framework.exceptions import PermissionDenied, ValidationError

    access.lock_actor(actor)
    if actor.context != "owner" and (
        actor.context != "staff" or "retry_delivery" not in permission_codes(actor.account, "notifications")
    ):
        raise PermissionDenied()
    row = Outbox.objects.select_for_update().get(pk=pk)
    if row.version != version:
        raise CommandConflict()
    if row.status not in {"delivery_unknown", "exhausted"} or not acknowledge or len(reason.strip()) < 3:
        raise ValidationError({"retry": ["acknowledgement_required"]})
    AuditEvent.objects.create(
        actor=actor.user,
        account=actor.account,
        context=actor.context,
        action="message_delivery_retry",
        resource_type="notifications.outbox",
        resource_id=row.pk,
        reason=reason,
        state={"duplicate_risk_acknowledged": True, "previous_status": row.status},
    )
    row.status = "queued"
    row.attempts = 0
    row.due_at = timezone.now()
    row.version += 1
    row.save()
    return row
