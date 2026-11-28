"""Review decisions use the notification API and its existing scheduled mail sweep."""
from datetime import timedelta
import smtplib

from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from apps.accounts.models import Account, AuditEvent
from apps.accounts.services.delivery import assemble_message
from .models import Preference, ReviewNotice
from .services import identity_digest, enqueue_safely


def scope(actor, seller=None):
    account = actor.account
    company_ids = account.memberships.filter(active=True, is_owner=True).values("company_id")
    # Individual/business applicants own their records; company applicants must
    # retain owner authority when a notification or email is disclosed.
    owned = Q(account_id=account.pk, kind__in=["individual", "business"]) | Q(pk__in=company_ids)
    from apps.organizations.models import BusinessProfile
    profiles = BusinessProfile.objects.filter(owned)
    if seller:
        profiles = profiles.filter(pk=seller)
    return ReviewNotice.objects.filter(account=account).filter(
        Q(verification_case__profile__in=profiles) | Q(source_revision__product__seller__in=profiles)
    )


def decision_notice(resource, decision):
    if decision not in {"approved", "rejected"}:
        return
    is_business = resource._meta.label_lower == "verification.reviewcase"
    profile = resource.profile if is_business else resource.product.seller
    account = profile.account
    if is_business:
        submission = AuditEvent.objects.filter(
            resource_type="verification.reviewcase", resource_id=resource.pk,
            action="verification_submit", context__in=["seller", "buyer"],
        ).order_by("-created_at").first()
        if submission and submission.account_id:
            account = submission.account
    else:
        account = Account.objects.filter(user_id=resource.author_id, context="seller").first()
    if not account:
        return
    target = {"verification_case": resource} if is_business else {"source_revision": resource}
    ReviewNotice.objects.get_or_create(
        **target, defaults={"account": account, "decision": decision, "identity_digest": identity_digest(account)}
    )
    transaction.on_commit(enqueue_safely)


def projection(row):
    business = row.verification_case_id is not None
    resource = row.verification_case if business else row.source_revision
    profile_id = resource.profile_id if business else resource.product.seller_id
    return dict(
        id=str(row.pk), kind="business_review" if business else "product_review",
        action=row.decision, profile=str(profile_id),
        revision=resource.revision if business else resource.number,
        reason=resource.reason, title=resource.snapshot.get("display_name", "") if business else resource.body.get("title", ""),
        fulfilment=None, payment=None, aftercare=None, negotiation=None,
        conversation=None, order=None, invoice=None,
        product=None if business else str(resource.product_id), store=None, report=None,
        seller=str(profile_id) if row.account.context == "seller" else None,
        read=row.read_at is not None, created_at=row.created_at,
    )


COPY = {
    "en": {
        "business": "Business profile review", "product": "Product review",
        "approved": "Your changes were approved and are now active.",
        "rejected": "Your changes were not approved. Your previously approved details remain active, if available. Review the reason and submit a corrected revision.",
        "open": "Open your submission", "reason": "Review reason",
    },
    "fa-AF": {
        "business": "بررسی مشخصات کسب و کار", "product": "بررسی محصول",
        "approved": "تغییرات شما تایید شد و اکنون فعال است.",
        "rejected": "تغییرات شما تایید نشد. اطلاعاتی که قبلاً تایید شده است، در صورت موجود بودن، فعال می‌ماند. دلیل را بررسی کرده و نسخه اصلاح شده را ارسال کنید.",
        "open": "مشاهده درخواست", "reason": "دلیل بررسی",
    },
    "ps": {
        "business": "د سوداګریز پروفایل کتنه", "product": "د محصول کتنه",
        "approved": "ستاسو بدلونونه تایید شول او اوس فعال دي.",
        "rejected": "ستاسو بدلونونه تایید نه شول. پخواني تایید شوي معلومات، که موجود وي، فعال پاتې کېږي. دلیل وګورئ او سم شوی بیاکتون واستوئ.",
        "open": "خپله غوښتنه پرانیزئ", "reason": "د کتنې دلیل",
    },
    "ar": {
        "business": "مراجعة الملف التجاري", "product": "مراجعة المنتج",
        "approved": "تمت الموافقة على تغييراتك وهي فعالة الآن.",
        "rejected": "لم تتم الموافقة على تغييراتك. تبقى التفاصيل المعتمدة سابقاً فعالة إن وجدت. راجع السبب وأرسل نسخة مصححة.",
        "open": "افتح طلبك", "reason": "سبب المراجعة",
    },
}


