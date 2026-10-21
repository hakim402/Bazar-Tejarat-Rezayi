"""Fresh business-resource authorization shared by API and owner administration."""

from dataclasses import dataclass

from django.db.models import Q
from rest_framework.exceptions import APIException, PermissionDenied

from apps.accounts.models import Account, AuditEvent, User
from apps.accounts.services import get_grant
from .models import BusinessProfile, Membership


class Conflict(APIException):
    status_code = 409
    default_detail = "This record changed. Refresh and review it again."
    default_code = "stale_revision"


@dataclass
class Actor:
    request: object
    context: str

    @property
    def account(self):
        return get_grant(self.request, self.context)

    @property
    def user(self):
        return self.request.user

    def staff(self, permission):
        account = self.account
        if self.context == "owner":
            return None
        if (
            self.context != "staff"
            or not account.permission_groups.filter(
                permissions__content_type__app_label="verification", permissions__codename=permission
            ).exists()
        ):
            raise PermissionDenied()
        return account


def fresh_account(account):
    if not Account.objects.filter(
        pk=account.pk, status="active", user__is_active=True, user__email_verified=True
    ).exists():
        raise PermissionDenied()


def membership(profile, actor, *, owner=False):
    account = actor.account
    if actor.context != "seller" or profile.kind != "company":
        raise PermissionDenied()
    result = Membership.objects.filter(company=profile, account=account, active=True).first()
    if not result or owner and not result.is_owner:
        raise PermissionDenied()
    return result


def manage_profile(profile, actor):
    if actor.context == "owner":
        actor.account
        return
    if profile.kind == "company":
        membership(profile, actor, owner=True)
    elif profile.account_id != actor.account.pk or actor.context != (
        "buyer" if profile.kind == "business" else "seller"
    ):
        raise PermissionDenied()


def visible_profiles(actor):
    account = actor.account
    if actor.context not in {"buyer", "seller"}:
        raise PermissionDenied()
    return (
        BusinessProfile.objects.filter(
            Q(account=account, kind__in=["business"] if actor.context == "buyer" else ["individual"])
            | Q(kind="company", memberships__account=account, memberships__active=True)
        )
        .distinct()
        .order_by("created_at")
    )


def assert_version(obj, version):
    if obj.version != version:
        raise Conflict()


def event(actor, action, resource, *, reason="", before="", after=""):
    account = actor.account
    case_id = getattr(resource, "case_id", None)
    if resource._meta.label_lower == "verification.reviewcase":
        case_id = resource.pk
    organization_id = getattr(resource, "company_id", None) or getattr(resource, "profile_id", None)
    if getattr(resource, "case_id", None):
        organization_id = resource.case.profile_id
    AuditEvent.objects.create(
        actor=actor.user,
        account=account,
        context=actor.context,
        action=action,
        request_id=getattr(actor.request, "request_id", None),
        resource_type=resource._meta.label_lower,
        resource_id=resource.pk,
        reason=reason,
        state={
            "before": before,
            "after": after,
            "organization_id": str(organization_id or resource.pk),
            **({"case_id": str(case_id)} if case_id else {}),
        },
    )


def independent(profile, actor):
    actor.account
    if (
        profile.account.user_id == actor.user.pk
        or Membership.objects.filter(company=profile, account__user=actor.user).exists()
    ):
        raise PermissionDenied("Another authorized reviewer must handle this case.")


def company_lock(pk):
    return BusinessProfile.objects.select_for_update().get(pk=pk)


def eligible_member(member):
    return (
        member.active
        and member.account.context == "seller"
        and member.account.status == "active"
        and member.account.user.is_active
        and member.account.user.email_verified
    )


def active_user(pk):
    return User.objects.filter(pk=pk, is_active=True, email_verified=True).exists()
