import hashlib

from django.conf import settings
from django.contrib.auth import logout
from django.db import IntegrityError, transaction
from django.middleware.csrf import get_token
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.debug import sensitive_post_parameters
from drf_spectacular.utils import extend_schema
from rest_framework.authentication import SessionAuthentication
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from django.http import JsonResponse
from apps.foundation.errors import error_data

from . import contracts as c
from .models import Account, Authenticator, RecoveryCode, User, normalize_email
from .services import (
    AuthFailure,
    account_summary,
    audit,
    begin_signin,
    consume_token,
    finish_mfa,
    get_grant,
    revoke_context,
    password_check,
    rate_limit,
    request_mail,
    start_enrollment,
)


def identity_data(user):
    return {
        "id": str(user.pk),
        "email": user.email,
        "display_name": user.display_name,
        "email_verified": user.email_verified,
    }


def csrf_failure(request, reason=""):
    response = JsonResponse(
        error_data("csrf_failed", "The security check changed. Review and submit again.", request.request_id),
        status=403,
    )
    response["Cache-Control"] = "private, no-store"
    return response


@method_decorator(csrf_protect, name="dispatch")
@method_decorator(sensitive_post_parameters(), name="dispatch")
class AuthView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [AllowAny]

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "private, no-store"
        response["Pragma"] = "no-cache"
        response["Referrer-Policy"] = "no-referrer"
        return response

    def data(self, serializer):
        value = serializer(data=self.request.data)
        value.is_valid(raise_exception=True)
        return value.validated_data


class CsrfView(AuthView):
    @extend_schema(responses=c.AuthResult)
    def get(self, request):
        return Response({"status": "ready", "csrf_token": get_token(request)})


class RegisterView(AuthView):
    @extend_schema(request=c.Registration, responses={202: c.AuthResult})
    def post(self, request, context):
        data = self.data(c.Registration)
        email = normalize_email(data["email"])
        rate_limit(request, "registration", identity=email, limit=6)
        if data["intent"] not in ({"individual", "business"} if context == "buyer" else {"individual", "company"}):
            raise ValidationError({"intent": ["Invalid intent for this account."]})
        draft = User(email=email, display_name=data["display_name"])
        password_check(data["password"], draft)
        if not settings.DEVELOPMENT_SIGNUP_ENABLED:
            raise PermissionDenied("Registration requires approved published policies.")
        try:
            with transaction.atomic():
                user = User.objects.create_user(email, data["password"], display_name=data["display_name"])
                account = Account.objects.create(
                    user=user,
                    context=context,
                    intent=data["intent"],
                    review_status="pending" if context == "seller" or data["intent"] == "business" else "not_requested",
                )
                audit("registered_draft_consent", request=request, user=user, account=account, context=context)
                request_mail(user, "verify", data["locale"])
        except IntegrityError:
            # Never merge, overwrite a password, or reveal whether this identity/role already exists.
            pass
        return Response({"status": "request_received"}, status=202)


class SigninView(AuthView):
    @extend_schema(request=c.Signin, responses=c.AuthResult)
    def post(self, request, context):
        data = self.data(c.Signin)
        status = begin_signin(request, data["email"], data["password"], context)
        return Response({"status": status, "csrf_token": get_token(request)})


class MailView(AuthView):
    @extend_schema(request=c.MailRequest, responses={202: c.AuthResult})
    def post(self, request, purpose):
        data = self.data(c.MailRequest)
        email = normalize_email(data["email"])
        rate_limit(request, purpose, identity=email, limit=5)
        with transaction.atomic():
            user = User.objects.select_for_update().filter(email=email, is_active=True).first()
            if user and (purpose == "reset" or not user.email_verified):
                request_mail(user, purpose, data["locale"])
        return Response({"status": "request_received"}, status=202)


class VerifyView(AuthView):
    @extend_schema(request=c.TokenRequest, responses=c.AuthResult)
    def post(self, request):
        data = self.data(c.TokenRequest)
        rate_limit(request, "verify_token", identity=hashlib.sha256(data["token"].encode()).hexdigest(), limit=8)
        consume_token(data["token"], "verify", request=request)
        return Response({"status": "verified"})


class ResetView(AuthView):
    @extend_schema(request=c.ResetRequest, responses=c.AuthResult)
    def post(self, request):
        data = self.data(c.ResetRequest)
        rate_limit(request, "reset_token", identity=hashlib.sha256(data["token"].encode()).hexdigest(), limit=8)
        consume_token(data["token"], "reset", password=data["password"], request=request)
        return Response({"status": "password_updated"})


