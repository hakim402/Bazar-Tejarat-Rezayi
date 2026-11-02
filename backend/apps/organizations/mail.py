"""Company invitation adapter reusing encrypted account outbox/rendering infrastructure."""

import smtplib
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.template.loader import render_to_string
from django.utils import timezone

from apps.accounts.delivery import assemble_message, reveal
from apps.accounts.email_copy import COPY as BRAND_COPY
from .models import InvitationMail

COPY = {
    "en": (
        "Company invitation",
        "You have been invited to join a company team. Sign in with the invited account, review the permissions and accept explicitly.",
        "Review invitation",
        "This invitation expires in 7 days. Joining does not grant ownership or platform administration.",
    ),
    "fa-AF": (
        "دعوت به تیم شرکت",
        "برای پیوستن به تیم شرکت دعوت شده‌اید. با حساب دعوت‌شده وارد شوید، صلاحیت‌ها را بررسی کنید و دعوت را بپذیرید.",
        "بررسی دعوت",
        "این دعوت پس از ۷ روز منقضی می‌شود. پیوستن به تیم، مالکیت یا صلاحیت مدیریت بازار را نمی‌دهد.",
    ),
    "ps": (
        "د شرکت ډلې ته بلنه",
        "تاسو د شرکت ډلې ته بلل شوي یاست. په بلل شوي حساب ننوځئ، واکونه وګورئ او بلنه په خپله ومنئ.",
        "بلنه وګورئ",
        "دا بلنه له ۷ ورځو وروسته پای ته رسېږي. غړیتوب د مالکیت یا د بازار د ادارې واک نه ورکوي.",
    ),
    "ar": (
        "دعوة إلى فريق الشركة",
        "تمت دعوتك للانضمام إلى فريق شركة. سجّل الدخول بالحساب المدعو وراجع الصلاحيات ثم اقبل الدعوة صراحةً.",
        "مراجعة الدعوة",
        "تنتهي الدعوة بعد ٧ أيام. الانضمام لا يمنح الملكية أو صلاحيات إدارة المنصة.",
    ),
}


def invitation_message(invitation, raw):
    locale = invitation.locale if invitation.locale in COPY else "fa-AF"
    title, body, cta, expiry = COPY[locale]
    url = f"{settings.FRONTEND_ORIGIN}/{locale}/invitation#token={raw}"
    context = dict(
        BRAND_COPY[locale],
        locale=locale,
        direction="ltr" if locale == "en" else "rtl",
        name="",
        title=title,
        preheader=body,
        instructions=body,
        cta=cta,
        expiry=expiry,
        url=url,
    )
    rendered = (
        f"{BRAND_COPY[locale]['brand']} — {title}",
        render_to_string("accounts/email/action.txt", context),
        render_to_string("accounts/email/action.html", context),
    )
    return assemble_message(rendered, invitation.email, locale)


def dispatch_invitation(pk):
    from .access import company_lock

    with transaction.atomic():
        preliminary = InvitationMail.objects.select_related("invitation").get(pk=pk)
        company_lock(preliminary.invitation.company_id)
        item = InvitationMail.objects.select_for_update().select_related("invitation").get(pk=pk)
        invite = item.invitation
        now = timezone.now()
        if item.status == "dispatching":
            if item.next_attempt_at <= now:
                item.status = "delivery_unknown"
                item.save(update_fields=["status"])
            return item.status
        if item.status not in {"queued", "delivery_failed"} or item.next_attempt_at > now:
            return item.status
        if invite.status != "pending" or invite.version != item.invitation_version or invite.expires_at <= now:
            item.status, item.encrypted_payload = "expired", ""
            item.save()
            return item.status
        if item.attempts >= 3:
            item.status, item.encrypted_payload = "exhausted", ""
            item.save()
            return item.status
        message = invitation_message(invite, reveal(item.encrypted_payload)["token"])
        item.attempts += 1
        attempt = item.attempts
        item.status, item.next_attempt_at = "dispatching", now + timedelta(seconds=90)
        item.save()
    try:
        accepted = message.send() == 1
        status = ("smtp_accepted" if settings.ACCOUNT_EMAIL_TRANSPORT == "smtp" else "captured") if accepted else "delivery_failed"
    except (smtplib.SMTPRecipientsRefused, smtplib.SMTPSenderRefused, smtplib.SMTPDataError):
        status = "delivery_failed"
    except Exception:
        status = "delivery_unknown"
    with transaction.atomic():
        company_lock(invite.company_id)
        item = InvitationMail.objects.select_for_update().get(pk=pk)
        if item.status != "dispatching" or item.attempts != attempt:
            return item.status
        item.status = status
        if status in {"smtp_accepted", "captured"}:
            item.encrypted_payload = ""
        elif status == "delivery_failed":
            item.next_attempt_at = timezone.now() + timedelta(seconds=60 * attempt)
        item.save()
        return status


def sweep_invitations():
    InvitationMail.objects.filter(invitation__expires_at__lte=timezone.now()).exclude(encrypted_payload="").update(
        encrypted_payload="", status="expired"
    )
    for pk in InvitationMail.objects.filter(
        status__in=["queued", "delivery_failed", "dispatching"], next_attempt_at__lte=timezone.now()
    ).values_list("pk", flat=True)[:50]:
        dispatch_invitation(pk)
