"""Exact private money packets; no floats, exponent input or silent rounding."""

import hashlib
import json
import re
from datetime import datetime
from decimal import Decimal, localcontext
from uuid import UUID
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from apps.messaging.contracts import safe_text

MAX_MONEY = Decimal("9999999999999999999999.99")
ZERO = Decimal("0.00")


def fail(field, code="invalid"):
    raise ValidationError({field: [code]})


def identifier(value, field="id"):
    try:
        return UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        fail(field)


def money(value, *, zero=False):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]{1,22}\.[0-9]{2}", value):
        fail("amount", "exact_money_string")
    amount = Decimal(value)
    if amount > MAX_MONEY or (amount < 0 if zero else amount <= 0):
        fail("amount", "positive_money" if not zero else "nonnegative_money")
    return amount


def total(values):
    with localcontext() as context:
        context.prec = 50
        value = sum(values, ZERO)
        if not ZERO <= value <= MAX_MONEY:
            fail("amount", "aggregate_overflow")
        return value


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
