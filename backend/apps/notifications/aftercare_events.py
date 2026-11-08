"""Durable typed aftercare notices with bounded fan-out and one optional email.

The email body carries a generic branded authenticated link only: no amount,
reference, evidence, contact or credential appears in the body or URL."""

import hashlib
import smtplib
import uuid
from datetime import timedelta

from django.conf import settings
from django.core.mail import get_connection
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from django.utils.html import escape

from apps.accounts.delivery import assemble_message
from apps.accounts.email_copy import COPY as BRAND
from apps.accounts.models import Account
from apps.notifications.delivery import DefiniteDeliveryFailure
from apps.organizations.models import BusinessProfile, Membership
from .models import AftercareEmail, AftercareEmailAttempt, AftercareNoticeCursor, Event, Notice, Preference

TERMINAL = {"captured", "smtp_accepted", "cancelled", "exhausted", "delivery_unknown"}
COPY = {
    "en": (
        "Order aftercare activity",
        "Your order has cancellation, amendment or refund activity. Sign in to review its current status.",
        "Review order care",
    ),
    "fa-AF": (
        "فعالیت پس از فروش سفارش",
        "سفارش شما فعالیت لغو، اصلاح یا بازپرداخت دارد. برای دیدن وضعیت فعلی وارد حساب شوید.",
        "بررسی سفارش",
    ),
    "ps": (
        "د سفارښتنې وروسته فعالیت",
        "ستاسو سفارښتنې د لغوه کولو، تعدیل یا بیرته تادیې فعالیت لري. د اوسني حالت لپاره خپل حساب ته ننوځئ.",
        "سفارښتنه وګورئ",
    ),
    "ar": (
        "نشاط ما بعد الطلب",
        "لطلبك نشاط إلغاء أو تعديل أو استرداد. سجّل الدخول لمراجعة حالته الحالية.",
        "مراجعة الطلب",
    ),
}


def enqueue_safely():
    from apps.runtime.jobs import enqueue
    from django.db import DatabaseError

    try:
        enqueue("aftercare_sweep")
    except DatabaseError:
        pass


def recipients(order, sender_id=None):
    member = (
        Membership.objects.filter(company_id=order.seller_id, active=True)
        .filter(Q(is_owner=True) | Q(bundles__contains=["orders_negotiation"]) | Q(bundles__contains=["payments_refunds"]))
        .values("account_id")
    )
    seller = (
        Q(pk__in=member, context="seller")
        if order.seller.kind == "company"
        else Q(pk=order.seller.account_id, context="seller")
    )
    qs = (
        Account.objects.filter(Q(pk=order.buyer_id) | seller, status="active", user__is_active=True, user__email_verified=True)
        .select_related("user")
        .order_by("pk")
    )
    return qs.exclude(user_id=sender_id) if sender_id else qs


def publish(order, *, aftercare_event=None, payment_event=None, fulfilment_event=None, sender_user=None):
    event = Event.objects.create(
        kind="aftercare",
        aftercare_event=aftercare_event,
        payment_event=payment_event,
        fulfilment_event=fulfilment_event,
    )
    AftercareNoticeCursor.objects.create(event=event, sender=sender_user)
    enqueue_safely()
    return event


def identity_digest(account, order):
    return hashlib.sha256(
        f"{account.pk}:{account.user.email}:{account.user.credential_epoch}:{account.access_epoch}:{order.seller.version}".encode()
    ).hexdigest()


def recipient_allowed(order, account):
    account = (
        Account.objects.select_related("user")
        .filter(pk=account.pk, status="active", user__is_active=True, user__email_verified=True)
        .first()
    )
    if not account:
        return False
    if account.context == "buyer" and account.pk == order.buyer_id:
        return True
    if account.context != "seller":
        return False
    member = Membership.objects.filter(company_id=order.seller_id, account=account, active=True).filter(
        Q(is_owner=True) | Q(bundles__contains=["orders_negotiation"]) | Q(bundles__contains=["payments_refunds"])
    )
    return order.seller.kind == "individual" and order.seller.account_id == account.pk or member.exists()


def email_due(account):
    last = (
        AftercareEmail.objects.filter(account=account, status__in={"captured", "smtp_accepted"})
        .order_by("-accepted_at")
        .first()
    )
    now = timezone.now()
    due = now + timedelta(seconds=60)
    if last and last.accepted_at:
        due = max(due, last.accepted_at + timedelta(minutes=15))
    return due


@transaction.atomic
def fanout(pk):
    preliminary = AftercareNoticeCursor.objects.select_related(
        "event__aftercare_event__order", "event__payment_event__order", "event__fulfilment_event__order"
    ).get(pk=pk)
    event = preliminary.event
    order = (
        event.aftercare_event.order
        if event.aftercare_event_id
        else event.payment_event.order
        if event.payment_event_id
        else event.fulfilment_event.order
    )
    BusinessProfile.objects.select_for_update().get(pk=order.seller_id)
    cursor = AftercareNoticeCursor.objects.select_for_update(skip_locked=True).filter(pk=pk, complete=False).first()
    if cursor is None:
        return
    qs = recipients(order, cursor.sender_id)
    if cursor.after_account:
        qs = qs.filter(pk__gt=cursor.after_account)
    batch = list(qs[:101])
    for account in batch[:100]:
        Notice.objects.get_or_create(event=event, account=account, defaults={"aftercare_order": order})
        preference = Preference.objects.filter(account=account).first()
        if preference is None or preference.aftercare_email:
            AftercareEmail.objects.get_or_create(
                order=order,
                account=account,
                episode=event.pk,
                defaults={"identity_digest": identity_digest(account, order), "due_at": email_due(account)},
            )
    if batch:
        cursor.after_account = batch[min(99, len(batch) - 1)].pk
    cursor.complete = len(batch) <= 100
    cursor.version += 1
    cursor.save()


