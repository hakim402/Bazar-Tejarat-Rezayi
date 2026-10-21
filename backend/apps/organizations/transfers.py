from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from .access import Conflict, assert_version, company_lock, eligible_member, event, independent, membership
from .models import Membership, OwnershipTransfer
from .teams import validate_bundles


@transaction.atomic
def request_transfer(actor, company_id, data):
    company = company_lock(company_id)
    grantor = membership(company, actor, owner=True)
    bundles = validate_bundles(data["retained_bundles"])
    if not set(bundles).issubset(grantor.bundles):
        raise PermissionDenied()
    recipient = Membership.objects.select_related("account__user").get(pk=data["recipient"], company=company)
    if not eligible_member(recipient) or recipient.is_owner or recipient.account_id == actor.account.pk:
        raise ValidationError({"recipient": ["Choose an active eligible company member."]})
    existing = OwnershipTransfer.objects.filter(company=company, status__in=["pending", "accepted"]).first()
    if existing:
        if (
            existing.requester_id == actor.account.pk
            and existing.recipient_id == recipient.pk
            and existing.retained_bundles == bundles
        ):
            return existing
        raise Conflict("Another transfer is pending.")
    item = OwnershipTransfer.objects.create(
        company=company,
        requester=actor.account,
        recipient=recipient,
        retained_bundles=bundles,
        company_revision=company.revision,
        company_identity={"legal_name": company.legal_name, "representative": company.representative},
    )
    event(actor, "ownership_transfer_requested", item, after="pending")
    return item


@transaction.atomic
def transfer_action(actor, pk, data):
    preliminary = OwnershipTransfer.objects.get(pk=pk)
    company = company_lock(preliminary.company_id)
    item = OwnershipTransfer.objects.select_related("recipient__account__user").get(pk=pk)
    assert_version(item, data["version"])
    before = item.status
    if before not in {"pending", "accepted"}:
        raise Conflict()
    action = data["action"]
    recipient = item.recipient
    if action == "accept":
        if actor.context != "seller" or actor.account.pk != recipient.account_id or not eligible_member(recipient):
            raise PermissionDenied()
        membership(company, actor)
        if before == "accepted":
            return item
        item.accepted_at = timezone.now()
        item.status = "accepted"
    elif action == "cancel":
        membership(company, actor, owner=True)
        if actor.account.pk != item.requester_id:
            raise PermissionDenied()
        item.status = "cancelled"
    else:
        account = actor.staff("review_transfer")
        independent(company, actor)
        owner = (
            Membership.objects.select_related("account__user")
            .filter(company=company, account=item.requester, is_owner=True, active=True)
            .first()
        )
        if action == "approve" and (
            before != "accepted"
            or item.company_revision != company.revision
            or item.company_identity != {"legal_name": company.legal_name, "representative": company.representative}
            or not owner
            or not eligible_member(owner)
            or not eligible_member(recipient)
            or recipient.is_owner
        ):
            raise Conflict("Company membership changed; this transfer cannot be approved.")
        if action == "approve":
            if not set(item.retained_bundles).issubset(owner.bundles):
                raise PermissionDenied()
            recipient.is_owner, recipient.bundles = True, owner.bundles
            recipient.save()
            owner.is_owner, owner.bundles = False, item.retained_bundles
            owner.save()
            company.version += 1
            company.save(update_fields=["version"])
        item.status = "approved" if action == "approve" else "rejected"
        item.reviewer, item.decided_at, item.reason = account, timezone.now(), data["reason"]
    item.version += 1
    item.save()
    event(actor, "ownership_transfer_" + action, item, reason=data.get("reason", ""), before=before, after=item.status)
    return item