def destination(row, locale):
    context = row.account.context
    if row.verification_case_id:
        return f"/{locale}/account/{context}/organizations/{row.verification_case.profile_id}"
    return f"/{locale}/account/seller/catalogue/{row.source_revision.product_id}"


def dispatch(pk):
    from types import SimpleNamespace
    with transaction.atomic():
        row = ReviewNotice.objects.select_for_update().select_related(
            "account__user", "verification_case", "source_revision__product"
        ).get(pk=pk)
        now = timezone.now()
        if row.email_status == "dispatching":
            row.email_status = "delivery_unknown"
            row.save(update_fields=["email_status"])
            return
        if row.email_status not in {"queued", "retry_due"} or row.next_attempt_at > now:
            return
        account = row.account
        actor = SimpleNamespace(account=account)
        if (
            account.status != "active" or not account.user.is_active or not account.user.email_verified
            or row.identity_digest != identity_digest(account) or not scope(actor).filter(pk=pk).exists()
        ):
            row.email_status = "cancelled"
            row.save(update_fields=["email_status"])
            return
        preference = Preference.objects.filter(account=account).first()
        locale = preference.locale if preference else account.user.preferred_locale
        locale = locale if locale in COPY else "fa-AF"
        t = COPY[locale]
        data = projection(row)
        title = t["business" if row.verification_case_id else "product"]
        text = "\n".join([title, data["title"], t[row.decision], t["reason"], data["reason"], settings.FRONTEND_ORIGIN + destination(row, locale)])
        from django.utils.html import format_html
        html = format_html(
            '<div lang="{}" dir="{}"><h1>{}</h1><p>{}</p><p>{}</p><p>{}</p><a href="{}">{}</a></div>',
            locale, "ltr" if locale == "en" else "rtl", title, data["title"], t[row.decision], data["reason"],
            settings.FRONTEND_ORIGIN + destination(row, locale), t["open"],
        )
        message = assemble_message((title, text, html), account.user.email, locale)
        row.email_status = "dispatching"
        row.email_attempts += 1
        row.next_attempt_at = now + timedelta(minutes=10)
        row.save(update_fields=["email_status", "email_attempts", "next_attempt_at"])
    try:
        delivered = message.send(fail_silently=False)
    except (smtplib.SMTPRecipientsRefused, smtplib.SMTPSenderRefused, smtplib.SMTPDataError):
        ReviewNotice.objects.filter(pk=pk, email_status="dispatching").update(
            email_status="retry_due" if row.email_attempts < 5 else "exhausted",
            next_attempt_at=timezone.now() + timedelta(minutes=5),
        )
    except Exception:
        # A disconnect may follow SMTP acceptance. Keep this visible for admin
        # reconciliation rather than silently delivering duplicate decision mail.
        ReviewNotice.objects.filter(pk=pk, email_status="dispatching").update(email_status="delivery_unknown")
    else:
        ReviewNotice.objects.filter(pk=pk, email_status="dispatching").update(
            email_status="sent" if delivered else "retry_due" if row.email_attempts < 5 else "exhausted",
            next_attempt_at=timezone.now() + timedelta(minutes=5),
        )


def sweep():
    now = timezone.now()
    for pk in ReviewNotice.objects.filter(email_status__in=["queued", "retry_due", "dispatching"], next_attempt_at__lte=now).values_list("pk", flat=True)[:50]:
        dispatch(pk)
