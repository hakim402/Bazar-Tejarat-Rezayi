"""Exact money/quantities and bounded non-executable private text."""

from apps.payments.validation import (
    fail as fail,
    money as money,
    total as total,
    text as text,
    canonical as canonical,
    digest as digest,
    identifier as identifier,
    paid_time as paid_time,
)
from apps.organizations.access import Conflict
from django.utils import timezone


def actual_time(value, field="occurred_at", earliest=None):
    if value is None or not hasattr(value, "tzinfo") or timezone.is_naive(value):
        fail(field, "aware_time")
    if value > timezone.now() or earliest is not None and value < earliest:
        fail(field, "actual_time_range")
    return value


def expect(actual, expected):
    if actual != expected:
        raise Conflict("Current facts changed; review their current version.")
