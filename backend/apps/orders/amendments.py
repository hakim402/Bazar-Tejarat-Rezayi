"""Seller-proposed accepted amendments and independent staff decisions.

An amendment may only decrease an accepted line quantity or unit price before
dispatch. Original accepted lines stay frozen; effective values are projected
from the latest approved amendment."""

import uuid

from decimal import Decimal

from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.catalogue.models import Variant
from apps.foundation.independence import eligible_reviewers
from apps.foundation.money import ZERO, MoneyError, line_amount, parse
from apps.inventory.validation import quantity as quantity_of
from apps.marketplace.access import eligible_profiles
from apps.organizations.access import Conflict
from apps.payments.access import account_for, audit
from apps.payments.validation import fail
from apps.runtime.locks import lock
from . import access
from . import aftercare as projection
from . import aftercare_commands as base
from .models import Amendment, AmendmentDecision, AmendmentLine, InvoiceAdjustment, SellerOrder


def refuse(code):
    fail("amendment", code)


def proposers(actor):
    if actor.context != "seller":
        raise PermissionDenied()
    return SellerOrder.objects.filter(seller_id__in=access.profiles(actor.account).values("pk"))


def eligible_seller(order):
    if not eligible_profiles([order.seller_id]).filter(pk=order.seller_id).exists():
        raise PermissionDenied("Current business approval is required.")


def order_scope(actor):
    if actor.context == "owner":
        return SellerOrder.objects.all()
    if actor.context == "staff":
        return SellerOrder.objects.filter(amendments__in=access.amendment_scope(actor)).distinct()
    return proposers(actor)


def terminal(order):
    """Refusals that hold even while this proposal is the open one."""
    if projection.dispatched(order) or projection.completed(order):
        refuse("amendment_ineligible_dispatched")
    if projection.cancelled(order):
        refuse("amendment_ineligible_dispatched")


def eligibility(order):
    terminal(order)
    if projection.pending_amendment(order):
        refuse("amendment_proposal_pending")


def validate_lines(order, rows):
    """Decrease-only per-line rules against the current effective values."""
    effective = {item["line"].pk: item for item in projection.effective_lines(order)}
    seen = set()
    result = []
    if not isinstance(rows, list) or not 1 <= len(rows) <= 100:
        fail("lines", "length")
    variants = {
        v.pk: v
        for v in Variant.objects.select_related("unit").filter(
            pk__in={item["line"].variant_id for item in effective.values()}
        )
    }
    for index, row in enumerate(rows):
        if not isinstance(row, dict) or set(row) - {"line", "quantity", "unit_price"}:
            fail(f"lines.{index}")
        try:
            line_id = uuid.UUID(str(row.get("line")))
        except (ValueError, TypeError, AttributeError):
            fail(f"lines.{index}.line")
        if line_id in seen:
            fail(f"lines.{index}.line", "duplicate")
        seen.add(line_id)
        current = effective.get(line_id)
        if current is None:
            fail(f"lines.{index}.line", "accepted_line_required")
        variant = variants[current["line"].variant_id]
        try:
            proposed_quantity = quantity_of(row.get("quantity"), variant, f"lines.{index}.quantity")
        except ValidationError as error:
            codes = {getattr(code, "code", None) for values in error.detail.values() for code in values}
            refuse("amendment_zero_quantity" if "quantity" in codes else "amendment_invalid_increment")
        proposed_price = row.get("unit_price")
        if not isinstance(proposed_price, str):
            fail(f"lines.{index}.unit_price", "exact_money_string")
        try:
            proposed_price = parse(proposed_price)
        except MoneyError as error:
            fail(f"lines.{index}.unit_price", "exact_money_string" if error.kind == "format" else "positive_money")
        if proposed_quantity >= current["quantity"]:
            refuse("amendment_increase_refused")
        if proposed_price > current["unit_price"]:
            refuse("amendment_increase_refused")
        if current["line"].tier == "wholesale" and proposed_quantity < variant.minimum_wholesale:
            refuse("amendment_below_wholesale_minimum")
        result.append((current["line"], proposed_quantity, proposed_price))
    return result


def amendment_totals(order, rows):
    """Exact per-line ROUND_HALF_UP amounts; unchanged lines keep their values."""
    changed = {line.pk: quantity for line, quantity, _ in rows}
    prices = {line.pk: price for line, _, price in rows}
    total = ZERO
    lines = []
    for item in projection.effective_lines(order):
        line = item["line"]
        quantity = changed.get(line.pk, item["quantity"])
        price = prices.get(line.pk, item["unit_price"])
        amount = line_amount(price, quantity)
        total += amount
        lines.append((line, quantity, price, amount))
    return total, lines


def independent(order, user, *, amendment=None):
    from apps.payments.access import independent as goods_independent

    goods_independent(order, user)
    access.aftercare_participant(order, user)
    if amendment is not None and amendment.actor.user_id == user.pk:
        raise PermissionDenied("An independent reviewer is required.")