class SessionView(AuthView):
    @extend_schema(responses=c.SessionData)
    def get(self, request, context):
        account = get_grant(request, context)
        return Response({"identity": identity_data(request.user), "accounts": [account_summary(account)]})


class ProfileView(AuthView):
    @extend_schema(request=c.ProfileUpdate, responses=c.AuthResult)
    def patch(self, request, context):
        account = get_grant(request, context)
        data = self.data(c.ProfileUpdate)
        request.user.display_name = data["display_name"]
        request.user.save(update_fields=["display_name"])
        audit(
            "profile_updated",
            request=request,
            user=request.user,
            account=account,
            context=context,
            fields=["display_name"],
        )
        return Response({"status": "updated", "identity": identity_data(request.user)})


class LinkView(AuthView):
    @extend_schema(request=c.LinkRequest, responses=c.AuthResult)
    def post(self, request, context, target):
        get_grant(request, context)
        data = self.data(c.LinkRequest)
        rate_limit(request, "link", identity=str(request.user.pk), limit=5)
        if context == target or data["intent"] not in (
            {"individual", "business"} if target == "buyer" else {"individual", "company"}
        ):
            raise ValidationError("Invalid second account.")
        with transaction.atomic():
            user = User.objects.select_for_update().get(pk=request.user.pk)
            if not user.check_password(data["password"]):
                raise AuthFailure()
            if Account.objects.filter(user=user, context=target).exists():
                raise ValidationError("This account already exists; sign in to it separately or contact support.")
            linked = Account.objects.create(
                user=user,
                context=target,
                intent=data["intent"],
                review_status="pending" if target == "seller" or data["intent"] == "business" else "not_requested",
            )
            audit("second_account_linked", request=request, user=user, account=linked, context=context)
        return Response({"status": "linked", "account": account_summary(linked)})


class PasswordView(AuthView):
    @extend_schema(request=c.PasswordChange, responses=c.AuthResult)
    def post(self, request, context):
        account = get_grant(request, context)
        data = self.data(c.PasswordChange)
        rate_limit(request, "password_change", identity=str(request.user.pk), limit=5)
        with transaction.atomic():
            user = User.objects.select_for_update().get(pk=request.user.pk)
            if not user.check_password(data["current_password"]):
                raise AuthFailure()
            password_check(data["password"], user)
            user.set_password(data["password"])
            user.credential_epoch += 1
            user.save()
            audit("shared_password_changed", request=request, user=user, account=account, context=context)
        logout(request)
        return Response({"status": "password_updated"})


class LogoutView(AuthView):
    @extend_schema(request=c.Empty, responses=c.AuthResult)
    def post(self, request, context):
        self.data(c.Empty)
        revoke_context(request, context)
        return Response({"status": "signed_out"})


class LogoutAllView(AuthView):
    @extend_schema(request=c.Empty, responses=c.AuthResult)
    def post(self, request):
        self.data(c.Empty)
        audit("session_signed_out", request=request, user=request.user if request.user.is_authenticated else None)
        logout(request)
        return Response({"status": "signed_out"})


class EnrollmentView(AuthView):
    @extend_schema(request=c.Empty, responses=c.AuthResult)
    def post(self, request):
        self.data(c.Empty)
        return Response({"status": "enroll", **start_enrollment(request)})


class ChallengeView(AuthView):
    @extend_schema(request=c.Challenge, responses=c.AuthResult)
    def post(self, request):
        data = self.data(c.Challenge)
        codes = finish_mfa(request, data["code"], recovery=data["recovery"])
        return Response({"status": "signed_in", "csrf_token": get_token(request), "recovery_codes": codes})


class FactorResetView(AuthView):
    @extend_schema(request=c.FactorReset, responses=c.AuthResult)
    def post(self, request, context):
        account = get_grant(request, context)
        data = self.data(c.FactorReset)
        rate_limit(request, "factor_reset", identity=str(request.user.pk), limit=5)
        with transaction.atomic():
            user = User.objects.select_for_update().get(pk=request.user.pk)
            device = Authenticator.objects.select_for_update().filter(user=user, confirmed=True).first()
            if (
                not user.check_password(data["password"])
                or not device
                or not (
                    RecoveryCode.consume(user, data["code"]) if data["recovery"] else device.verify_token(data["code"])
                )
            ):
                raise AuthFailure()
            device.delete()
            RecoveryCode.objects.filter(user=user).delete()
            user.credential_epoch += 1
            user.save()
            audit("mfa_reset", request=request, user=user, account=account, context=context)
        logout(request)
        return Response({"status": "factor_removed"})
