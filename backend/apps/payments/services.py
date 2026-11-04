"""Guarded manual goods facts. A stock outage cannot roll back a committed receipt."""

import hashlib
from decimal import Decimal
from django.db import transaction, DatabaseError
from django.db.models import Q, Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied
from apps.accounts.models import User
from apps.organizations.access import Conflict
from apps.runtime.locks import lock
from . import access, queries, validation as v
from .models import (
    Finance,
    Event,
    Command,
    Claim,
    ClaimDecision,
    Receipt,
    ReceiptSeal,
    Correction,
    Extension,
    StockPlan,
    StockPlanLine,
    StockPlanSeal,
    AllocationIntent,
    ReviewCase,
    CaseEvent,
    NoticeCursor,
    Evidence,
    EvidenceBinding,
)


def coordinator(order):
    Finance.objects.get_or_create(order=order)
    return Finance.objects.select_for_update().get(order=order)


def expect(actual, submitted):
    if type(submitted) is not int or actual != submitted:
        raise Conflict()


def emit(order, state, action, actor=None):
    account = access.account_for(actor) if actor else None
    event = Event.objects.create(
        order=order,
        version=state.version + 1,
        action=action,
        actor=actor.user if actor else None,
        account=account,
        context=actor.context if actor else "system",
    )
    state.version += 1
    state.next_check_at = timezone.now()
    state.save(update_fields=["version", "next_check_at"])
    return event


def notify(event, *, generation=None, slot=None):
    from apps.notifications.models import Event as NoticeEvent

    NoticeEvent.objects.create(kind="payment", payment_event=event)
    NoticeCursor.objects.create(event=event, sender_id=event.actor_id, generation=generation, slot=slot)
    from apps.runtime.jobs import enqueue

    enqueue("payment_sweep")


def new_case(order, kind, resource, **fields):
    key = hashlib.sha256(f"{order.pk}:{kind}:{resource}".encode()).hexdigest()
    return ReviewCase.objects.get_or_create(key=key, defaults={"order": order, "kind": kind, **fields})[0]


def facts(order, data, *, zero=False):
    if data.get("currency", order.currency) != order.currency:
        v.fail("currency", "order_currency")
    return {
        "amount": v.money(data.get("amount"), zero=zero),
        "paid_at": v.paid_time(data.get("paid_at")),
        "description": v.text(data.get("description"), "description", 500, 1),
    }


def bind(actor, order, ids, **target):
    if not isinstance(ids, list) or len(ids) > 3 or len(set(str(x) for x in ids)) != len(ids):
        v.fail("evidence", "three_unique_images")
    account = access.account_for(actor)
    for pk in sorted(ids, key=str):
        item = get_object_or_404(
            Evidence.objects.select_for_update(),
            pk=pk,
            order=order,
            creator=account,
            expires_at__gt=timezone.now(),
            binding__isnull=True,
        )
        EvidenceBinding.objects.create(evidence=item, **target)


def previous(actor, order, key, action, digest):
    old = Command.objects.filter(pk=key).first()
    if not old:
        return None
    account = access.account_for(actor)
    if (
        old.actor_id != actor.user.pk
        or old.account_id != (account.pk if account else None)
        or old.context != actor.context
        or old.order_id != order.pk
        or old.action != action
        or old.digest != digest
    ):
        raise Conflict("This command identity is settled or was used for different input.")
    return old.result


def command_result(actor, order, key, action, digest, result):
    Command.objects.create(
        id=key,
        event_id=Event.construction.filter(order=order, version=result.get("version"), actor=actor.user)
        .values_list("pk", flat=True)
        .first()
        if result.get("version") is not None
        else None,
        actor=actor.user,
        account=access.account_for(actor),
        context=actor.context,
        order=order,
        action=action,
        digest=digest,
        result=v.canonical(result),
    )
    return result


def _claim(actor, order, state, data):
    if actor.context != "buyer":
        raise PermissionDenied()
    fields = facts(order, data)
    prior = None
    if data.get("previous"):
        prior = get_object_or_404(
            Claim.objects.select_for_update(),
            pk=data["previous"],
            order=order,
            actor=actor.account,
            decision__action__in=["withdrawn", "rejected"],
        )
        if Claim.objects.filter(previous=prior).exists():
            raise Conflict()
    event = emit(order, state, "claim_submitted", actor)
    item = Claim.objects.create(
        order=order, actor=actor.account, event=event, previous=prior, currency=order.currency, **fields
    )
    bind(actor, order, data.get("evidence", []), claim=item)
    notify(event)
    return {"claim": str(item.pk), "version": state.version}


