"""Formal per-seller requests. No expiry, buyer impersonation or stock writes."""

import json
from decimal import Decimal
from django.db import connection, transaction, OperationalError
from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import PermissionDenied, ValidationError
from apps.accounts.models import Account, User
from apps.cart.models import Cart, CartLine
from apps.inventory.validation import quantity
from apps.catalogue.models import Variant
from apps.catalogue.media import StorageUnavailable
from apps.organizations.models import BusinessProfile
from apps.messaging.services import digest, CommandConflict
from . import access, services as commerce
from .models import (
    Negotiation,
    NegotiationSubmission,
    NegotiationOutcome,
    NegotiationRevision,
    NegotiationEvent,
    NegotiationCommand,
)


def canonical(data):
    return json.loads(json.dumps(data, default=str))


def scope(actor, seller=None):
    account = actor.account
    if actor.context == "buyer":
        if seller is not None:
            raise PermissionDenied()
        return Negotiation.objects.filter(buyer=account)
    if actor.context != "seller":
        raise PermissionDenied()
    profiles = access.profiles(account)
    if seller is not None:
        profiles = profiles.filter(pk=get_object_or_404(profiles, pk=seller).pk)
    return Negotiation.objects.filter(seller_id__in=profiles.values("pk"))


def participant_locks(actor, seller_id, buyer_id, *, require_buyer=True):
    # Complete profile set precedes sorted identities; avoid buyer/seller lock inversion.
    buyer = Account.objects.get(pk=buyer_id)
    business = BusinessProfile.objects.filter(account=buyer, kind="business").first()
    ids = [seller_id] + ([business.pk] if business else [])
    list(BusinessProfile.objects.select_for_update().filter(pk__in=ids).order_by("pk"))
    accounts = list(Account.objects.filter(pk__in=[buyer_id, actor.account.pk]).order_by("pk"))
    list(User.objects.select_for_update().filter(pk__in=[a.user_id for a in accounts]).order_by("pk"))
    list(Account.objects.select_for_update().filter(pk__in=[a.pk for a in accounts]).order_by("pk"))
    access.lock_actor(actor)
    buyer = Account.objects.select_related("user").get(pk=buyer_id)
    if (
        buyer.context != "buyer"
        or require_buyer
        and (buyer.status != "active" or not buyer.user.is_active or not buyer.user.email_verified)
    ):
        raise PermissionDenied()
    fresh = BusinessProfile.objects.filter(account=buyer, kind="business").first()
    if (fresh.pk if fresh else None) != (business.pk if business else None):
        raise CommandConflict()
    return buyer


def selection_set(lines):
    keys = [(str(x["variant"]), x["tier"]) for x in lines]
    if not keys or len(keys) > 100 or len(set(keys)) != len(keys):
        raise ValidationError({"lines": ["unique_selection"]})
    return set(keys)


def validate_proposal(buyer, profile, proposal, currency, original=None):
    lines = proposal["lines"]
    keys = selection_set(lines)
    if original is not None and keys != selection_set(original["lines"]):
        raise ValidationError({"lines": ["stable_selection"]})
    if str(proposal["choice"]["seller"]) != str(profile.pk):
        raise ValidationError({"choice": ["seller"]})
    variants = {str(v.pk): v for v in Variant.objects.filter(pk__in=[x[0] for x in keys]).select_related("unit")}
    for i, line in enumerate(lines):
        v = variants.get(str(line["variant"]))
        if v is None:
            raise ValidationError({f"lines.{i}": ["unavailable"]})
        qty = quantity(line["quantity"], v)
        cap = quantity(line["max_quantity"], v)
        price, max_price = Decimal(line["unit_price"]), Decimal(line["max_unit_price"])
        if not (0 < price <= max_price < Decimal("1e9")) or qty > cap:
            raise ValidationError({f"lines.{i}": ["buyer_limits"]})
    prepared, total, snapshot = commerce.validate_seller(
        buyer, profile, canonical(lines), canonical(proposal["choice"]), currency, mode="negotiable"
    )
    # Preserve approved publication/party context at every buyer revision, never stored contacts.
    return {
        **canonical(proposal),
        "context": {
            "buyer": snapshot["buyer"],
            "seller": snapshot["seller"],
            "terms": snapshot["terms"],
            "products": [
                {**p["snapshot"], "variant": str(p["variant"].pk), "tier": p["row"]["tier"]} for p in prepared
            ],
        },
        "goods_total": format(total, ".2f"),
    }


