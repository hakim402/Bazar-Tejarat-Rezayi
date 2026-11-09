"""Durable typed aftercare notices with bounded fan-out and one optional email.

The email body carries a generic branded authenticated link only: no amount,
reference, evidence, contact or credential appears in the body or URL."""

import hashlib
import smtplib
import uuid
from datetime import timedelta

from django.conf import settings
from django.core.exceptions import ObjectDoesNotExist
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

# Reviews reach the staff moderation queue only and never email the buyer;
# dispute activity joins the existing aftercare_email preference (CR-116/117, §4.5).
STAFF_QUEUE_ONLY = {"review_submitted"}
NO_EMAIL = {"review_submitted", "review_decided", "review_withdrawn"}
DISPUTE_ACTIONS = {"dispute_opened", "dispute_withdrawn", "dispute_response", "dispute_assigned", "dispute_decided"}

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


DISPUTE_COPY = {
    "en": (
        "Order dispute activity",
        "Your order has dispute activity. Sign in to review its current status.",
        "Review dispute",
    ),
    "fa-AF": (
        "فعالیت اختلاف سفارش",
        "سفارش شما فعالیت اختلاف دارد. برای دیدن وضعیت فعلی وارد حساب شوید.",
        "بررسی اختلاف",
    ),
    "ps": (
        "د سفارښتنې شخړې فعالیت",
        "ستاسو سفارښتنې د شخړې فعالیت لري. د اوسني حالت لپاره خپل حساب ته ننوځئ.",
        "شخړه وګورئ",
    ),
    "ar": (
        "نشاط نزاع الطلب",
        "لطلبك نشاط نزاع. سجّل الدخول لمراجعة حالته الحالية.",
        "مراجعة النزاع",
    ),
}


REPORT_COPY = {
    "en": ("Report status activity", "Your report has a status update. Sign in to review your notifications.", "Review notifications"),
    "fa-AF": ("تغییر وضعیت گزارش", "وضعیت گزارش شما تغییر کرده است. برای بررسی اطلاعیه‌ها وارد حساب شوید.", "بررسی اطلاعیه‌ها"),
    "ps": ("د راپور حالت بدلون", "ستاسو د راپور حالت بدل شوی دی. د خبرتیاوو کتلو لپاره خپل حساب ته ننوځئ.", "خبرتیاوې وګورئ"),
    "ar": ("تحديث حالة البلاغ", "تم تحديث حالة بلاغك. سجّل الدخول لمراجعة إشعاراتك.", "مراجعة الإشعارات"),
}


def report_notice_target(report):
    if report.target_kind == "message":
        return {"conversation_id": report.message.conversation_id}
    return {report.target_kind + "_id": getattr(report, report.target_kind + "_id")}


def report_recipient(report, account_id):
    """Only the fresh reporter can receive this case's status, never a counterpart."""
    from apps.messaging.access import recipient_allowed as message_allowed
    from apps.orders.access import can_receive

    account = Account.objects.select_related("user").filter(
        pk=account_id, status="active", user__is_active=True, user__email_verified=True
    ).first()
    if account is None or account.pk != report.reporter_id:
        return None
    if report.target_kind == "message":
        allowed = message_allowed(report.message.conversation, account)
    elif report.target_kind == "order":
        allowed = can_receive(report.order, account)
    else:
        # A retained product/store case remains the reporter's even if the
        # public target is later withdrawn; it grants no private target access.
        allowed = account.context == "buyer"
    return account if allowed else None


def report_identity_digest(account, report):
    from .services import identity_digest as message_digest

    if report.target_kind == "message":
        return message_digest(account, report.message.conversation)
    if report.target_kind == "order":
        return identity_digest(account, report.order)
    return message_digest(account)


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
    qs = (
        Account.objects.none()
        if event.aftercare_event_id and event.aftercare_event.action in STAFF_QUEUE_ONLY
        else recipients(order, cursor.sender_id)
    )
    if cursor.after_account:
        qs = qs.filter(pk__gt=cursor.after_account)
    batch = list(qs[:101])
    for account in batch[:100]:
        Notice.objects.get_or_create(event=event, account=account, defaults={"aftercare_order": order})
        if event.aftercare_event_id and event.aftercare_event.action in NO_EMAIL:
            continue
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


