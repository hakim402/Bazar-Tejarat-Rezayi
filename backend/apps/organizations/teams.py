import hashlib
import secrets
from datetime import timedelta

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.accounts.models import normalize_email
from .access import Conflict, assert_version, company_lock, eligible_member, event, membership
from .models import BUNDLES, Invitation, InvitationMail, Membership

INVITATION_DAYS = 7


def validate_bundles(values):
    if len(values) != len(set(values)) or not set(values).issubset(BUNDLES):
        raise ValidationError({"bundles": ["Choose supported company permissions."]})
    return sorted(values)


def rotate_invitation(invitation):
    from apps.accounts.delivery import protect
    from .mail import dispatch_invitation

    raw = secrets.token_urlsafe(32)
    invitation.digest = hashlib.sha256(raw.encode()).hexdigest()
    invitation.expires_at = timezone.now() + timedelta(days=INVITATION_DAYS)
    invitation.save()
    InvitationMail.objects.filter(invitation=invitation).exclude(status__in=["captured", "smtp_accepted"]).update(
        status="superseded", encrypted_payload=""
    )
    item = InvitationMail.objects.create(
        invitation=invitation,
        invitation_version=invitation.version,
        encrypted_payload=protect({"token": raw}),
        next_attempt_at=timezone.now(),
    )
    transaction.on_commit(lambda: dispatch_invitation(item.pk))


@transaction.atomic
def invite(actor, pk, data):
    company = company_lock(pk)
    grantor = membership(company, actor, owner=True)
    bundles = validate_bundles(data["bundles"])
    if not set(bundles).issubset(grantor.bundles):
        raise PermissionDenied()
    email = normalize_email(data["email"])
    pending = Invitation.objects.filter(company=company, email=email, status="pending").first()
    if pending:
        # Request retry returns the persisted invitation; resend is an explicit versioned action.
        return pending
    if Membership.objects.filter(company=company, active=True, account__user__email=email).exists():
        raise ValidationError({"email": ["This invitation cannot be created."]})
    invitation = Invitation(company=company, inviter=actor.account, email=email, bundles=bundles, locale=data["locale"])
    rotate_invitation(invitation)
    event(actor, "company_invited", invitation, after="pending")
    return invitation


@transaction.atomic
def invitation_action(actor, company_id, pk, action, version):
    company = company_lock(company_id)
    grantor = membership(company, actor, owner=True)
    invitation = Invitation.objects.get(pk=pk, company=company)
    assert_version(invitation, version)
    if invitation.status != "pending":
        raise Conflict()
    invitation.version += 1
    if action == "resend":
        if not set(invitation.bundles).issubset(grantor.bundles):
            raise PermissionDenied()
        invitation.inviter = actor.account
        rotate_invitation(invitation)
    else:
        invitation.status = "revoked"
        invitation.save()
        InvitationMail.objects.filter(invitation=invitation).update(encrypted_payload="", status="revoked")
    event(actor, "company_invite_" + action, invitation, after=invitation.status)
    return invitation


def invitation_from_token(raw):
    invitation = (
        Invitation.objects.filter(digest=hashlib.sha256(raw.encode()).hexdigest()).select_related("company").first()
    )
    if not invitation or invitation.status == "revoked" or invitation.expires_at <= timezone.now():
        raise ValidationError({"token": ["This invitation is unavailable."]})
    return invitation


@transaction.atomic
def accept_invitation(actor, raw):
    preliminary = invitation_from_token(raw)
    company = company_lock(preliminary.company_id)
    invitation = invitation_from_token(raw)
    account = actor.account
    if actor.context != "seller" or account.user.email != invitation.email:
        raise PermissionDenied("Use the verified invited seller account.")
    if invitation.status == "accepted":
        if invitation.accepted_by_id != account.pk:
            raise PermissionDenied()
        member = Membership.objects.get(company=company, account=account)
        if not member.active:
            raise ValidationError({"token": ["This invitation is unavailable."]})
        return member
    inviter = (
        Membership.objects.select_related("account__user")
        .filter(company=company, account=invitation.inviter, active=True, is_owner=True)
        .first()
    )
    if not inviter or not eligible_member(inviter) or not set(invitation.bundles).issubset(inviter.bundles):
        raise PermissionDenied("The inviter can no longer authorize this invitation.")
    member, created = Membership.objects.get_or_create(
        company=company, account=account, defaults={"bundles": invitation.bundles}
    )
    if not created and not member.active:
        member.active, member.is_owner, member.bundles, member.revoked_at = True, False, invitation.bundles, None
        member.save()
    invitation.status, invitation.accepted_by, invitation.accepted_at = "accepted", account, timezone.now()
    invitation.version += 1
    invitation.save()
    InvitationMail.objects.filter(invitation=invitation).update(encrypted_payload="")
    event(actor, "company_invite_accepted", invitation, after="accepted")
    return member


@transaction.atomic
def change_member(actor, company_id, pk, data):
    company = company_lock(company_id)
    assert_version(company, data["version"])
    target = Membership.objects.select_related("account__user").get(pk=pk, company=company)
    before = {"active": target.active, "is_owner": target.is_owner, "bundles": list(target.bundles)}
    if actor.context == "owner":
        actor.account
        if data["action"] != "revoke":
            raise PermissionDenied()
    elif data["action"] == "leave" and target.account_id == actor.account.pk:
        membership(company, actor)
    else:
        grantor = membership(company, actor, owner=True)
        if not set(data.get("bundles", [])).issubset(grantor.bundles):
            raise PermissionDenied()
    if data["action"] == "permissions":
        if target.is_owner or target.account_id == actor.account.pk:
            raise PermissionDenied("Ownership changes require reviewed transfer.")
        target.bundles = validate_bundles(data["bundles"])
    else:
        if target.is_owner:
            owners = Membership.objects.filter(
                company=company,
                active=True,
                is_owner=True,
                account__status="active",
                account__user__is_active=True,
                account__user__email_verified=True,
            )
            if not owners.exclude(pk=target.pk).exists():
                raise ValidationError("The last active owner cannot leave or be removed.")
        target.active, target.revoked_at = False, timezone.now()
    target.save()
    company.version += 1
    company.save(update_fields=["version"])
    event(
        actor,
        "company_member_" + data["action"],
        target,
        before=before,
        after={"active": target.active, "is_owner": target.is_owner, "bundles": list(target.bundles)},
    )
    return target