def event(row, actor, action, reason="", state=None):
    e = NegotiationEvent.objects.create(
        request=row,
        version=row.version,
        revision=row.revision,
        actor=actor.account,
        action=action,
        reason=reason,
        state=state or {},
    )
    from apps.notifications.negotiation_events import committed

    committed(e, actor.account)
    return e


@transaction.atomic
def create_submission(actor, data):
    if actor.context != "buyer":
        raise PermissionDenied()
    seller_ids = CartLine.objects.filter(cart__account=actor.account, pk__in=data["lines"]).values_list(
        "variant__product__seller_id", flat=True
    )
    profile_ids = list(seller_ids) + list(
        BusinessProfile.objects.filter(account=actor.account, kind="business").values_list("pk", flat=True)
    )
    list(BusinessProfile.objects.select_for_update().filter(pk__in=profile_ids).order_by("pk"))
    access.lock_actor(actor)
    payload = canonical({k: v for k, v in data.items() if k != "command_id"})
    payload["lines"] = sorted(payload["lines"])
    payload["proposals"] = sorted(payload["proposals"], key=lambda x: x["choice"]["seller"])
    for p in payload["proposals"]:
        p["lines"] = sorted(p["lines"], key=lambda x: (x["variant"], x["tier"]))
    hashed = digest(payload)
    old = NegotiationSubmission.objects.filter(buyer=actor.account, key=data["command_id"]).first()
    if old:
        if old.digest != hashed:
            raise CommandConflict()
        return old
    from .models import NegotiationSubmissionFence

    if NegotiationSubmissionFence.objects.filter(buyer=actor.account, key=data["command_id"]).exists():
        raise CommandConflict()
    cart = get_object_or_404(Cart.objects.select_for_update(), account=actor.account)
    if cart.version != data["version"]:
        raise CommandConflict()
    if len(set(data["lines"])) != len(data["lines"]):
        raise ValidationError({"lines": ["duplicate"]})
    lines = list(cart.lines.filter(pk__in=data["lines"]).select_related("variant__product").order_by("pk"))
    if len(lines) != len(data["lines"]) or any(
        line.variant.product.currency != data["currency"] or line.variant.product.pricing_mode != "negotiable"
        for line in lines
    ):
        raise ValidationError({"lines": ["negotiable_currency_only"]})
    sellers = {str(line.variant.product.seller_id) for line in lines}
    if (
        len(sellers) > 20
        or len(payload["proposals"]) != len(sellers)
        or {p["choice"]["seller"] for p in payload["proposals"]} != sellers
    ):
        raise ValidationError({"proposals": ["one_per_seller"]})
    for p in payload["proposals"]:
        selected = {
            (str(line.variant_id), line.tier)
            for line in lines
            if str(line.variant.product.seller_id) == p["choice"]["seller"]
        }
        if selection_set(p["lines"]) != selected:
            raise ValidationError({"lines": ["exact_cart_selection"]})
    row = NegotiationSubmission.objects.create(
        buyer=actor.account,
        cart=cart,
        key=data["command_id"],
        digest=hashed,
        payload=payload,
        selections=[
            {
                "line": str(line.pk),
                "variant": str(line.variant_id),
                "tier": line.tier,
                "version": line.version,
                "quantity": format(line.quantity, ".3f"),
                "seller": str(line.variant.product.seller_id),
            }
            for line in lines
        ],
    )
    NegotiationOutcome.objects.bulk_create([NegotiationOutcome(submission=row, seller_id=s) for s in sorted(sellers)])
    return row