def sweep_notices():
    for pk in list(
        AftercareNoticeCursor.objects.filter(complete=False).order_by("pk").values_list("pk", flat=True)[:10]
    ):
        fanout(pk)


def rendered(account, order, locale):
    locale = locale if locale in COPY else "fa-AF"
    title, text, cta = COPY[locale]
    brand = BRAND[locale]["brand"]
    if account.context == "buyer":
        url = f"{settings.FRONTEND_ORIGIN}/{locale}/account/buyer/cancellations/{order.pk}"
    else:
        url = f"{settings.FRONTEND_ORIGIN}/{locale}/account/seller/aftercare/{order.pk}"
    plain = f"{brand}\n\n{title}\n{text}\n{url}"
    html = f'<html lang="{locale}" dir="{"ltr" if locale == "en" else "rtl"}"><body style="font-family:sans-serif"><img src="cid:rezayi-brand" alt="{escape(brand)}" width="180"><h1>{escape(title)}</h1><p>{escape(text)}</p><a href="{escape(url)}">{escape(cta)}</a></body></html>'
    return f"{brand} — {title}", plain, html


def before_dispatch(_pk):
    return None


@transaction.atomic
def claim(pk):
    row = AftercareEmail.objects.select_for_update().get(pk=pk)
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
            AftercareEmailAttempt.objects.create(email=row, status=row.status, code="expired_dispatch_lease")
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


@transaction.atomic
def prepare(pk, token):
    row = AftercareEmail.objects.select_for_update().select_related("order__seller").get(pk=pk)
    if row.status != "claimed" or row.lease != token:
        return None
    account = (
        Account.objects.select_for_update()
        .select_related("user")
        .filter(pk=row.account_id, status="active", user__is_active=True, user__email_verified=True)
        .first()
    )
    preference = Preference.objects.select_for_update().filter(account_id=row.account_id).first()
    unread = Notice.objects.filter(event_id=row.episode, account_id=row.account_id, read_at__isnull=True).exists()
    if (
        account is None
        or not recipient_allowed(row.order, account)
        or row.identity_digest != identity_digest(account, row.order)
        or preference is not None
        and not preference.aftercare_email
        or not unread
    ):
        row.status = "cancelled"
        row.version += 1
        row.save()
        AftercareEmailAttempt.objects.create(email=row, status=row.status, code="no_longer_eligible")
        return None
    locale = preference.locale if preference and preference.locale in COPY else "fa-AF"
    message = assemble_message(rendered(account, row.order, locale), account.user.email, locale)
    message.connection = get_connection(timeout=2)
    message.extra_headers = {"Message-ID": f"<aftercare-activity-{row.pk}@notifications.rezayi.invalid>"}
    row.status = "dispatching"
    row.attempts += 1
    row.version += 1
    row.save()
    return message


@transaction.atomic
def finish(pk, token, status, code):
    row = AftercareEmail.objects.select_for_update().get(pk=pk)
    if row.lease != token or row.status != "dispatching":
        return row.status
    row.status = "exhausted" if status == "retry_due" and row.attempts >= 3 else status
    if row.status == "retry_due":
        row.due_at = timezone.now() + timedelta(minutes=[1, 5, 15][min(row.attempts - 1, 2)])
    if row.status in {"captured", "smtp_accepted"}:
        row.accepted_at = timezone.now()
    row.version += 1
    row.save()
    AftercareEmailAttempt.objects.create(email=row, status=row.status, code=code)
    return row.status


def dispatch(pk):
    token = claim(pk)
    if token is None:
        return AftercareEmail.objects.get(pk=pk).status
    before_dispatch(pk)
    try:
        message = prepare(pk, token)
    except Exception:
        with transaction.atomic():
            row = AftercareEmail.objects.select_for_update().get(pk=pk)
            if row.status == "claimed" and row.lease == token:
                row.attempts += 1
                row.status = "exhausted" if row.attempts >= 3 else "retry_due"
                row.due_at = timezone.now() + timedelta(minutes=1)
                row.version += 1
                row.save()
                AftercareEmailAttempt.objects.create(email=row, status=row.status, code="preparation_failed")
        return "retry_due"
    if message is None:
        return AftercareEmail.objects.get(pk=pk).status
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


def sweep():
    sweep_notices()
    pk = (
        AftercareEmail.objects.filter(status__in=["queued", "retry_due", "claimed", "dispatching"], due_at__lte=timezone.now())
        .order_by("due_at", "pk")
        .values_list("pk", flat=True)
        .first()
    )
    if pk:
        dispatch(pk)
