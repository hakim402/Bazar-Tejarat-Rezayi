import base64
import hashlib
import hmac
import secrets
import time
from datetime import timedelta
from urllib.parse import quote

from django.conf import settings
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.hashers import make_password
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from django.middleware.csrf import rotate_token
from django.utils import timezone
from django_otp import login as otp_login
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError

from .models import (
    Account,
    ActionToken,
    AuditEvent,
    Authenticator,
    BrowserAuthority,
    ContextGrant,
    RateBucket,
    RecoveryCode,
    User,
    normalize_email,
)


class AuthFailure(APIException):
    status_code = 403
    default_detail = "Access could not be verified."
    default_code = "access_denied"


class TooManyRequests(APIException):
    status_code = 429
    default_detail = "Too many attempts. Please try again later."
    default_code = "rate_limited"


def audit(action, *, request=None, user=None, account=None, context="system", fields=()):
    actor = getattr(request, "user", None)
    if account is None and user is not None and context in {"buyer", "seller", "staff"}:
        account = Account.objects.filter(user=user, context=context).first()
    AuditEvent.objects.create(
        actor=actor if getattr(actor, "is_authenticated", False) else user,
        subject=user,
        account=account,
        context=context,
        action=action,
        request_id=getattr(request, "request_id", None),
        changed_fields=list(fields),
    )


def rate_limit(request, scope, *, identity="", limit=20, seconds=900):
    # The IP is not accepted from proxy headers. Identifiers are keyed hashes, never raw addresses/email.
    for suffix, value, maximum in [
        ("ip", request.META.get("REMOTE_ADDR", "unknown"), limit * 3),
        ("identity", identity, limit),
    ]:
        if not value:
            continue
        key = hmac.new(settings.SECRET_KEY.encode(), f"{scope}:{suffix}:{value}".encode(), hashlib.sha256).hexdigest()
        with transaction.atomic():
            try:
                with transaction.atomic():
                    RateBucket.objects.get_or_create(
                        key=key, defaults={"expires_at": timezone.now() + timedelta(seconds=seconds)}
                    )
            except IntegrityError:
                pass
            bucket = RateBucket.objects.select_for_update().get(key=key)
            if bucket.expires_at <= timezone.now():
                bucket.count = 0
                bucket.expires_at = timezone.now() + timedelta(seconds=seconds)
            bucket.count += 1
            bucket.save(update_fields=["count", "expires_at"])
            denied = bucket.count > maximum
        if denied:
            raise TooManyRequests()


def password_check(value, user):
    try:
        validate_password(value, user=user)
    except DjangoValidationError:
        raise ValidationError({"password": ["Use a stronger password of at least 12 characters."]}) from None


def credential_state(user):
    return hmac.new(
        settings.SECRET_KEY.encode(),
        f"{user.pk}:{user.email}:{user.password}:{user.email_verified}:{user.credential_epoch}".encode(),
        hashlib.sha256,
    ).hexdigest()


def request_mail(user, purpose, locale="fa-AF"):
    from .delivery import queue_account_mail

    return queue_account_mail(user, purpose, locale)


def consume_token(raw, purpose, *, password=None, request=None):
    digest = hashlib.sha256(raw.encode()).hexdigest()
    candidate = ActionToken.objects.filter(digest=digest, purpose=purpose).values_list("user_id", flat=True).first()
    if not candidate:
        raise ValidationError({"token": ["This link is invalid, expired or already used."]})
    with transaction.atomic():
        user = User.objects.select_for_update().get(pk=candidate)
        token = ActionToken.objects.select_for_update().get(digest=digest, purpose=purpose)
        if (
            token.used_at
            or token.expires_at <= timezone.now()
            or not user.is_active
            or not hmac.compare_digest(token.credential_state, credential_state(user))
        ):
            raise ValidationError({"token": ["This link is invalid, expired or already used."]})
        if purpose == "reset":
            password_check(password, user)
            user.set_password(password)
            user.email_verified = (
                True  # Recovery proves mailbox ownership, including unverified-registration collisions.
            )
            user.credential_epoch += 1
        else:
            user.email_verified = True
        user.save()
        token.used_at = timezone.now()
        token.save(update_fields=["used_at"])
        audit("password_reset" if purpose == "reset" else "email_verified", request=request, user=user)
    if purpose == "reset" and request is not None:
        logout(request)


def owner_mfa_required():
    return settings.PRODUCTION or settings.OWNER_MFA_REQUIRED