@transaction.atomic
def create_seller(actor, submission, pk):
    preliminary = NegotiationOutcome.objects.get(pk=pk, submission=submission)
    buyer = participant_locks(actor, preliminary.seller_id, submission.buyer_id)
    outcome = NegotiationOutcome.objects.select_for_update().get(pk=pk)
    if outcome.state != "pending":
        return outcome
    p = next(p for p in submission.payload["proposals"] if p["choice"]["seller"] == str(outcome.seller_id))
    profile = BusinessProfile.objects.get(pk=outcome.seller_id)
    body = validate_proposal(buyer, profile, p, submission.payload["currency"])
    row = Negotiation.objects.create(
        outcome=outcome, buyer=buyer, seller=profile, currency=submission.payload["currency"]
    )
    NegotiationRevision.objects.create(request=row, number=1, actor=buyer, body=body)
    event(row, actor, "submitted")
    cart = Cart.objects.select_for_update().get(pk=submission.cart_id)
    removed = 0
    for selected in submission.selections:
        if selected["seller"] == str(profile.pk):
            removed += CartLine.objects.filter(
                cart=cart, pk=selected["line"], version=selected["version"], quantity=selected["quantity"]
            ).delete()[0]
    if removed:
        cart.version += 1
        cart.save()
    outcome.state = "submitted"
    outcome.version += 1
    outcome.save()
    return outcome


@transaction.atomic
def failure(actor, pk, code, terminal):
    access.lock_actor(actor)
    outcome = get_object_or_404(NegotiationOutcome.objects.select_for_update(), pk=pk, submission__buyer=actor.account)
    if outcome.state == "pending":
        outcome.state = "failed" if terminal else "pending"
        outcome.code = code
        outcome.version += 1
        outcome.save()


def submit(actor, data):
    row = create_submission(actor, data)
    return resume(actor, row.pk)


def resume(actor, pk):
    row = get_object_or_404(NegotiationSubmission, buyer=actor.account, pk=pk)
    for outcome in row.outcomes.order_by("seller_id"):
        if outcome.state != "pending":
            continue
        try:
            create_seller(actor, row, outcome.pk)
        except commerce.SellerFailure as exc:
            failure(actor, outcome.pk, exc.code, True)
        except ValidationError:
            failure(actor, outcome.pk, "selection_invalid", True)
        except (StorageUnavailable, OperationalError, OSError):
            failure(actor, outcome.pk, "dependency_unavailable", False)
    return submission_data(row)


def submission_data(row):
    results = []
    for o in row.outcomes.select_related("request").order_by("seller_id"):
        results.append(
            {
                "seller": str(o.seller_id),
                "state": o.state,
                "code": o.code,
                "request": str(o.request.pk) if o.state == "submitted" else None,
            }
        )
    return {
        "id": str(row.pk),
        "currency": row.payload["currency"],
        "pending": any(o["state"] == "pending" for o in results),
        "outcomes": results,
    }


@transaction.atomic
def preview_submission(actor, data):
    # Read-only preview validates selection and terms without allocating durable rows.
    if actor.context != "buyer":
        raise PermissionDenied()
    cart = get_object_or_404(Cart, account=actor.account)
    if cart.version != data["version"]:
        raise CommandConflict()
    selected = list(cart.lines.filter(pk__in=data["lines"]).select_related("variant__product"))
    if len(selected) != len(data["lines"]) or len(set(data["lines"])) != len(selected):
        raise ValidationError({"lines": ["selection"]})
    if any(
        line.variant.product.pricing_mode != "negotiable" or line.variant.product.currency != data["currency"]
        for line in selected
    ):
        raise ValidationError({"lines": ["negotiable_currency_only"]})
    results = []
    sellers = {str(line.variant.product.seller_id) for line in selected}
    if len(data["proposals"]) != len(sellers) or {str(p["choice"]["seller"]) for p in data["proposals"]} != sellers:
        raise ValidationError({"proposals": ["one_per_seller"]})
    for p in data["proposals"]:
        sid = p["choice"]["seller"]
        profile = get_object_or_404(BusinessProfile, pk=sid)
        if selection_set(p["lines"]) != {
            (str(line.variant_id), line.tier) for line in selected if str(line.variant.product.seller_id) == str(sid)
        }:
            raise ValidationError({"lines": ["exact_cart_selection"]})
        try:
            body = validate_proposal(actor.account, profile, p, data["currency"])
            results.append({"seller": str(sid), "code": "ready", "goods_total": body["goods_total"]})
        except commerce.SellerFailure as exc:
            results.append({"seller": str(sid), "code": exc.code})
    return {"results": results, "binding": False}


