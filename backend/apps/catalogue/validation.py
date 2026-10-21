"""Strict bounded plain content, schema, decimal strings and immutable variant definitions."""

from decimal import Decimal, InvalidOperation
import re
from rest_framework.exceptions import ValidationError
from .models import LOCALES


def fail(path, code="invalid"):
    raise ValidationError({path: ["Review this field and its limits."]}, code=code)


def text(value, path, maximum, *, optional=False):
    if not isinstance(value, str) or len(value) > maximum or (not optional and not value.strip()):
        fail(path, "required" if not value else "length")
    if re.search(r"[<>\x00-\x08\x0b\x0c\x0e-\x1f]", value):
        fail(path, "plain_text")
    return value.strip()


def decimal(value, path, scale=2, nullable=False):
    if nullable and value in (None, ""):
        return None
    if not isinstance(value, str) or len(value) > 20 or not re.fullmatch(r"\d+(?:\.\d{1," + str(scale) + r"})?", value):
        fail(path, "decimal")
    try:
        result = Decimal(value)
        if not result.is_finite() or result <= 0 or result > Decimal("999999999." + "9" * scale):
            fail(path, "positive")
    except InvalidOperation:
        fail(path, "decimal")
    return result


def labels(value, path="labels"):
    if not isinstance(value, dict) or set(value) != set(LOCALES):
        fail(path, "locales")
    return {k: text(v, path, 100) for k, v in value.items()}


def schema(value):
    if not isinstance(value, list) or len(value) > 24:
        fail("attributes", "length")
    keys = set()
    for field in value:
        if not isinstance(field, dict) or set(field) - {"code", "labels", "type", "required", "variant", "choices"}:
            fail("attributes", "schema")
        code = field.get("code", "")
        if not isinstance(code, str) or not re.fullmatch(r"[a-z][a-z0-9_]{0,31}", code) or code in keys:
            fail("attributes", "duplicate")
        keys.add(code)
        labels(field.get("labels"))
        if field.get("type") not in {"text", "enum", "decimal", "boolean"}:
            fail("attributes", "schema")
        if not all(isinstance(field.get(k, False), bool) for k in ("required", "variant")):
            fail("attributes", "schema")
        choices = field.get("choices", [])
        if not isinstance(choices, list) or len(choices) > 30 or len(set(str(x) for x in choices)) != len(choices):
            fail("attributes", "duplicate")
        for choice in choices:
            text(choice, "attributes", 80)
        if field["type"] == "enum" and not choices:
            fail("attributes", "required")
    return value


def attribute_values(values, fields, path, variant=False):
    if not isinstance(values, dict):
        fail(path, "schema")
    selected = {f["code"]: f for f in fields if f.get("variant", False) == variant}
    if set(values) - set(selected):
        fail(path, "category")
    cleaned = {}
    for code, field in selected.items():
        value = values.get(code)
        if value in (None, ""):
            if field.get("required"):
                fail(path + "." + code, "required")
            continue
        kind = field["type"]
        if kind == "boolean":
            if not isinstance(value, bool):
                fail(path + "." + code, "boolean")
        elif kind == "decimal":
            value = format(decimal(value, path + "." + code, 3).normalize(), "f")
        else:
            value = text(value, path + "." + code, 200)
            if kind == "enum" and value not in field["choices"]:
                fail(path + "." + code, "choice")
        cleaned[code] = value
    return cleaned


def prices(data, path="prices"):
    retail = decimal(data.get("retail"), path + ".retail", nullable=True)
    wholesale = decimal(data.get("wholesale"), path + ".wholesale", nullable=True)
    if retail is None and wholesale is None:
        fail(path, "one_price")
    return {"retail": retail, "wholesale": wholesale}


def definition(data, category, path):
    unit = category.units.filter(code=data.get("unit"), active=True).first()
    if not unit:
        fail(path + ".unit", "category")
    increment = decimal(data.get("increment"), path + ".increment", 3)
    minimum = decimal(data.get("minimum"), path + ".minimum", 3)
    if (not unit.fractional and increment != increment.to_integral_value()) or minimum % increment:
        fail(path + ".minimum", "increment")
    contents = text(data.get("contents", ""), path + ".contents", 200, optional=unit.code not in {"pack", "carton"})
    return {
        "unit": unit.code,
        "increment": format(increment, ".3f"),
        "minimum": format(minimum, ".3f"),
        "contents": contents,
        "attributes": attribute_values(data.get("attributes", {}), category.attributes, path + ".attributes", True),
    }
