"""Historical aftercare snapshot validation; restored rows are loaded without guards."""

from decimal import Decimal
from uuid import UUID
from django.db.models import Sum
from apps.runtime.transfer import TransferError
from . import models as m

ZERO = Decimal("0.00")


def validate_history(*, include_disputes=True):
    from apps.payments import models as p, queries as goods

    for head in m.Aftercare.objects.select_related("order").iterator(chunk_size=100):
        version = 0
        for retained in (
            m.AftercareEvent.objects.filter(order_id=head.order_id).order_by("version")
            .values_list("version", flat=True).iterator(chunk_size=100)
        ):
            version += 1
            if retained != version:
                raise TransferError("Restored aftercare publication/head is incomplete.")
        if version != head.version:
            raise TransferError("Restored aftercare publication/head is incomplete.")
    for request in m.CancellationRequest.objects.iterator(chunk_size=100):
        decision = m.CancellationDecision.objects.filter(request=request).first()
        decided = request.state in {"approved", "rejected"}
        if decided != (decision is not None) or (decided and decision.action != request.state):
            raise TransferError("Restored cancellation state differs from its retained decision.")
        if request.state != "approved":
            continue
        adjustment = m.InvoiceAdjustment.objects.filter(cancellation=request).first()
        if adjustment is None or adjustment.after_total != ZERO or adjustment.after_lines:
            raise TransferError("Restored approved cancellation lacks its zero-total invoice adjustment.")
        if decision.event_id != adjustment.event_id:
            raise TransferError("Restored cancellation decision differs from its invoice adjustment.")
    for amendment in m.Amendment.objects.select_related("order").iterator(chunk_size=100):
        decision = m.AmendmentDecision.objects.filter(amendment=amendment).first()
        decided = amendment.state in {"approved", "rejected"}
        if decided != (decision is not None) or (decided and decision.action != amendment.state):
            raise TransferError("Restored amendment state differs from its retained decision.")
        if amendment.state != "approved":
            continue
        adjustment = m.InvoiceAdjustment.objects.filter(amendment=amendment).first()
        if (
            adjustment is None or adjustment.after_total != amendment.after_total
            or adjustment.event_id != decision.event_id
        ):
            raise TransferError("Restored approved amendment differs from its adjusted accepted total.")
    for due in p.RefundDue.objects.select_related("order").iterator(chunk_size=100):
        if not p.RefundSeal.objects.filter(due=due).exists():
            raise TransferError("Restored refund due lacks its retained seal.")
        if due.currency != due.order.currency:
            raise TransferError("Restored refund due differs from the goods-order currency.")
    for order_id in (
        p.RefundDue.objects.values_list("order_id", flat=True).distinct().order_by("order_id").iterator(chunk_size=100)
    ):
        order = m.SellerOrder.objects.get(pk=order_id)
        dues = p.RefundDue.objects.filter(order_id=order_id).aggregate(value=Sum("amount"))["value"] or ZERO
        if dues > goods.confirmed(order):
            raise TransferError("Restored refund dues exceed confirmed received money.")
        reported = (
            p.RefundReport.objects.filter(due__order_id=order_id, decision__action="confirmed").aggregate(
                value=Sum("amount")
            )["value"]
            or ZERO
        )
        if reported > dues:
            raise TransferError("Restored confirmed refunds exceed their refund dues.")
    if include_disputes:
        validate_disputes()
        validate_reviews()


def identity(event):
    """Retained User/Account binding, deliberately independent of today's grants."""
    if event.actor_id is None:
        raise TransferError("Restored participant event lacks its retained actor.")
    if event.context == "owner":
        valid = event.account_id is None
    else:
        valid = (
            event.context in {"buyer", "seller", "staff"}
            and event.account_id is not None
            and event.account.context == event.context
            and event.account.user_id == event.actor_id
        )
    if not valid:
        raise TransferError("Restored event actor/account/context identity differs.")
    return event.actor_id, event.account_id, event.context


def participant_event(event, order_id, action, account):
    identity(event)
    if (
        event.order_id != order_id or event.action != action
        or event.account_id != account.pk or event.actor_id != account.user_id
        or event.context != account.context
    ):
        raise TransferError("Restored participant source differs from its retained event.")