def request_data(row, context, history_page=1, *, include_history=True):
    current = row.revisions.get(number=row.revision)
    order = getattr(row, "order", None) if row.state == "accepted" else None
    actions = []
    if row.state in ["submitted", "correction_requested"]:
        actions = ["withdraw"] if context == "buyer" else ["reject"]
        if row.state == "correction_requested" and context == "buyer":
            actions += ["resubmit"]
        if row.state == "submitted" and context == "seller":
            actions += ["request-correction", "finalize"]
    count = row.events.count() if include_history else 0
    events = (
        list(row.events.order_by("version")[(history_page - 1) * 20 : history_page * 20]) if include_history else []
    )
    numbers = [e.revision for e in events if e.action in ["submitted", "resubmitted"]]
    revisions = {r.number: r for r in row.revisions.filter(number__in=numbers)}
    history = []
    for e in events:
        revision = revisions.get(e.revision) if e.action in ["submitted", "resubmitted"] else None
        if revision:
            history.append(
                {
                    "revision": revision.number,
                    "actor": str(revision.actor_id),
                    "action": "buyer_proposal",
                    "proposal": revision.body,
                    "at": revision.created_at.isoformat(),
                }
            )
        history.append(
            {
                "version": e.version,
                "revision": e.revision,
                "actor": str(e.actor_id),
                "action": e.action,
                "reason": e.reason,
                "state": e.state,
                "at": e.created_at.isoformat(),
            }
        )
    return {
        "id": str(row.pk),
        "seller": str(row.seller_id),
        "buyer": current.body["context"]["buyer"],
        "seller_name": current.body["context"]["seller"],
        "currency": row.currency,
        "state": row.state,
        "version": row.version,
        "revision": row.revision,
        "created_at": row.created_at,
        "proposal": current.body,
        "history": history,
        "history_count": count,
        "history_page": history_page,
        "actions": actions,
        "order": str(order.pk) if order else None,
        "invoice": str(order.invoice.pk) if order else None,
    }


def detail(actor, pk, seller=None, history_page=1):
    return request_data(get_object_or_404(scope(actor, seller), pk=pk), actor.context, history_page)


def page(actor, query):
    qs = scope(actor, query.get("seller"))
    if query["state"]:
        qs = qs.filter(state=query["state"])
    if query["q"]:
        qs = qs.filter(Q(id__icontains=query["q"]) | Q(seller__display_name__icontains=query["q"]))
    qs = qs.order_by("-created_at", "pk")
    p = query["page"]
    return {
        "count": qs.count(),
        "page": p,
        "results": [request_data(r, actor.context, include_history=False) for r in qs[(p - 1) * 20 : p * 20]],
    }


def final_offer(buyer, row, data):
    original = row.revisions.get(number=row.revision).body
    if selection_set(data["lines"]) != selection_set(original["lines"]):
        raise ValidationError({"lines": ["stable_selection"]})
    caps = {(str(line["variant"]), line["tier"]): line for line in original["lines"]}
    for i, line in enumerate(data["lines"]):
        cap = caps[(str(line["variant"]), line["tier"])]
        if not 0 < Decimal(line["unit_price"]) <= Decimal(cap["max_unit_price"]) or not 0 < Decimal(
            line["quantity"]
        ) <= Decimal(cap["max_quantity"]):
            raise ValidationError({f"lines.{i}": ["buyer_limits"]})
    if str(data["choice"]["seller"]) != str(row.seller_id):
        raise ValidationError({"choice": ["seller"]})
    prepared, total, snapshot = commerce.validate_seller(
        buyer, row.seller, canonical(data["lines"]), canonical(data["choice"]), row.currency, mode="negotiable"
    )
    for p in prepared:
        cap = caps[(str(p["variant"].pk), p["row"]["tier"])]
        p["snapshot"].update(
            {
                "max_unit_price": cap["max_unit_price"],
                "max_quantity": cap["max_quantity"],
                "buyer_revision": row.revision,
            }
        )
    return prepared, total, snapshot, original