def get_grant(request, context):
    user = request.user
    grant = request.session.get("grants", {}).get(context, {})
    max_age = 3600 if context in {"staff", "owner"} else 28800
    if (
        not user.is_authenticated
        or not user.is_active
        or not user.email_verified
        or not ContextGrant.objects.filter(
            pk=grant.get("grant_id"),
            authority_id=request.session.get("authority"),
            authority__user=user,
            authority__revoked=False,
            context=context,
            revoked=False,
        ).exists()
        or grant.get("identity") != str(user.pk)
        or grant.get("epoch") != user.credential_epoch
        or time.time() - grant.get("at", 0) > max_age
    ):
        raise AuthFailure()
    if context == "owner":
        if not (
            user.owner_authority
            and user.is_staff
            and user.is_superuser
            and (
                not owner_mfa_required()
                or grant.get("mfa") and Authenticator.objects.filter(user=user, confirmed=True).exists()
            )
        ):
            raise AuthFailure()
        return None
    account = Account.objects.filter(
        pk=grant.get("account"), user=user, context=context, status=Account.Status.ACTIVE
    ).first()
    if not account or grant.get("account_epoch") != account.access_epoch or context == "staff" and not grant.get("mfa"):
        raise AuthFailure()
    return account


def establish(request, user, context, *, mfa=False, device=None):
    # One authority lock serializes grant creation/rotation with every context logout.
    # Later whole-session saves cannot undo the monotonic grant revocations.
    with transaction.atomic():
        # Identity precedes authority everywhere, including Google/MFA callers already holding it.
        fresh_user = User.objects.select_for_update().get(pk=user.pk)
        if (
            not fresh_user.is_active
            or not fresh_user.email_verified
            or credential_state(fresh_user) != credential_state(user)
        ):
            raise AuthFailure()
        user = fresh_user
        if request.user.is_authenticated and request.user.pk != user.pk:
            logout(request)
        authority = (
            BrowserAuthority.objects.select_for_update()
            .filter(
                pk=request.session.get("authority"),
                user=user,
                revoked=False,
            )
            .first()
        )
        if not authority:
            if request.session.get("authority"):
                raise AuthFailure()
            authority = BrowserAuthority.objects.create(user=user)
        login(request, user, backend="django.contrib.auth.backends.ModelBackend")
        request.session.cycle_key()
        rotate_token(request)
        request.session["authority"] = str(authority.pk)
        grants = request.session.get("grants", {})
        account = (
            None if context == "owner" else Account.objects.filter(user=user, context=context, status="active").first()
        )
        if context != "owner" and not account:
            raise AuthFailure()
        grant = ContextGrant.objects.create(authority=authority, context=context)
        grants[context] = {
            "grant_id": str(grant.pk),
            "identity": str(user.pk),
            "epoch": user.credential_epoch,
            "account": str(account.pk) if account else None,
            "account_epoch": account.access_epoch if account else None,
            "at": time.time(),
            "mfa": mfa,
        }
        request.session["grants"] = grants
        request.session.pop("pending_mfa", None)
        request.session.set_expiry(28800)
        if device:
            otp_login(request, device)
        audit("context_signed_in", request=request, user=user, account=account, context=context)


def revoke_context(request, context):
    with transaction.atomic():
        request.user = User.objects.select_for_update().get(pk=request.user.pk)
        authority = (
            BrowserAuthority.objects.select_for_update()
            .filter(
                pk=request.session.get("authority"),
                user=request.user,
                revoked=False,
            )
            .first()
        )
        if not authority:
            raise AuthFailure()
        account = get_grant(request, context)
        # Revoke every generation in this browser/context, including grants held by stale requests.
        ContextGrant.objects.filter(authority=authority, context=context, revoked=False).update(revoked=True)
        audit("context_signed_out", request=request, user=request.user, account=account, context=context)
        grants = request.session.get("grants", {})
        grants.pop(context, None)
        request.session["grants"] = grants


def begin_signin(request, email, password, context):
    rate_limit(request, "login", identity=normalize_email(email), limit=12)
    user = authenticate(request, email=normalize_email(email), password=password)
    eligible = (
        user
        and user.email_verified
        and (
            context == "owner"
            and user.owner_authority
            and user.is_staff
            and user.is_superuser
            or context != "owner"
            and Account.objects.filter(user=user, context=context, status="active").exists()
        )
    )
    if not eligible:
        raise AuthFailure()
    if context == "staff" or context == "owner" and owner_mfa_required():
        if request.user.is_authenticated and request.user.pk != user.pk:
            logout(request)
        request.session.cycle_key()
        rotate_token(request)
        request.session["pending_mfa"] = {
            "identity": str(user.pk),
            "state": credential_state(user),
            "context": context,
            "at": time.time(),
            "nonce": secrets.token_hex(16),
        }
        audit("privileged_password_verified", request=request, user=user, context=context)
        return "challenge" if Authenticator.objects.filter(user=user, confirmed=True).exists() else "enroll"
    establish(request, user, context)
    if context == "owner":
        audit("owner_development_password_signin", request=request, user=user, context=context)
    return "signed_in"