def _claim_decision(actor, order, state, data, action):
    claim = get_object_or_404(Claim.objects.select_for_update(), pk=data["claim"], order=order)
    expect(1, data.get("claim_version"))
    if ClaimDecision.objects.filter(claim=claim).exists():
        raise Conflict()
    if action == "withdraw" and (actor.context != "buyer" or claim.actor_id != actor.account.pk):
        raise PermissionDenied()
    if action == "reject" and actor.context != "seller":
        raise PermissionDenied()
    event = emit(order, state, "claim_withdrawn" if action == "withdraw" else "claim_rejected", actor)
    decision = ClaimDecision.objects.create(
        claim=claim,
        actor=actor.account,
        event=event,
        action="withdrawn" if action == "withdraw" else "rejected",
        reason=v.text(data.get("reason")),
        version=2,
    )
    notify(event)
    return {"claim": str(claim.pk), "state": decision.action, "version": state.version}


def _receipt(actor, order, state, data, *, claim=None):
    if actor.context != "seller":
        raise PermissionDenied()
    if claim:
        expect(1, data.get("claim_version"))
        if ClaimDecision.objects.filter(claim=claim).exists() or Receipt.construction.filter(claim=claim).exists():
            raise Conflict()
        fields = {k: getattr(claim, k) for k in ["amount", "paid_at", "description"]}
    else:
        fields = facts(order, data)
    v.total([queries.confirmed(order), fields["amount"]])
    plan = None
    if data.get("plan"):
        plan = get_object_or_404(StockPlan, pk=data["plan"], order=order, replaces__isnull=True)
    event = emit(order, state, "receipt_confirmed", actor)
    receipt = Receipt.construction.create(
        order=order, claim=claim, actor=actor.account, event=event, currency=order.currency, **fields
    )
    new_case(order, "receipt", receipt.pk, receipt=receipt)
    if not claim:
        bind(actor, order, data.get("evidence", []), receipt=receipt)
    if order.payment_method == "advance":
        intent = AllocationIntent.objects.select_for_update().filter(order=order).first()
        if intent is None:
            plan = (
                plan or StockPlan.objects.filter(order=order, replaces__isnull=True).order_by("-event__version").first()
            )
            AllocationIntent.objects.create(
                order=order, first_receipt=receipt, plan=plan, state="pending" if plan else "awaiting_selection"
            )
        elif intent.state == "blocked_zero" and not intent.allocation_id:
            intent.state = "pending" if intent.plan_id else "awaiting_selection"
            intent.version += 1
            intent.save()
    if claim:
        ClaimDecision.objects.create(
            claim=claim,
            event=event,
            actor=actor.account,
            action="confirmed",
            reason=v.text(data.get("reason")),
            version=2,
        )
    ReceiptSeal.objects.create(receipt=receipt)
    notify(event)
    duplicate = (
        Receipt.objects.filter(
            order=order, amount=receipt.amount, paid_at=receipt.paid_at, description=receipt.description
        )
        .exclude(pk=receipt.pk)
        .exists()
    )
    return {
        "receipt": str(receipt.pk),
        "claim": str(claim.pk) if claim else None,
        "version": state.version,
        "duplicate_warning": duplicate,
    }


def _correction(actor, order, state, data):
    if actor.context != "seller":
        raise PermissionDenied()
    receipt = get_object_or_404(
        queries.effective_receipts(Receipt.objects.filter(order=order)).select_for_update(), pk=data["receipt"]
    )
    expect(receipt.effective_version, data.get("receipt_version"))
    if Correction.objects.filter(receipt=receipt).filter(Q(case__state="open") | Q(case__isnull=True)).exists():
        raise Conflict("A current correction is already pending.")
    fields = facts(order, data, zero=True)
    event = emit(order, state, "correction_proposed", actor)
    correction = Correction.objects.create(
        receipt=receipt,
        target_version=receipt.effective_version,
        actor=actor.account,
        event=event,
        reason=v.text(data.get("reason")),
        **fields,
    )
    bind(actor, order, data.get("evidence", []), correction=correction)
    case = new_case(order, "correction", correction.pk, receipt=receipt, correction=correction)
    notify(event)
    return {"correction": str(correction.pk), "case": str(case.pk), "version": state.version}