@transaction.atomic
def transition(actor, pk, action, data, *, preview=False):
    preliminary = get_object_or_404(scope(actor), pk=pk)
    buyer = participant_locks(
        actor, preliminary.seller_id, preliminary.buyer_id, require_buyer=action in ["finalize", "resubmit"]
    )
    row = get_object_or_404(scope(actor).select_for_update(), pk=pk)
    hashed = digest(canonical({"action": action, **{k: v for k, v in data.items() if k != "command_id"}}))
    old = NegotiationCommand.objects.filter(actor=actor.account, key=data["command_id"]).first()
    if old:
        if old.request_id != row.pk or old.digest != hashed:
            raise CommandConflict()
        return old.result
    if row.version != data["version"]:
        raise CommandConflict()
    allowed = request_data(row, actor.context)["actions"]
    if action not in allowed:
        raise CommandConflict()
    if action == "finalize":
        prepared, total, snapshot, proposal = final_offer(buyer, row, data)
        if preview:
            return {
                "binding": False,
                "goods_total": format(total, ".2f"),
                "proposal": proposal,
                "final": canonical({"lines": data["lines"], "choice": data["choice"]}),
                "version": row.version,
            }
        snapshot.update(
            {
                "origin": "negotiated",
                "finalizer": {"account": str(actor.account.pk), "user": str(actor.user.pk), "context": "seller"},
                "proposal": proposal,
            }
        )
        order = commerce.write_agreement(
            actor, buyer, row.seller, row.currency, data["choice"], prepared, total, snapshot, negotiation=row
        )
        row.state = "accepted"
        result = {"order": str(order.pk), "invoice": str(order.invoice.pk)}
    elif action == "resubmit":
        body = validate_proposal(
            buyer, row.seller, data["proposal"], row.currency, row.revisions.get(number=row.revision).body
        )
        row.revision += 1
        NegotiationRevision.objects.create(request=row, number=row.revision, actor=actor.account, body=body)
        row.state = "submitted"
        result = {}
    else:
        row.state = {"withdraw": "withdrawn", "reject": "rejected", "request-correction": "correction_requested"}[
            action
        ]
        result = {}
    row.version += 1
    if connection.vendor != "mysql":
        row.save()
    state = {"result": result}
    if action == "finalize":
        state["final"] = canonical({"lines": data["lines"], "choice": data["choice"], "buyer_revision": row.revision})
    event(row, actor, {"resubmit": "resubmitted", "finalize": "accepted"}.get(action, row.state), data["reason"], state)
    result = {**result, "id": str(row.pk), "state": row.state, "version": row.version}
    NegotiationCommand.objects.create(
        request=row, actor=actor.account, key=data["command_id"], digest=hashed, result=result
    )
    return result


def reconcile(actor, pk, key):
    row = get_object_or_404(scope(actor), pk=pk)
    command = get_object_or_404(NegotiationCommand, request=row, actor=actor.account, key=key)
    return command.result


@transaction.atomic
def settle_command(actor, pk, key):
    preliminary = get_object_or_404(scope(actor), pk=pk)
    participant_locks(actor, preliminary.seller_id, preliminary.buyer_id, require_buyer=False)
    row = get_object_or_404(scope(actor).select_for_update(), pk=pk)
    old = NegotiationCommand.objects.filter(actor=actor.account, key=key).first()
    if old:
        if old.request_id != row.pk:
            raise CommandConflict()
        return old.result
    result = {"id": str(row.pk), "state": row.state, "version": row.version, "rejected": True}
    NegotiationCommand.objects.create(request=row, actor=actor.account, key=key, digest="0" * 64, result=result)
    return result


@transaction.atomic
def settle_submission(actor, key):
    from .models import NegotiationSubmissionFence

    if actor.context != "buyer":
        raise PermissionDenied()
    # Same User/Account lock as parent creation: absence is fenced before replacement.
    access.lock_actor(actor)
    old = NegotiationSubmission.objects.filter(buyer=actor.account, key=key).first()
    if old:
        return submission_data(old)
    NegotiationSubmissionFence.objects.get_or_create(buyer=actor.account, key=key)
    return {"rejected": True}