def reviewers(amendment):
    return eligible_reviewers(
        "orders",
        "read_aftercare",
        "decide_amendment",
        lambda user: independent(amendment.order, user, amendment=amendment),
    )


def _propose(actor, order, state, data):
    if actor.context != "seller":
        raise PermissionDenied()
    eligible_seller(order)
    eligibility(order)
    rows = validate_lines(order, data.get("lines"))
    total, _ = amendment_totals(order, rows)
    reason = base.text(data.get("reason"))
    event = base.emit(order, state, "amendment_proposed", actor)
    amendment = Amendment.objects.create(
        order=order, actor=account_for(actor), after_total=total, reason=reason, event=event
    )
    for line, quantity, price in rows:
        AmendmentLine.objects.create(amendment=amendment, line=line, proposed_quantity=quantity, proposed_unit_price=price)
    base.notify(order, event, sender=actor.user)
    return {"amendment": str(amendment.pk), "state": amendment.state, "version": state.version}


def _withdraw(actor, order, state, data):
    amendment = get_object_or_404(
        Amendment.objects.select_for_update(), pk=data.get("amendment"), order=order, state="pending", actor=actor.account
    )
    if actor.context != "seller":
        refuse("amendment_not_proposer")
    reason = base.text(data.get("reason"))
    event = base.emit(order, state, "amendment_withdrawn", actor)
    amendment.state = "withdrawn"
    amendment.version += 1
    amendment.save(update_fields=["state", "version"])
    base.notify(order, event, sender=actor.user)
    audit(actor, amendment, "amendment_withdrawn", reason)
    return {"amendment": str(amendment.pk), "state": amendment.state, "version": state.version}


def mutate(actor, pk, action, data):
    action = "amendment_withdraw" if action == "withdraw" else action
    key = base.identifier(data.get("command_id"))
    fingerprint = base.digest_of(action, pk, data)
    with transaction.atomic():
        lock("aftercare-command:" + str(key))
        order = base.lock_order(actor, pk, proposers(actor))
        if actor.context != "seller":
            raise PermissionDenied()
        old = base.previous(actor, order, key, action, fingerprint)
        if old is not None:
            result = old
        else:
            _, state = base.ordered_state(order)
            base.expect(state.version, data.get("version"), refuse, "amendment_stale_version")
            if action == "propose":
                result = _propose(actor, order, state, data)
            elif action == "amendment_withdraw":
                result = _withdraw(actor, order, state, data)
            else:
                raise PermissionDenied()
            result = base.remember(actor, order, key, action, fingerprint, result)
    return result


def reconcile(actor, order_pk, key):
    return base.lookup(actor, order_pk, base.identifier(key), proposers(actor))


def settle(actor, order_pk, key):
    return base.lookup(actor, order_pk, base.identifier(key), proposers(actor), fence=True)


def write_adjustment(actor, order, event, reason, *, amendment, before_lines, after_lines, before_total, after_total):
    return InvoiceAdjustment.objects.create(
        order=order,
        invoice=order.invoice,
        cause="amendment",
        amendment=amendment,
        before_lines=before_lines,
        after_lines=after_lines,
        before_total=before_total,
        after_total=after_total,
        reason=reason,
        actor=actor.user,
        event=event,
    )


def after_lines_snapshot(lines):
    return [
        {
            "line": str(line.pk),
            "variant": str(line.variant_id),
            "tier": line.tier,
            "quantity": format(quantity, ".3f"),
            "unit_price": format(price, ".2f"),
            "goods_amount": format(amount, ".2f"),
        }
        for line, quantity, price, amount in lines
    ]