def _extension(actor, order, state, data):
    if actor.context != "seller" or order.payment_method != "advance":
        raise PermissionDenied()
    before, generation = queries.deadline(order)
    expect(generation, data.get("deadline_generation"))
    due = data.get("due_at")
    if not due or timezone.is_naive(due) or due <= before:
        v.fail("due_at", "later_deadline")
    event = emit(order, state, "deadline_extended", actor)
    extension = Extension.objects.create(
        order=order,
        generation=generation + 1,
        before_at=before,
        due_at=due,
        actor=actor.account,
        event=event,
        reason=v.text(data.get("reason")),
    )
    notify(event)
    return {"extension": str(extension.pk), "deadline_generation": generation + 1, "version": state.version}


def _plan(actor, order, state, data):
    from apps.inventory import services as stock
    from apps.inventory.validation import quantity
    from apps.catalogue.models import Variant
    from apps.inventory.models import Batch

    if actor.context != "seller" or order.payment_method != "advance":
        raise PermissionDenied()
    intent = AllocationIntent.objects.select_for_update().filter(order=order).first()
    expect(intent.version if intent else 0, data.get("intent_version"))
    if intent and intent.allocation_id:
        raise Conflict("An existing reservation cannot be replaced here.")
    replacement = None
    if data.get("replaces"):
        if not intent or intent.state != "shortage":
            raise Conflict()
        replacement = get_object_or_404(
            intent.attempts.filter(shortage__isnull=False), shortage_id=data["replaces"]
        ).shortage
    elif intent and intent.attempts.exists():
        raise Conflict("A changed shortage selection needs independent approval.")
    demand = {
        str(r["variant_id"]): r["quantity"] for r in order.lines.values("variant_id").annotate(quantity=Sum("quantity"))
    }
    selected = stock.normalize_lines(data.get("lines"))
    totals = {}
    rows = []
    for index, variant_id, batch_id, raw in selected:
        variant = get_object_or_404(
            Variant.objects.select_related("unit"), pk=variant_id, product__seller_id=order.seller_id
        )
        if str(variant_id) not in demand:
            v.fail("lines", "accepted_goods_only")
        q = quantity(raw, variant, f"lines.{index}.quantity")
        totals[str(variant_id)] = totals.get(str(variant_id), Decimal(0)) + q
        if batch_id:
            get_object_or_404(Batch, pk=batch_id, position_id=variant_id)
        rows.append((variant, batch_id, q))
    if totals != demand:
        v.fail("lines", "complete_accepted_quantities")
    event = emit(order, state, "replacement_proposed" if replacement else "stock_plan_submitted", actor)
    plan = StockPlan.construction.create(
        order=order,
        actor=actor.account,
        event=event,
        replaces=replacement,
        intent_version=intent.version if intent else 0,
        reason=v.text(data.get("reason")),
    )
    for variant, batch, q in rows:
        StockPlanLine.objects.create(plan=plan, variant=variant, batch_id=batch, quantity=q)
    if replacement:
        case = new_case(order, "replacement", plan.pk, plan=plan)
    StockPlanSeal.objects.create(plan=plan)
    if intent and not replacement:
        intent.plan = plan
        intent.state = "pending" if queries.confirmed(order) > 0 else "blocked_zero"
        intent.version += 1
        intent.save()
    notify(event)
    return {"plan": str(plan.pk), "case": str(case.pk) if replacement else None, "version": state.version}


