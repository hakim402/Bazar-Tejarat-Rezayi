"""Exact scale-three quantities. No floating point or silent coercion."""

from datetime import date
from decimal import Decimal
import re
from uuid import UUID
from apps.catalogue.validation import fail, text

MAX = Decimal("999999999.999")


def identifier(value, path):
    try:
        return UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        fail(path)


def quantity(value, variant, path="quantity", *, signed=False, zero=False):
    pattern = r"-?\d+(?:\.\d{1,3})?" if signed else r"\d+(?:\.\d{1,3})?"
    if not isinstance(value, str) or len(value) > 20 or not re.fullmatch(pattern, value):
        fail(path, "decimal")
    result = Decimal(value)
    if abs(result) > MAX or (not zero and result == 0) or (not signed and result < 0):
        fail(path, "quantity")
    if result % variant.quantity_increment or not variant.unit.fractional and result != result.to_integral_value():
        fail(path, "increment")
    return result


def expiry(value):
    if value in (None, ""):
        return None
    try:
        if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
            raise ValueError
        return date.fromisoformat(value)
    except (ValueError, TypeError):
        fail("expires_on", "date")


def reason(value):
    return text(value, "reason", 1000)