def decision_event(decision, order_id, action):
    if (
        decision.context not in {"owner", "staff"}
        or identity(decision.event) != (decision.actor_id, decision.account_id, decision.context)
        or decision.event.order_id != order_id or decision.event.action != action
    ):
        raise TransferError("Restored decision differs from its retained actor/context/event.")


def command_event(event, actions, key, target, *, state=None):
    command = m.AftercareCommand.objects.filter(event_id=event.pk).first()
    if (
        command is None or command.action not in actions or command.order_id != event.order_id
        or (command.actor_id, command.account_id, command.context) != identity(event)
        or not isinstance(command.result, dict) or command.result.get(key) != str(target)
        or type(command.result.get("version")) is not int or command.result["version"] != event.version
        or (state is not None and command.result.get("state") != state)
    ):
        raise TransferError("Restored aftercare source differs from its retained command.")
    return command


def historical_seller(order, account, at):
    from apps.organizations.models import Membership

    # Membership identity is retained after revocation; bundles/active flags and
    # today's verification/owner/group state are not historical authority.
    return account.context == "seller" and (
        order.seller.account_id == account.pk
        or Membership.objects.filter(company_id=order.seller_id, account=account, created_at__lte=at).exists()
    )


def delivered_predecessor(order_id, at):
    from apps.fulfilment import models as delivery

    rows = delivery.Delivery.construction.filter(order_id=order_id).select_related("shipment", "event")
    if rows.count() != 1:
        raise TransferError("Restored dispute/review lacks its exact delivered predecessor.")
    row = rows.first()
    if (
        row.shipment.order_id != order_id or row.event.order_id != order_id
        or row.event.action != "delivered" or row.event.created_at > at or row.created_at > at
        or row.occurred_at > at or not delivery.Publication.objects.filter(event_id=row.event_id).exists()
    ):
        raise TransferError("Restored delivered predecessor crosses order/time/publication boundaries.")
    return row


def retained_independent(order, actor_id, at):
    """Conflicts from identities/facts already retained at the decision, not live permissions."""
    from django.db.models import Q
    from apps.organizations.models import Membership
    from apps.payments import models as p

    if (
        actor_id in {order.buyer.user_id, order.seller.account.user_id}
        or Membership.objects.filter(
            Q(company_id=order.seller_id) | Q(company__account_id=order.buyer_id),
            account__user_id=actor_id, created_at__lte=at,
        ).exists()
        or p.Receipt.construction.filter(order_id=order.pk, actor__user_id=actor_id, created_at__lte=at).exists()
        or p.StockPlan.construction.filter(order_id=order.pk, actor__user_id=actor_id, created_at__lte=at).exists()
        or m.Amendment.objects.filter(order_id=order.pk, actor__user_id=actor_id, created_at__lte=at).exists()
    ):
        raise TransferError("Restored decision actor conflicts with retained order participants.")


