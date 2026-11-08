"""Independent assigned native decisions, separate from seller/logistics authority."""

from django.shortcuts import get_object_or_404
from rest_framework.exceptions import PermissionDenied
from apps.accounts.models import User
from apps.foundation.independence import eligible_reviewers
from apps.organizations.access import Conflict
from . import models as m, access, queries, validation as v
from .services import emit

CODES = {
    "charge": "finalize_delivery_charge",
    "payment": "confirm_delivery_payment",
    "correction": "correct_delivery_payment",
    "blocker": "manage_delivery_holds",
    "logistics": "manage_logistics",
    "stock": "manage_logistics",
    "exception": "manage_logistics",
    "refund": "confirm_delivery_refund",
}


def reviewers(case, *, user_id=None):
    def independent(user):
        access.independent(case.order, user)
        if case.blocker_id and case.blocker.event.actor_id == user.pk:
            raise PermissionDenied("The blocker author cannot clear it.")
        if case.refund_id and case.refund.event.actor_id == user.pk:
            raise PermissionDenied("The delivery-refund reporter cannot confirm it.")

    return eligible_reviewers(
        "fulfilment",
        "read_fulfilment",
        CODES[case.kind],
        independent,
        user_id=user_id,
    )


def decide(actor, order, state, action, data):
    if action == "open":
        if actor.context != "owner" or "assign_fulfilment" not in access.rights(actor):
            raise PermissionDenied()
        from .services import new_case

        case = new_case(order, "logistics", order.pk)
        if case.version:
            raise Conflict("A retained logistics case already exists.")
        event = emit(order, state, "case_open", actor)
        reason = v.text(data.get("reason"))
        m.CaseEvent.construction.create(
            order=order, event=event, case=case, case_version=1, action="open", reason=reason
        )
        case.version = 1
        case.save(update_fields=["version"])
        return {"case": str(case.pk), "case_version": 1, "state": "open"}, event
    case = get_object_or_404(access.case_scope(actor).select_for_update(), pk=data.get("case"), order=order)
    v.expect(case.version, data.get("case_version"))
    code = "assign_fulfilment" if action == "assign" else CODES[case.kind]
    access.require_case(actor, case, code, decide=action != "assign")
    reason = v.text(data.get("reason"))
    if case.state != "open":
        raise Conflict("This case already has a retained decision.")
    event = emit(order, state, "case_" + action, actor)
    if action == "assign":
        user = get_object_or_404(User, pk=data.get("assigned_to"))
        if user.pk not in [x.pk for x in reviewers(case, user_id=user.pk)]:
            raise PermissionDenied("An eligible independent reviewer is required.")
        case.assigned_to = user
    elif action in {"approve", "reject"}:
        if case.kind not in {"charge", "payment", "correction", "refund"}:
            raise PermissionDenied()
        if case.kind == "charge":
            proposal = case.proposal
            if action == "approve":
                if m.Shipment.construction.filter(order=order).exists():
                    raise Conflict("Dispatched delivery terms are frozen.")
                arrangement = m.Arrangement.objects.filter(order=order).order_by("-event__version").first()
                if not arrangement or arrangement.provider_id != proposal.provider_id:
                    raise Conflict("Review the current provider.")
                if (
                    m.Receipt.objects.filter(order=order)
                    .exclude(claim__charge__provider_id=proposal.provider_id)
                    .exists()
                ):
                    raise Conflict("Existing receipts retain their provider scope.")
            m.ChargeDecision.construction.create(
                order=order,
                event=event,
                proposal=proposal,
                action="approved" if action == "approve" else "rejected",
                reason=reason,
            )
        elif case.kind == "refund":
            refund = case.refund
            if m.DeliveryRefundDecision.construction.filter(refund=refund).exists():
                raise Conflict("This exact delivery refund is already decided.")
            if action == "approve":
                received = queries.provider_receipts(order, refund.provider)
                confirmed = queries.confirmed_refunds(order, refund.provider)
                if confirmed + refund.amount > received:
                    raise Conflict("Provider-confirmed refunds cannot exceed confirmed provider receipts.")
            m.DeliveryRefundDecision.construction.create(
                order=order,
                event=event,
                refund=refund,
                action="confirmed" if action == "approve" else "rejected",
                reason=reason,
            )
        elif case.kind == "payment":
            claim = case.claim
            if (
                m.ClaimDecision.construction.filter(claim=claim).exists()
                or m.Receipt.construction.filter(claim=claim).exists()
            ):
                raise Conflict("This exact submission is already decided.")
            if action == "approve":
                final = queries.current_charge(order)
                if not final or final.amount == 0 or final.provider_id != claim.charge.provider_id:
                    raise Conflict("The current finalized positive payee must match.")
                v.total([queries.delivery_total(order), claim.amount])
                m.Receipt.construction.create(order=order, event=event, claim=claim)
            m.ClaimDecision.construction.create(
                order=order,
                event=event,
                claim=claim,
                action="confirmed" if action == "approve" else "rejected",
                reason=reason,
            )
        else:
            correction = case.correction
            if action == "approve":
                receipt = queries.effective_receipts(m.Receipt.objects.select_for_update()).get(
                    pk=correction.receipt_id
                )
                v.expect(receipt.effective_version, correction.target_version)
                v.total([queries.delivery_total(order) - receipt.effective_amount, correction.amount])
        case.state = "approved" if action == "approve" else "rejected"
    elif action == "clear" and case.kind == "blocker":
        if case.blocker.event.actor_id == actor.user.pk:
            raise PermissionDenied("Another independent reviewer must clear this hold.")
        disposition = data.get("disposition")
        if disposition not in {"erroneous", "withdrawn", "decided"}:
            v.fail("disposition", "erroneous_withdrawn_or_decided_only")
        m.BlockerClosure.construction.create(
            order=order, event=event, blocker=case.blocker, disposition=disposition, reason=reason
        )
        case.state = "resolved"
    elif action == "refer":
        case.state = "referred"
    elif action == "resolve":
        if case.kind == "blocker":
            raise PermissionDenied("An actual cancellation/dispute hold cannot be silently cleared.")
        if case.kind == "payment" and not m.ClaimDecision.objects.filter(claim=case.claim, action="withdrawn").exists():
            raise Conflict()
        if case.kind in {"charge", "correction"}:
            raise PermissionDenied()
        case.state = "resolved"
    else:
        raise PermissionDenied()
    m.CaseEvent.construction.create(
        order=order,
        event=event,
        case=case,
        case_version=case.version + 1,
        action=action,
        assigned_to=case.assigned_to,
        reason=reason,
    )
    case.version += 1
    case.save(update_fields=["version", "state", "assigned_to"])
    access.audit(actor, case, "fulfilment_case_decision", reason)
    return {"case": str(case.pk), "state": case.state, "case_version": case.version}, event