def mutate(actor, pk, action, data):
    key = v.identifier(data.get("command_id"), "command_id")
    fingerprint = v.digest(action, pk, data)
    with transaction.atomic():
        lock("payments-command:" + str(key))
        order = access.lock_order(actor, pk, write=actor.context == "seller")
        if actor.context not in {"buyer", "seller"}:
            raise PermissionDenied()
        old = previous(actor, order, key, action, fingerprint)
        if old is not None:
            result = old
        else:
            state = coordinator(order)
            expect(state.version, data.get("version"))
            if action == "claim":
                result = _claim(actor, order, state, data)
            elif action in {"withdraw", "reject"}:
                result = _claim_decision(actor, order, state, data, action)
            elif action == "receipt":
                result = _receipt(actor, order, state, data)
            elif action == "confirm":
                claim = get_object_or_404(Claim.objects.select_for_update(), order=order, pk=data["claim"])
                result = _receipt(actor, order, state, data, claim=claim)
            elif action == "correction":
                result = _correction(actor, order, state, data)
            elif action == "extension":
                result = _extension(actor, order, state, data)
            elif action == "plan":
                result = _plan(actor, order, state, data)
            else:
                raise PermissionDenied()
            result = command_result(actor, order, key, action, fingerprint, result)
    # The receipt/command/intent transaction is committed before stock can fail.
    if action in {"receipt", "confirm", "plan"}:
        try:
            from .allocation import execute

            execute(order.pk)
        except (DatabaseError, OSError):
            pass  # The already-committed intent is recovered by the bounded sweep.
    current = queries.detail(actor, order.pk)
    return {"outcome": result, "current": current}


def reconcile(actor, pk, key, *, settle=False):
    key = v.identifier(key)
    with transaction.atomic():
        lock("payments-command:" + str(key))
        order = access.lock_order(actor, pk)
        row = Command.objects.filter(pk=key).first()
        account = access.account_for(actor)
        if row:
            if (
                row.actor_id != actor.user.pk
                or row.account_id != (account.pk if account else None)
                or row.context != actor.context
                or row.order_id != order.pk
            ):
                raise PermissionDenied()
            return {
                "state": "absent_fenced" if row.action == "absence_fence" else "committed",
                "outcome": row.result,
                "current": queries.detail(actor, pk),
            }
        if not settle:
            from rest_framework.exceptions import NotFound

            raise NotFound()
        command_result(actor, order, key, "absence_fence", "0" * 64, {"settled": True})
        return {"state": "absent_fenced", "outcome": {"settled": True}, "current": queries.detail(actor, pk)}


def reviewers(case):
    permission = {
        "correction": "decide_payment_correction",
        "replacement": "decide_payment_shortage",
        "shortage": "decide_payment_shortage",
        "receipt": "review_payment",
    }.get(case.kind, "review_overdue")
    candidates = (
        User.objects.filter(is_active=True, email_verified=True, is_staff=True)
        .filter(
            Q(is_superuser=True)
            | Q(
                accounts__context="staff",
                accounts__status="active",
                groups__permissions__content_type__app_label="payments",
                groups__permissions__codename=permission,
            )
        )
        .filter(
            Q(is_superuser=True)
            | Q(
                groups__permissions__content_type__app_label="payments",
                groups__permissions__codename="read_payments",
            )
        )
        .distinct()
        .order_by("pk")
    )
    # Native assignment choices are bounded; no contacts/email in the form label.
    result = []
    for user in candidates[:200]:
        try:
            access.independent(case.order, user)
        except PermissionDenied:
            continue
        result.append(user)
    return result