def validate_disputes():
    from apps.fulfilment import models as delivery
    from apps.payments import models as p

    for dispute in m.DisputeRequest.objects.select_related(
        "order__buyer", "order__seller__account", "requester_account", "event__account", "blocker__event",
    ).iterator(chunk_size=100):
        order, opening = dispute.order, dispute.event
        if dispute.requester_account_id != order.buyer_id or dispute.requester_account.context != "buyer":
            raise TransferError("Restored dispute requester differs from its exact order buyer.")
        participant_event(opening, order.pk, "dispute_opened", dispute.requester_account)
        command_event(opening, {"dispute_open"}, "dispute", dispute.pk, state="pending")
        delivered_predecessor(order.pk, opening.created_at)
        if m.CancellationDecision.objects.filter(
            request__order_id=order.pk, action="approved", event__created_at__lte=opening.created_at,
        ).exists():
            raise TransferError("Restored dispute opened after an approved cancellation.")
        blocker = dispute.blocker
        if (
            blocker is None or blocker.order_id != order.pk or blocker.kind != "dispute"
            or blocker.event.order_id != order.pk or blocker.event.action != "dispute_hold"
            or blocker.reason != dispute.reason
            or identity(blocker.event) != identity(opening) or blocker.event.created_at < opening.created_at
            or not delivery.Publication.objects.filter(event_id=blocker.event_id).exists()
            or m.DisputeRequest.objects.filter(blocker_id=blocker.pk).exclude(pk=dispute.pk).exists()
        ):
            raise TransferError("Restored dispute lacks its exact sealed opening hold.")
        case = delivery.ReviewCase.objects.filter(blocker_id=blocker.pk).first()
        if case is None or case.order_id != order.pk or case.kind != "blocker":
            raise TransferError("Restored dispute hold lacks its exact review case.")
        next_open = m.AftercareEvent.objects.filter(
            order_id=order.pk, action="dispute_opened", version__gt=opening.version,
        ).order_by("version").first()
        events = m.AftercareEvent.objects.filter(
            order_id=order.pk, action__startswith="dispute_", version__gt=opening.version,
        ).select_related("account").order_by("version")
        if next_open is not None:
            if blocker.event.created_at >= next_open.created_at or dispute.state == "pending":
                raise TransferError("Restored dispute opening hold overlaps a later dispute.")
            events = events.filter(version__lt=next_open.version)
        state, version, terminal = "pending", 1, None
        response = m.DisputeResponse.objects.filter(dispute=dispute).select_related("actor", "event__account").first()
        decision = m.DisputeDecision.objects.filter(dispute=dispute).select_related("event__account", "refund_due__event__account").first()
        seen_response = False
        for event in events.iterator(chunk_size=100):
            if state != "pending":
                raise TransferError("Restored dispute has transitions after its terminal event.")
            version += 1
            if event.action == "dispute_response":
                if response is None or seen_response or response.event_id != event.pk:
                    raise TransferError("Restored dispute response differs from its retained event.")
                participant_event(event, order.pk, "dispute_response", response.actor)
                if not historical_seller(order, response.actor, event.created_at):
                    raise TransferError("Restored dispute response lacks its retained seller identity.")
                command_event(event, {"dispute_respond"}, "dispute", dispute.pk, state="pending")
                seen_response = True
            elif event.action == "dispute_assigned":
                if event.context not in {"owner", "staff"}:
                    raise TransferError("Restored dispute assignment has an invalid context.")
                command_event(event, {"dispute_assign"}, "dispute", dispute.pk, state="pending")
            elif event.action == "dispute_withdrawn":
                participant_event(event, order.pk, "dispute_withdrawn", dispute.requester_account)
                command_event(event, {"dispute_withdraw"}, "dispute", dispute.pk, state="withdrawn")
                state, terminal = "withdrawn", event
            elif event.action == "dispute_decided":
                if decision is None or decision.event_id != event.pk or decision.action not in m.DISPUTE_OUTCOMES:
                    raise TransferError("Restored dispute final state lacks its exact retained decision.")
                decision_event(decision, order.pk, "dispute_decided")
                if m.CancellationDecision.objects.filter(
                    request__order_id=order.pk, action="approved", event__created_at__lte=event.created_at,
                ).exists():
                    raise TransferError("Restored dispute decision follows an approved cancellation.")
                retained_independent(order, decision.actor_id, event.created_at)
                if (
                    dispute.assigned_to_id != decision.actor_id
                    or m.DisputeResponse.objects.filter(dispute__order_id=order.pk, actor__user_id=decision.actor_id,
                                                        created_at__lte=event.created_at).exists()
                    or p.EvidenceBinding.objects.filter(dispute__order_id=order.pk, evidence__creator__user_id=decision.actor_id,
                                                        created_at__lte=event.created_at).exists()
                ):
                    raise TransferError("Restored dispute decider conflicts with retained assignment/authors.")
                action = {"dismissed": "dispute_dismiss", "resolved_non_monetary": "dispute_resolve",
                          "refund_ordered": "dispute_refund"}[decision.action]
                command_event(event, {action}, "dispute", dispute.pk, state=decision.action)
                state, terminal = decision.action, event
            else:
                raise TransferError("Restored dispute history contains an unknown transition.")
        if (
            state != dispute.state or version != dispute.version or seen_response != (response is not None)
            or (decision is not None) != (state in m.DISPUTE_OUTCOMES)
        ):
            raise TransferError("Restored dispute state/version differs from its retained history.")
        closures = delivery.BlockerClosure.construction.filter(blocker_id=blocker.pk).select_related("event__account")
        if terminal is None:
            if closures.exists() or case.state not in {"open", "referred"}:
                raise TransferError("Restored pending dispute has a terminal hold closure.")
        else:
            if closures.count() != 1 or case.state != "resolved":
                raise TransferError("Restored closed dispute lacks exactly one hold closure.")
            closure = closures.first()
            expected = "withdrawn" if state == "withdrawn" else "decided"
            closure_action = "dispute_withdrawn" if state == "withdrawn" else "case_clear"
            case_action = "withdraw" if state == "withdrawn" else "clear"
            if (
                closure.order_id != order.pk or closure.disposition != expected
                or closure.event.order_id != order.pk or closure.event.action != closure_action
                or identity(closure.event) != identity(terminal) or closure.event.version <= blocker.event.version
                or closure.event.created_at < terminal.created_at
                or (next_open is not None and closure.event.created_at >= next_open.created_at)
                or not delivery.Publication.objects.filter(event_id=closure.event_id).exists()
                or not delivery.CaseEvent.construction.filter(
                    case=case, order_id=order.pk, event_id=closure.event_id, action=case_action,
                    case_version=case.version, assigned_to_id=case.assigned_to_id,
                ).exists()
            ):
                raise TransferError("Restored dispute closure differs from its exact terminal event/case.")
        if decision is not None:
            validate_dispute_refund(dispute, decision)
    # Orphan opening/events and orphan dispute dues cannot be hidden by valid heads.
    for event in m.AftercareEvent.objects.filter(action__startswith="dispute_").iterator(chunk_size=100):
        command = m.AftercareCommand.objects.filter(event=event).first()
        target = command.result.get("dispute") if command and isinstance(command.result, dict) else None
        try:
            target = UUID(str(target))
        except (ValueError, TypeError, AttributeError):
            raise TransferError("Restored dispute command target is not a retained UUID.") from None
        if not m.DisputeRequest.objects.filter(pk=target, order_id=event.order_id, event__version__lte=event.version).exists():
            raise TransferError("Restored dispute event has no retained request/command target.")
    for due in p.RefundDue.objects.filter(cause="dispute").iterator(chunk_size=100):
        if m.DisputeDecision.objects.filter(refund_due=due, action="refund_ordered").count() != 1:
            raise TransferError("Restored dispute refund due lacks its unique decision.")


