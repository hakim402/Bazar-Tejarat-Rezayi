"""Exact private money packets; no floats, exponent input or silent rounding."""

import hashlib
import json
from datetime import datetime
from uuid import UUID
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from apps.foundation import money as exact
from apps.messaging.contracts import safe_text

ZERO = exact.ZERO


def fail(field, code="invalid"):
    raise ValidationError({field: [code]})


def identifier(value, field="id"):
    try:
        return UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        fail(field)


def money(value, *, zero=False):
    try:
        return exact.parse(value, zero=zero)
    except exact.MoneyError as error:
        if error.kind == "format":
            fail("amount", "exact_money_string")
        fail("amount", "positive_money" if not zero else "nonnegative_money")


def total(values):
    try:
        return exact.sum_exact(values)
    except exact.MoneyError:
        fail("amount", "aggregate_overflow")


def text(value, field="reason", maximum=1000, minimum=3):
    if not isinstance(value, str) or not minimum <= len(value.strip()) <= maximum:
        fail(field, "required")
    return safe_text(value.strip())


def paid_time(value):
    if not isinstance(value, datetime) or timezone.is_naive(value):
        fail("paid_at", "aware_time")
    if value > timezone.now():
        fail("paid_at", "future_payment")
    return value


def canonical(value):
    return json.loads(json.dumps(value, default=str, sort_keys=True, allow_nan=False))


def digest(action, order, packet):
    return hashlib.sha256(
        json.dumps(
            [action, str(order), canonical(packet)], sort_keys=True, separators=(",", ":"), ensure_ascii=False
        ).encode()
    ).hexdigest()