def rendered(account, order, locale, action=None, *, source_event=None):
    catalogue = REPORT_COPY if action == "report_status" else DISPUTE_COPY if action in DISPUTE_ACTIONS else COPY
    locale = locale if locale in catalogue else "fa-AF"
    title, text, cta = catalogue[locale]
    brand = BRAND[locale]["brand"]
    if action == "report_status":
        path = "notifications"
    elif action in DISPUTE_ACTIONS:
        path = "disputes"
        # Dispute detail routes own a dispute UUID, not the order UUID. Some
        # retained actions (assignment/withdrawal) have no direct child relation.
        if source_event is not None:
            try:
                dispute_id = source_event.dispute.pk
            except ObjectDoesNotExist:
                try:
                    dispute_id = source_event.dispute_response.dispute_id
                except ObjectDoesNotExist:
                    try:
                        dispute_id = source_event.disputedecision.dispute_id
                    except ObjectDoesNotExist:
                        dispute_id = None
            if dispute_id:
                path += f"/{dispute_id}"
    else:
        path = f"{'cancellations' if account.context == 'buyer' else 'aftercare'}/{order.pk}"
    url = f"{settings.FRONTEND_ORIGIN}/{locale}/account/{account.context}/{path}"
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
    related = ("order__seller", "report__order__seller", "report__message__conversation__seller")
    preliminary = AftercareEmail.objects.select_related(*related).get(pk=pk)
    if preliminary.order_id:
        profile_id = preliminary.order.seller_id
    elif preliminary.report.target_kind == "order":
        profile_id = preliminary.report.order.seller_id
    elif preliminary.report.target_kind == "message":
        profile_id = preliminary.report.message.conversation.seller_id
    else:
        profile_id = None
    if profile_id:
        BusinessProfile.objects.select_for_update().get(pk=profile_id)
    row = AftercareEmail.objects.select_for_update().select_related(*related).get(pk=pk)
    if row.status != "claimed" or row.lease != token or row.lease_until is None or row.lease_until <= timezone.now():
        return None
    account = (
        Account.objects.select_for_update()
        .select_related("user")
        .filter(pk=row.account_id, status="active", user__is_active=True, user__email_verified=True)
        .first()
    )
    preference = Preference.objects.select_for_update().filter(account_id=row.account_id).first()
    notices = Notice.objects.filter(event_id=row.episode, account_id=row.account_id, read_at__isnull=True)
    if row.report_id:
        allowed = report_recipient(row.report, row.account_id) is not None
        fingerprint = report_identity_digest(account, row.report) if account else None
        notices = notices.filter(event__kind="report_status", event__report_id=row.report_id, **report_notice_target(row.report))
    else:
        allowed = account is not None and recipient_allowed(row.order, account)
        fingerprint = identity_digest(account, row.order) if account else None
        notices = notices.filter(event__kind="aftercare", aftercare_order_id=row.order_id)
    if (
        account is None
        or not allowed
        or row.identity_digest != fingerprint
        or preference is not None
        and not preference.aftercare_email
        or not notices.exists()
    ):
        row.status = "cancelled"
        row.version += 1
        row.save()
        AftercareEmailAttempt.objects.create(email=row, status=row.status, code="no_longer_eligible")
        return None
    # Several episodes can be queued before the first send. Recheck the shared
    # per-account cooldown under the account lock, not only at enqueue time.
    last = AftercareEmail.objects.filter(
        account=account, status__in={"captured", "smtp_accepted"}, accepted_at__isnull=False
    ).order_by("-accepted_at").first()
    if last and last.accepted_at + timedelta(minutes=15) > timezone.now():
        row.status = "retry_due"
        row.due_at = last.accepted_at + timedelta(minutes=15)
        row.version += 1
        row.save()
        return None
    locale = preference.locale if preference and preference.locale in COPY else "fa-AF"
    event = Event.objects.select_related("aftercare_event").get(pk=row.episode)
    source_event = event.aftercare_event if event.aftercare_event_id else None
    action = "report_status" if row.report_id else source_event.action if source_event else None
    message = assemble_message(
        rendered(account, row.order, locale, action, source_event=source_event), account.user.email, locale
    )
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