def validate_dispute_refund(dispute, decision):
    from apps.payments import models as p

    if decision.action != "refund_ordered":
        if decision.amount is not None or decision.refund_due_id is not None:
            raise TransferError("Restored non-monetary dispute decision carries a refund.")
        return
    due = decision.refund_due
    if (
        due is None or decision.amount is None or decision.amount <= ZERO or due.amount != decision.amount
        or due.order_id != dispute.order_id or due.cause != "dispute" or due.currency != dispute.order.currency
        or due.event.order_id != dispute.order_id or due.event.action != "refund_due_created"
        or identity(due.event) != identity(decision.event) or due.event.created_at < decision.event.created_at
        or not p.RefundSeal.objects.filter(due=due).exists()
    ):
        raise TransferError("Restored dispute refund differs from its sealed exact cross-ledger decision.")
    for report in p.RefundReport.objects.filter(due=due).select_related("actor", "event__account").iterator(chunk_size=100):
        participant_event(report.event, due.order_id, "refund_reported", report.actor)
        if report.amount != due.amount or not historical_seller(dispute.order, report.actor, report.event.created_at):
            raise TransferError("Restored dispute refund report differs from its due/seller identity.")
        retained = p.RefundDecision.objects.filter(report=report).select_related("event__account").first()
        if retained is None:
            continue
        if retained.action == "withdrawn":
            participant_event(retained.event, due.order_id, "refund_withdrawn", report.actor)
            if (retained.actor_id, retained.account_id, retained.context) != identity(retained.event):
                raise TransferError("Restored refund withdrawal differs from its retained author.")
        else:
            if retained.action not in {"confirmed", "rejected"}:
                raise TransferError("Restored refund decision has an invalid action.")
            decision_event(retained, due.order_id, "refund_" + retained.action)
            retained_independent(dispute.order, retained.actor_id, retained.event.created_at)
            if (
                m.DisputeDecision.objects.filter(dispute__order_id=due.order_id, actor_id=retained.actor_id,
                                                created_at__lte=retained.event.created_at).exists()
                or p.RefundReport.objects.filter(due__order_id=due.order_id, actor__user_id=retained.actor_id,
                                                created_at__lte=retained.event.created_at).exists()
                or p.EvidenceBinding.objects.filter(evidence__order_id=due.order_id,
                                                    evidence__creator__user_id=retained.actor_id,
                                                    created_at__lte=retained.event.created_at).exists()
                or m.DisputeResponse.objects.filter(dispute__order_id=due.order_id, actor__user_id=retained.actor_id,
                                                    created_at__lte=retained.event.created_at).exists()
            ):
                raise TransferError("Restored dispute refund reviewer conflicts with retained deciders/authors.")
        if retained.event.version <= report.event.version or retained.event.created_at < report.event.created_at:
            raise TransferError("Restored refund decision precedes its report.")
    if p.RefundDecision.objects.filter(report__due=due, action="confirmed").count() > 1:
        raise TransferError("Restored dispute refund was confirmed more than once.")