def pending_identity(request):
    pending = request.session.get("pending_mfa", {})
    user = (
        User.objects.filter(pk=pending.get("identity"), is_active=True, email_verified=True).first()
        if pending.get("identity")
        else None
    )
    if not user or time.time() - pending.get("at", 0) > 300 or pending.get("state") != credential_state(user):
        raise AuthFailure()
    context = pending.get("context")
    if context == "owner":
        if not (user.owner_authority and user.is_staff and user.is_superuser):
            raise AuthFailure()
    elif context != "staff" or not Account.objects.filter(user=user, context="staff", status="active").exists():
        raise AuthFailure()
    return user, context


def start_enrollment(request):
    user, context = pending_identity(request)
    rate_limit(request, "enrollment", identity=str(user.pk), limit=5)
    with transaction.atomic():
        user = User.objects.select_for_update().get(pk=user.pk)
        if not user.is_active or request.session["pending_mfa"]["state"] != credential_state(user):
            raise AuthFailure()
        if Authenticator.objects.filter(user=user, confirmed=True).exists():
            raise PermissionDenied()
        device, _ = Authenticator.objects.get_or_create(
            user=user, defaults={"name": "Authenticator", "confirmed": False}
        )
        device.set_secret()
        device.save()
        request.session["enrollment_device"] = str(device.pk)
        secret = base64.b32encode(device.secret).decode()
        audit("mfa_enrollment_started", request=request, user=user, context=context)
        return {
            "secret": secret,
            "uri": f"otpauth://totp/{quote('Bazar Rezayi:' + user.email)}?secret={secret}&issuer=Bazar%20Rezayi&digits=6&period=30",
        }


def finish_mfa(request, code, *, recovery=False):
    user, context = pending_identity(request)
    rate_limit(request, "mfa", identity=str(user.pk), limit=8, seconds=300)
    codes = []
    with transaction.atomic():
        user = User.objects.select_for_update().get(pk=user.pk)
        if not user.is_active or request.session["pending_mfa"]["state"] != credential_state(user):
            raise AuthFailure()
        device = Authenticator.objects.select_for_update().filter(user=user).first()
        if not device or not device.confirmed and request.session.get("enrollment_device") != str(device.pk):
            raise AuthFailure()
        valid = (
            RecoveryCode.consume(user, code)
            if recovery and device.confirmed
            else not recovery and device.verify_token(code)
        )
        if valid and not device.confirmed:
            device.confirmed = True
            device.save(update_fields=["confirmed"])
            codes = [secrets.token_hex(8) for _ in range(8)]
            RecoveryCode.objects.bulk_create(
                [RecoveryCode(user=user, code_hash=make_password(value)) for value in codes]
            )
            audit("mfa_enrolled", request=request, user=user, context=context)
        if valid:
            establish(request, user, context, mfa=True, device=device)
            audit(
                "mfa_recovery_used" if recovery else "mfa_challenge_passed", request=request, user=user, context=context
            )
        else:
            audit("mfa_challenge_failed", request=request, user=user, context=context)
    if not valid:
        raise AuthFailure()
    return codes


def permission_codes(account):
    # Fresh queries, no cached Django superuser permission bypass for operational accounts.
    return (
        list(
            account.permission_groups.filter(permissions__content_type__app_label__in=["accounts", "verification", "content", "catalogue"])
            .values_list("permissions__codename", flat=True)
            .distinct()
        )
        if account.context == "staff"
        else []
    )


def account_summary(account):
    return {
        "id": str(account.pk),
        "context": account.context,
        "status": account.status,
        "intent": account.intent,
        "review_status": compatibility_review_status(account),
        "permissions": permission_codes(account),
    }


def compatibility_review_status(account):
    """Read-only compatibility projection; business review cases alone grant entitlement."""
    if account.context == "staff":
        return "not_requested"
    from apps.organizations.models import BusinessProfile
    from django.db.models import Q
    profiles = BusinessProfile.objects.filter(Q(account=account, kind__in=["individual", "business"]) | Q(kind="company", memberships__account=account, memberships__active=True)).distinct()
    statuses = [p.cases.get(revision=p.revision).status for p in profiles]
    if "approved" in statuses:
        return "approved"
    if "rejected" in statuses:
        return "rejected"
    return "pending" if statuses or account.context == "seller" or account.intent == "business" else "not_requested"