def decide(actor, pk, data):
    key = v.identifier(data.get("command_id"))
    action = data["action"]
    initial = get_object_or_404(access.case_scope(actor).select_related("order"), pk=pk)
    fingerprint = v.digest("case_" + action, initial.order_id, data)
    with transaction.atomic():
        lock("payments-command:" + str(key))
        order = access.lock_order(
            actor,
            initial.order_id,
            additional_users=([data["assigned_to"]] if action == "assign" and data.get("assigned_to") else []),
            assignment=action == "assign",
        )
        case = get_object_or_404(
            access.case_scope(actor).select_for_update().select_related("correction__receipt", "plan"), pk=pk
        )
        old = previous(actor, order, key, "case_" + action, fingerprint)
        if old is not None:
            result = old
        else:
            state = coordinator(order)
            expect(state.version, data.get("version"))
            expect(case.version, data.get("case_version"))
            required = {
                "correction": "decide_payment_correction",
                "replacement": "decide_payment_shortage",
                "shortage": "decide_payment_shortage",
                "receipt": "review_payment",
            }.get(case.kind, "review_overdue")
            assigned = None
            if action == "assign":
                if "assign_payment_case" not in access.rights(actor):
                    raise PermissionDenied()
                if data.get("assigned_to"):
                    assigned = next((u for u in reviewers(case) if str(u.pk) == str(data["assigned_to"])), None)
                    if assigned is None:
                        raise PermissionDenied("Choose an eligible independent reviewer.")
            else:
                access.require_case(actor, case, required, decide=True)
                if case.state != "open":
                    raise Conflict()
                if action not in {"approve", "reject", "replenish", "refer", "resolve"}:
                    v.fail("action")
                if case.kind == "correction":
                    if action not in {"approve", "reject"}:
                        v.fail("action")
                    receipt = queries.effective_receipts(Receipt.objects.filter(pk=case.correction.receipt_id)).get()
                    expect(receipt.effective_version, case.correction.target_version)
                    if action == "approve":
                        v.total([queries.confirmed(order) - receipt.effective_amount, case.correction.amount])
                elif case.kind == "replacement":
                    if action not in {"approve", "reject"}:
                        v.fail("action")
                    if action == "approve":
                        intent = AllocationIntent.objects.select_for_update().get(order=order)
                        expect(intent.version, case.plan.intent_version)
                        if intent.allocation_id:
                            raise Conflict()
                elif case.kind == "shortage":
                    if action not in {"replenish", "refer", "resolve"}:
                        v.fail("action")
                    if (
                        action == "replenish"
                        and AllocationIntent.objects.filter(order=order, allocation__isnull=False).exists()
                    ):
                        raise Conflict("Existing held stock cannot be reassigned here.")
                elif case.kind == "receipt":
                    if action not in {"approve", "reject"}:
                        v.fail("action")
                    if not Receipt.objects.filter(pk=case.receipt_id).exists():
                        raise Conflict("Only a published seller-confirmed receipt can be reviewed.")
                elif case.kind in {"overdue", "zero_balance"} and action not in {"resolve", "refer"}:
                    v.fail("action")
            event = emit(order, state, "case_" + action, actor)
            reason = v.text(data.get("reason"))
            access.audit(actor, case, "payment_case_" + action, reason)
            CaseEvent.objects.create(
                case=case,
                event=event,
                version=case.version + 1,
                action=action,
                actor=actor.user,
                account=access.account_for(actor),
                context=actor.context,
                assigned_to=assigned if action == "assign" else case.assigned_to,
                reason=reason,
            )
            case.version += 1
            if action == "assign":
                case.assigned_to = assigned
            elif action in {"approve", "reject", "resolve", "refer"}:
                case.state = {"approve": "approved", "reject": "rejected", "resolve": "resolved", "refer": "referred"}[
                    action
                ]
            case.save(update_fields=["version", "assigned_to", "state"])
            if case.kind == "replacement" and action == "approve":
                intent.plan = case.plan
                intent.state = "pending" if queries.confirmed(order) > 0 else "blocked_zero"
                intent.version += 1
                intent.save()
            if case.kind == "shortage" and action == "replenish":
                intent = AllocationIntent.objects.select_for_update().get(order=order)
                if not intent.allocation_id:
                    intent.state = "pending" if queries.confirmed(order) > 0 else "blocked_zero"
                    intent.version += 1
                    intent.save()
            if case.kind == "correction" and action == "approve" and queries.confirmed(order) == 0:
                intent = AllocationIntent.objects.select_for_update().filter(order=order).first()
                if not ReviewCase.objects.filter(order=order, kind="zero_balance", state="open").exists():
                    new_case(
                        order,
                        "zero_balance",
                        case.correction_id,
                        receipt=case.correction.receipt,
                        generation=state.version,
                    )
                if intent:
                    if not intent.allocation_id:
                        intent.state = "blocked_zero"
                        intent.version += 1
                        intent.save()
            notify(event)
            result = command_result(
                actor,
                order,
                key,
                "case_" + action,
                fingerprint,
                {"case": str(case.pk), "case_version": case.version, "version": state.version, "state": case.state},
            )
    if action in {"approve", "replenish"}:
        try:
            from .allocation import execute

            execute(order.pk)
        except (DatabaseError, OSError):
            pass
    return result
