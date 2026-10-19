"""Backend OIDC code flow. Authlib performs OAuth/PKCE and signed OIDC claim validation."""

import hashlib
import secrets
from datetime import timedelta
from urllib.parse import urlsplit

import requests
from authlib.integrations.requests_client import OAuth2Session
from joserfc import jwt
from joserfc.jwk import KeySet
from authlib.oidc.core import CodeIDToken
from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from .delivery import protect, reveal
from .models import Account, GoogleAttempt, GoogleIdentity, User, normalize_email
from .services import AuthFailure, audit, credential_state, establish, get_grant, rate_limit

ISSUER = "https://accounts.google.com"
AUTHORIZATION = ISSUER + "/o/oauth2/v2/auth"
TOKEN = "https://oauth2.googleapis.com/token"
JWKS = "https://www.googleapis.com/oauth2/v3/certs"


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def browser(request):
    if not request.session.get("oauth_browser"):
        request.session["oauth_browser"] = secrets.token_urlsafe(32)
    return digest(request.session["oauth_browser"])


def destination(value, locale, context):
    fallback = f"/{locale}/account/{context}"
    if not value or len(value) > 500 or any(ord(c) <= 32 or c in "\\%" for c in value):
        return fallback
    parsed = urlsplit(value)
    if (
        parsed.scheme
        or parsed.netloc
        or not parsed.path.startswith(f"/{locale}/account/{context}")
        or ".." in parsed.path.split("/")
        or parsed.query
        or parsed.fragment
    ):
        return fallback
    return parsed.path


def client():
    return OAuth2Session(
        settings.GOOGLE_CLIENT_ID,
        settings.GOOGLE_CLIENT_SECRET,
        scope="openid email profile",
        redirect_uri=settings.GOOGLE_REDIRECT_URI,
        code_challenge_method="S256",
        token_endpoint_auth_method="client_secret_post",
    )


def begin(request, data):
    if not settings.GOOGLE_OAUTH_ENABLED:
        return {"status": "google_unavailable"}
    context, action, locale = data["context"], data["action"], data["locale"]
    rate_limit(request, "google_start", limit=12)
    user = request.user if request.user.is_authenticated else None
    if action in {"link", "add-role"}:
        get_grant(request, data["source_context"])
        if action == "link" and not user.check_password(data.get("password", "")):
            raise AuthFailure()
        if action == "add-role" and not GoogleIdentity.objects.filter(user=user).exists():
            raise AuthFailure()
    if action == "register" and not settings.DEVELOPMENT_SIGNUP_ENABLED:
        raise AuthFailure()
    state, nonce, verifier = (secrets.token_urlsafe(48) for _ in range(3))
    attempt = GoogleAttempt.objects.create(
        state_digest=digest(state),
        browser_digest=browser(request),
        encrypted_payload=protect(
            {
                "nonce": nonce,
                "verifier": verifier,
                "source": data.get("source_context"),
                "issued_at": timezone.now().timestamp(),
            }
        ),
        context=context,
        action=action,
        locale=locale,
        user=user,
        credential_state=credential_state(user) if user else "",
        return_path=destination(data.get("return_path"), locale, context),
        expires_at=timezone.now() + timedelta(minutes=5),
    )
    with client() as provider:
        url, _ = provider.create_authorization_url(
            AUTHORIZATION,
            state=state,
            nonce=nonce,
            code_verifier=verifier,
            prompt="select_account" if action in {"signin", "register"} else "consent select_account",
        )
    audit("google_started", request=request, user=user, context=context)
    return {"status": "redirect", "authorization_url": url, "attempt_id": str(attempt.pk)}


def exchange(code, payload):
    with client() as provider:
        token = provider.fetch_token(TOKEN, code=code, code_verifier=payload["verifier"], timeout=10)
    response = requests.get(JWKS, timeout=10)
    response.raise_for_status()
    # Algorithm fixed to Google's asymmetric signing algorithm; never accept alg=none or HS.
    verified = jwt.decode(token["id_token"], KeySet.import_key_set(response.json()), algorithms=["RS256"])
    claims = CodeIDToken(
        verified.claims,
        verified.header,
        options={
            "iss": {"essential": True, "values": [ISSUER, "accounts.google.com"]},
            "email": {"essential": True},
            "email_verified": {"essential": True, "value": True},
        },
        params={
            "nonce": payload["nonce"],
            "client_id": settings.GOOGLE_CLIENT_ID,
            "access_token": token.get("access_token"),
        },
    )
    claims.validate(leeway=30)
    if claims["iat"] < payload.get("issued_at", 0) - 30:
        raise AuthFailure()
    if not isinstance(claims.get("email_verified"), bool) or not claims["email_verified"]:
        raise AuthFailure()
    if not isinstance(claims.get("sub"), str) or not 1 <= len(claims["sub"]) <= 255:
        raise AuthFailure()
    if not isinstance(claims.get("email"), str) or len(claims["email"]) > 254 or "@" not in claims["email"]:
        raise AuthFailure()
    return {"sub": claims["sub"], "email": normalize_email(claims["email"]), "name": str(claims.get("name", ""))[:150]}


def bound(request, attempt):
    uid = request.user.pk if request.user.is_authenticated else None
    if (
        attempt.browser_digest != browser(request)
        or attempt.expires_at <= timezone.now()
        or attempt.user_id != uid
        or attempt.user_id
        and (not request.user.is_active or attempt.credential_state != credential_state(request.user))
    ):
        raise AuthFailure()
    if attempt.action in {"link", "add-role"}:
        if not attempt.encrypted_payload:
            raise AuthFailure()
        get_grant(request, reveal(attempt.encrypted_payload)["source"])


