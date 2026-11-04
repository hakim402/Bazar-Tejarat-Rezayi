"""Narrow overdue-email outbox; conversations/unread episodes stay unchanged."""

import uuid
import smtplib
from datetime import timedelta
from django.conf import settings
from django.core.mail import get_connection
from django.db import transaction
from django.utils import timezone
from django.utils.html import escape
from apps.accounts.models import Account, User
from apps.accounts.delivery import assemble_message
from apps.accounts.email_copy import COPY as BRAND
from apps.notifications.models import Preference
from apps.notifications.delivery import DefiniteDeliveryFailure
from apps.organizations.models import BusinessProfile
from .models import Email, EmailAttempt, Finance
from . import access

TERMINAL = {"captured", "smtp_accepted", "cancelled", "exhausted", "delivery_unknown"}
COPY = {
    "en": (
        "Goods payment review",
        "Your goods order has payment activity requiring attention. Sign in to review its current status.",
        "Review payments",
    ),
    "fa-AF": (
        "بررسی پرداخت کالا",
        "پرداخت سفارش کالای شما نیاز به توجه دارد. برای دیدن وضعیت فعلی وارد حساب شوید.",
        "بررسی پرداخت‌ها",
    ),
    "ps": (
        "د توکو د تادیې کتنه",
        "ستاسو د توکو د سپارښتنې تادیه پاملرنې ته اړتیا لري. د اوسني حالت لپاره خپل حساب ته ننوځئ.",
        "تادیې وګورئ",
    ),
    "ar": (
        "مراجعة دفع البضائع",
        "تحتاج حالة دفع طلب البضائع إلى انتباهك. سجّل الدخول لمراجعة الحالة الحالية.",
        "مراجعة المدفوعات",
    ),
}


def rendered(account, order, locale):
    locale = locale if locale in COPY else "fa-AF"
    title, text, cta = COPY[locale]
    brand = BRAND[locale]["brand"]
    suffix = f"?seller={order.seller_id}" if account.context == "seller" else ""
    url = f"{settings.FRONTEND_ORIGIN}/{locale}/account/{account.context}/payments/{order.pk}{suffix}"
    plain = f"{brand}\n\n{title}\n{text}\n{url}"
    html = f'<html lang="{locale}" dir="{"ltr" if locale == "en" else "rtl"}"><body><img src="cid:rezayi-brand" alt="{escape(brand)}" width="180"><h1>{escape(title)}</h1><p>{escape(text)}</p><a href="{escape(url)}">{escape(cta)}</a></body></html>'
    return f"{brand} — {title}", plain, html


def before_dispatch(_pk):
    return None


@transaction.atomic
def claim(pk):
    row = Email.objects.select_for_update().get(pk=pk)
    now = timezone.now()
    if row.status in TERMINAL or row.due_at > now:
        return None
    if row.status in {"claimed", "dispatching"}:
        if row.lease_until and row.lease_until > now:
            return None
        if row.status == "dispatching":
            row.status = "delivery_unknown"
            row.version += 1
            row.save()
            EmailAttempt.objects.create(email=row, status=row.status, code="expired_dispatch_lease")
            return None
    if row.attempts >= 3:
        row.status = "exhausted"
        row.version += 1
        row.save()
        return None
    row.status = "claimed"
    row.lease = uuid.uuid4()
    row.lease_until = now + timedelta(minutes=2)
    row.version += 1
    row.save()
    return row.lease


def prepare(pk, token):
    from .jobs import current_reminder, identity_digest

    initial = Email.objects.select_related("order").get(pk=pk)
    with transaction.atomic():
        BusinessProfile.objects.select_for_update().get(pk=initial.order.seller_id)
        user_id = Account.objects.values_list("user_id", flat=True).get(pk=initial.account_id)
        User.objects.select_for_update().get(pk=user_id)
        account = Account.objects.select_for_update().select_related("user").get(pk=initial.account_id)
        Finance.objects.select_for_update().get(order_id=initial.order_id)
        row = Email.objects.select_for_update().select_related("order__seller").get(pk=pk)
        if row.status != "claimed" or row.lease != token:
            return None
        pref = Preference.objects.filter(account=account).first()
        if (
            not access.recipient_allowed(row.order, account)
            or row.identity_digest != identity_digest(account, row.order)
            or pref is not None
            and not pref.payment_email
            or not current_reminder(row.order, row.generation, row.slot)
        ):
            row.status = "cancelled"
            row.version += 1
            row.save()
            EmailAttempt.objects.create(email=row, status=row.status, code="no_longer_eligible")
            return None
        locale = pref.locale if pref else "fa-AF"
        message = assemble_message(rendered(account, row.order, locale), account.user.email, locale)
        # Existing backend/capture adapter, bounded independently of HTTP.
        message.connection = get_connection(timeout=2)
        message.extra_headers = {"Message-ID": f"<goods-review-{row.pk}@notifications.rezayi.invalid>"}
        row.status = "dispatching"
        row.attempts += 1
        row.version += 1
        row.save()
        return message


@transaction.atomic
def finish(pk, token, status, code):
    row = Email.objects.select_for_update().get(pk=pk)
    if row.lease != token or row.status != "dispatching":
        return row.status
    row.status = "exhausted" if status == "retry_due" and row.attempts >= 3 else status
    if row.status == "retry_due":
        row.due_at = timezone.now() + timedelta(minutes=[1, 5, 15][min(row.attempts - 1, 2)])
    row.version += 1
    row.save()
    EmailAttempt.objects.create(email=row, status=row.status, code=code)
    return row.status


def dispatch(pk):
    token = claim(pk)
    if token is None:
        return Email.objects.get(pk=pk).status
    before_dispatch(pk)
    try:
        message = prepare(pk, token)
    except Exception:
        with transaction.atomic():
            row = Email.objects.select_for_update().get(pk=pk)
            if row.status == "claimed" and row.lease == token:
                row.attempts += 1
                row.status = "exhausted" if row.attempts >= 3 else "retry_due"
                row.due_at = timezone.now() + timedelta(minutes=1)
                row.version += 1
                row.save()
                EmailAttempt.objects.create(email=row, status=row.status, code="preparation_failed")
        return "retry_due"
    if message is None:
        return Email.objects.get(pk=pk).status
    try:
        if message.send() != 1:
            raise DefiniteDeliveryFailure()
    except (DefiniteDeliveryFailure, smtplib.SMTPRecipientsRefused, smtplib.SMTPSenderRefused, smtplib.SMTPDataError):
        return finish(pk, token, "retry_due", "definite_rejection")
    except Exception:
        return finish(pk, token, "delivery_unknown", "possible_acceptance")
    return finish(
        pk, token, "smtp_accepted" if settings.ACCOUNT_EMAIL_TRANSPORT == "smtp" else "captured", "adapter_accepted"
    )
