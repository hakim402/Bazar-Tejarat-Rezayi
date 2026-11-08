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