def _approve(actor, order, state, finance, amendment, data, key):
    from apps.inventory.payment_allocation import release_partial
    from apps.inventory.payment_allocation import RecordedIdentity
    from apps.payments.queries import confirmed
    from apps.payments import refunds

    terminal(order)
    eligible_seller(order)
    rows = validate_lines(order, [line_row(row) for row in amendment.lines.all()])
    total, lines = amendment_totals(order, rows)
    if total != amendment.after_total:
        raise Conflict("The retained proposal no longer matches current accepted lines.")
    current_quantities = {item["line"].pk: item["quantity"] for item in projection.effective_lines(order)}
    before = projection.before_lines_snapshot(order)
    before_total = projection.accepted_total(order)
    reason = base.text(data.get("reason"))
    event = base.emit(order, state, "amendment_approved", actor)
    AmendmentDecision.objects.create(
        amendment=amendment,
        event=event,
        actor=actor.user,
        account=account_for(actor),
        context=actor.context,
        action="approved",
        reason=reason,
    )
    amendment.state = "approved"
    amendment.version += 1
    amendment.save(update_fields=["state", "version"])
    reductions = {}
    for line, quantity, _ in rows:
        variant = str(line.variant_id)
        reductions[variant] = reductions.get(variant, Decimal("0.000")) + (current_quantities[line.pk] - quantity)
    reductions = {variant: value for variant, value in reductions.items() if value > 0}
    release = None
    if reductions:
        token = uuid.uuid5(order.pk, "amendment-release:" + str(key))
        release = release_partial(
            order,
            reductions,
            token,
            RecordedIdentity(actor.user, account_for(actor), actor.context),
            "amendment:" + str(amendment.pk),
        )
    received = confirmed(order)
    amount = max(received - total - refunds.due_total(order), ZERO)
    due = refunds.create_due(order, finance, actor, "amendment", amount, reason) if amount > ZERO else None
    write_adjustment(
        actor,
        order,
        event,
        reason,
        amendment=amendment,
        before_lines=before,
        after_lines=after_lines_snapshot(lines),
        before_total=before_total,
        after_total=total,
    )
    base.notify(order, event, sender=None)
    audit(actor, amendment, "amendment_approved", reason)
    return {
        "amendment": str(amendment.pk),
        "state": amendment.state,
        "version": state.version,
        "accepted_total": format(total, ".2f"),
        "release": str(release["operation"]) if release else None,
        "refund_due": str(due.pk) if due else None,
    }


def line_row(amendment_line):
    return {
        "line": str(amendment_line.line_id),
        "quantity": format(amendment_line.proposed_quantity, ".3f"),
        "unit_price": format(amendment_line.proposed_unit_price, ".2f"),
    }


def _reject(actor, order, state, amendment, data):
    terminal(order)
    reason = base.text(data.get("reason"))
    event = base.emit(order, state, "amendment_rejected", actor)
    AmendmentDecision.objects.create(
        amendment=amendment,
        event=event,
        actor=actor.user,
        account=account_for(actor),
        context=actor.context,
        action="rejected",
        reason=reason,
    )
    amendment.state = "rejected"
    amendment.version += 1
    amendment.save(update_fields=["state", "version"])
    base.notify(order, event, sender=None)
    audit(actor, amendment, "amendment_rejected", reason)
    return {"amendment": str(amendment.pk), "state": amendment.state, "version": state.version}


def decide(actor, pk, data):
    key = base.identifier(data.get("command_id"))
    action = data.get("action")
    initial = get_object_or_404(access.amendment_scope(actor).select_related("order"), pk=pk)
    if action not in {"assign", "approve", "reject"}:
        fail("action")
    fingerprint = base.digest_of("amendment_" + action, initial.order_id, data)
    token = uuid.uuid5(initial.order_id, "amendment-release:" + str(key)) if action == "approve" else None
    with transaction.atomic():
        lock("aftercare-command:" + str(key))
        if token is not None:
            lock(int(token.hex[:15], 16))
        additional = [base.identifier(data["assigned_to"])] if action == "assign" and data.get("assigned_to") else []
        order = base.lock_order(actor, initial.order_id, order_scope(actor), additional_users=additional)
        amendment = get_object_or_404(access.amendment_scope(actor).select_for_update(), pk=pk)
        old = base.previous(actor, order, key, "amendment_" + action, fingerprint)
        if old is not None:
            return old
        finance, state = base.ordered_state(order)
        base.expect(state.version, data.get("version"), refuse, "amendment_stale_version")
        base.expect(amendment.version, data.get("amendment_version"), refuse, "amendment_stale_version")
        assigned = None
        if action == "assign":
            if "assign_aftercare" not in access.aftercare_rights(actor):
                raise PermissionDenied()
            if data.get("assigned_to"):
                assigned = next((u for u in reviewers(amendment) if str(u.pk) == str(data["assigned_to"])), None)
                if assigned is None:
                    raise PermissionDenied("Choose an eligible independent reviewer.")
        else:
            if amendment.state != "pending":
                raise Conflict("This amendment already has a retained decision.")
            if "decide_amendment" not in access.aftercare_rights(actor):
                raise PermissionDenied()
            if amendment.assigned_to_id != actor.user.pk:
                raise PermissionDenied("Assign an independent eligible reviewer first.")
            independent(order, actor.user, amendment=amendment)
        if action == "assign":
            base.emit(order, state, "amendment_assigned", actor)
            amendment.assigned_to = assigned
        elif action == "approve":
            result = _approve(actor, order, state, finance, amendment, data, key)
        else:
            result = _reject(actor, order, state, amendment, data)
        if action == "assign":
            amendment.version += 1
            amendment.save(update_fields=["assigned_to", "version"])
            audit(actor, amendment, "amendment_assigned", base.text(data.get("reason")))
            result = {"amendment": str(amendment.pk), "state": amendment.state, "version": state.version}
        return base.remember(actor, order, key, "amendment_" + action, fingerprint, result)