def callback(request):
    if not settings.GOOGLE_OAUTH_ENABLED:
        raise AuthFailure()
    # Consume before network I/O; provider failures require a fresh attempt, never replay a code.
    with transaction.atomic():
        attempt = (
            GoogleAttempt.objects.select_for_update().filter(state_digest=digest(request.GET.get("state", ""))).first()
        )
        if not attempt or attempt.consumed_at:
            raise AuthFailure()
        bound(request, attempt)
        payload = reveal(attempt.encrypted_payload)
        attempt.consumed_at = timezone.now()
        attempt.save(update_fields=["consumed_at"])
    result = "provider_error"
    if request.GET.get("error"):
        result = "cancelled" if request.GET.get("error") == "access_denied" else result
    else:
        try:
            code = request.GET.get("code", "")
            if not code or len(code) > 4096:
                raise AuthFailure()
            claims = exchange(code, payload)
            with transaction.atomic():
                attempt = GoogleAttempt.objects.select_for_update().get(pk=attempt.pk)
                bound(request, attempt)
                social = (
                    GoogleIdentity.objects.select_related("user").filter(issuer=ISSUER, subject=claims["sub"]).first()
                )
                if attempt.action == "signin" and social:
                    user = User.objects.select_for_update().get(pk=social.user_id)
                    if (
                        not user.is_active
                        or not user.email_verified
                        or not Account.objects.filter(user=user, context=attempt.context, status="active").exists()
                    ):
                        result = "account_unavailable"
                    else:
                        establish(request, user, attempt.context)
                        result = "signed_in"
                elif attempt.action in {"signin", "register"}:
                    if social:
                        result = "account_unavailable"
                    elif User.objects.filter(email=claims["email"]).exists():
                        result = "link_required"
                    else:
                        payload = {"claims": claims, "source": payload.get("source"), "verified": True}
                        attempt.encrypted_payload = protect(payload)
                        result = "onboarding"
                elif attempt.action == "link":
                    user = User.objects.select_for_update().get(pk=attempt.user_id)
                    if claims["email"] != user.email or social and social.user_id != user.pk:
                        result = "link_required"
                    else:
                        GoogleIdentity.objects.get_or_create(
                            user=user, defaults={"issuer": ISSUER, "subject": claims["sub"]}
                        )
                        linked = GoogleIdentity.objects.get(user=user)
                        if linked.subject != claims["sub"]:
                            raise AuthFailure()
                        audit("google_linked", request=request, user=user, context=attempt.context)
                        result = "linked"
                else:
                    if not social or social.user_id != attempt.user_id:
                        raise AuthFailure()
                    attempt.encrypted_payload = protect(
                        {"claims": claims, "source": payload["source"], "verified": True}
                    )
                    result = "onboarding"
                if result != "onboarding":
                    attempt.encrypted_payload = ""
                attempt.save(update_fields=["encrypted_payload"])
        except Exception:
            # No provider exception text/response/token in audit or redirects.
            result = "provider_error"
    if result != "onboarding":
        GoogleAttempt.objects.filter(pk=attempt.pk).update(encrypted_payload="")
    audit("google_" + result, request=request, context=attempt.context)
    return attempt, result


def complete(request, data):
    if not settings.GOOGLE_OAUTH_ENABLED or not settings.DEVELOPMENT_SIGNUP_ENABLED or not data["consent"]:
        raise AuthFailure()
    rate_limit(request, "google_complete", limit=6)
    try:
        with transaction.atomic():
            attempt = GoogleAttempt.objects.select_for_update().get(pk=data["attempt_id"])
            bound(request, attempt)
            if not attempt.encrypted_payload:
                raise AuthFailure()
            payload = reveal(attempt.encrypted_payload)
            if not attempt.consumed_at or not payload.get("verified"):
                raise AuthFailure()
            context, intent = attempt.context, data["intent"]
            if intent not in ({"individual", "business"} if context == "buyer" else {"individual", "company"}):
                raise ValidationError("Invalid intent.")
            claims = payload["claims"]
            if attempt.action == "add-role":
                user = User.objects.select_for_update().get(pk=attempt.user_id)
                if not GoogleIdentity.objects.filter(user=user, issuer=ISSUER, subject=claims["sub"]).exists():
                    raise AuthFailure()
            else:
                # Unique email/provider constraints resolve parallel attempts without email merging.
                user = User.objects.create_user(
                    claims["email"], None, display_name=data["display_name"], email_verified=True
                )
                GoogleIdentity.objects.create(user=user, issuer=ISSUER, subject=claims["sub"])
            account = Account.objects.create(
                user=user,
                context=context,
                intent=intent,
                review_status="pending" if context == "seller" or intent == "business" else "not_requested",
            )
            attempt.encrypted_payload = ""
            attempt.save(update_fields=["encrypted_payload"])
            audit("google_onboarded_draft_consent", request=request, user=user, account=account, context=context)
            if attempt.action != "add-role":
                establish(request, user, context)
            return {
                "status": "linked" if attempt.action == "add-role" else "signed_in",
                "return_path": attempt.return_path,
            }
    except (IntegrityError, GoogleAttempt.DoesNotExist, ValueError):
        raise AuthFailure() from None
