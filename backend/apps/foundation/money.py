"""Exact decimal money primitives shared by orders, payments and fulfilment."""

import re
from decimal import Decimal, ROUND_HALF_UP, localcontext

MAX = Decimal("9999999999999999999999.99")
ZERO = Decimal("0.00")
MONEY_STRING = re.compile(r"[0-9]{1,22}\.[0-9]{2}")


class MoneyError(ValueError):
    """One bounded failure reason; callers map it to their own field/code pair."""

    def __init__(self, kind):
        self.kind = kind
        super().__init__(kind)


def parse(value, *, zero=False):
    """Exact non-exponent money string; raises MoneyError('format'/'limit')."""
    if not isinstance(value, str) or not MONEY_STRING.fullmatch(value):
        raise MoneyError("format")
    amount = Decimal(value)
    if amount > MAX or (amount < 0 if zero else amount <= 0):
        raise MoneyError("limit")
    return amount


def line_amount(price, quantity):
    """Per-line ROUND_HALF_UP money at precision 40, identical to acceptance."""
    if price is None or price <= 0:
        raise MoneyError("tier")
    with localcontext() as context:
        context.prec = 40
        value = (price * quantity).quantize(Decimal(".01"), rounding=ROUND_HALF_UP)
    if value <= 0 or value >= Decimal("1e22"):
        raise MoneyError("bounds")
    return value


def sum_exact(values):
    with localcontext() as context:
        context.prec = 50
        value = sum(values, ZERO)
    if not ZERO <= value <= MAX:
        raise MoneyError("aggregate")
    return value