def validate_reviews():
    from apps.foundation.contracts import LOCALES
    from apps.fulfilment import models as delivery

    for review in m.Review.objects.select_related("order__buyer", "order__seller__account", "buyer", "event__account").iterator(chunk_size=100):
        opening, order = review.event, review.order
        if review.buyer_id != order.buyer_id or review.buyer.context != "buyer":
            raise TransferError("Restored review differs from its one immutable order-buyer source.")
        participant_event(opening, order.pk, "review_submitted", review.buyer)
        command_event(opening, {"review_submit"}, "review", review.pk, state="pending")
        delivered = delivered_predecessor(order.pk, opening.created_at)
        completion = delivery.Completion.construction.filter(order_id=order.pk).select_related("event").first()
        if (
            completion is None or completion.delivery_id != delivered.pk
            or completion.event.order_id != order.pk or completion.event.action != "completed"
            or completion.event.created_at > opening.created_at or completion.created_at > opening.created_at
            or completion.event.version <= delivered.event.version
            or not delivery.Publication.objects.filter(event_id=completion.event_id).exists()
            or type(review.rating) is not int or not 1 <= review.rating <= 5 or review.language not in LOCALES
            or not 3 <= len(review.text.strip()) <= 2000
        ):
            raise TransferError("Restored review completion/rating/language/source is invalid.")
        state, version, last = "pending", 1, opening.version
        for decision in review.decisions.select_related("event__account").order_by("event__version").iterator(chunk_size=100):
            event = decision.event
            if event.version <= last or event.created_at < opening.created_at:
                raise TransferError("Restored review decision precedes its immutable source.")
            if decision.context == "buyer":
                if decision.action != "withdrawn" or state != "pending":
                    raise TransferError("Restored buyer review withdrawal has an invalid predecessor.")
                participant_event(event, order.pk, "review_withdrawn", review.buyer)
                if (decision.actor_id, decision.account_id, decision.context) != identity(event):
                    raise TransferError("Restored review withdrawal author differs.")
                actions = {"review_withdraw"}
            else:
                decision_event(decision, order.pk, "review_decided")
                retained_independent(order, decision.actor_id, event.created_at)
                if not (
                    state == "pending" and decision.action in {"approved", "rejected", "withdrawn"}
                    or state == "approved" and decision.action == "withdrawn"
                ):
                    raise TransferError("Restored review moderation has an invalid chronological transition.")
                actions = {"review_moderate_" + {"approved": "approve", "rejected": "reject", "withdrawn": "withdraw"}[decision.action]}
            command_event(event, actions, "review", review.pk, state=decision.action)
            state, last, version = decision.action, event.version, version + 1
        if state != review.state or version != review.version:
            raise TransferError("Restored review state/version differs from retained moderation history.")
        if m.CancellationDecision.objects.filter(
            request__order_id=order.pk, action="approved", event__created_at__lte=opening.created_at,
        ).exists() or (state == "approved" and m.CancellationDecision.objects.filter(request__order_id=order.pk, action="approved").exists()):
            raise TransferError("Restored approved/submitted review lacks completion eligibility.")
    for event in m.AftercareEvent.objects.filter(action__in=["review_submitted", "review_withdrawn", "review_decided"]).iterator(chunk_size=100):
        linked = (m.Review.objects.filter(event=event).exists() if event.action == "review_submitted"
                  else m.ReviewDecision.objects.filter(event=event).exists())
        if not linked:
            raise TransferError("Restored review event lacks its immutable source/decision.")
