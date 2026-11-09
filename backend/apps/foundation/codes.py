"""Bounded aftercare refusal codes shared across orders, payments and fulfilment."""

CANCELLATION_REFUSALS = frozenset(
    {
        "cancellation_ineligible_dispatched",
        "cancellation_ineligible_completed",
        "cancellation_request_pending",
        "cancellation_already_decided",
        "cancellation_not_requester",
        "cancellation_stale_version",
    }
)

AMENDMENT_REFUSALS = frozenset(
    {
        "amendment_ineligible_dispatched",
        "amendment_proposal_pending",
        "amendment_zero_quantity",
        "amendment_increase_refused",
        "amendment_below_wholesale_minimum",
        "amendment_invalid_increment",
        "amendment_not_proposer",
        "amendment_stale_version",
    }
)

DISPUTE_REFUSALS = frozenset(
    {
        "dispute_not_delivered",
        "dispute_ineligible_cancelled",
        "dispute_request_pending",
        "dispute_already_decided",
        "dispute_not_requester",
        "dispute_not_responder",
        "dispute_stale_version",
        "dispute_refund_amount_invalid",
    }
)

REVIEW_REFUSALS = frozenset(
    {
        "review_not_completed",
        "review_not_buyer",
        "review_already_submitted",
        "review_not_pending",
        "review_not_moderatable",
        "review_rating_invalid",
        "review_stale_version",
    }
)


def bounded(code, registry):
    """Refusal codes are a closed contract; an unregistered code is a defect, not
    a user-facing message. Consumed by each domain's refuse() helper."""
    if code not in registry:
        raise RuntimeError("Unregistered refusal code: " + code)
    return code
