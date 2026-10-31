"""One bounded public query vocabulary and plain reviewed optional store payload."""

import re
import unicodedata
from decimal import Decimal, InvalidOperation
from uuid import UUID
from apps.catalogue.validation import fail
from apps.catalogue.models import LOCALES

TEXT_CONTROLS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]")
CONTACT = re.compile(r"https?://|www\.|\b[\w.+-]+@[\w.-]+\.[\w-]+|\b(?:[a-z0-9-]+\.)+(?:com|net|org|af|io|co|info|biz)\b|(?:\+?\d[\s().-]*){7,}|<[^>]+>", re.I)
QUERY_KEYS = {"q", "category", "country", "city", "currency", "pricing_mode", "tier", "min_price", "max_price", "availability", "sort", "page"}


def plain(value, field, limit, *, contact=False):
    if not isinstance(value, str) or len(value) > limit or TEXT_CONTROLS.search(value):
        fail(field, "invalid_text")
    value = value.strip()
    if contact and CONTACT.search(value):
        fail(field, "private_contact_or_markup")
    return value


def search_text(value):
    return " ".join(unicodedata.normalize("NFKC", value).split())


def identifier(value, field):
    try:
        return UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        fail(field, "uuid")


def version(value):
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        fail("version", "invalid")
    return value


def query(params, *, scope="products", category=None, page_only=False):
    allowed = {"page"} if page_only else QUERY_KEYS if scope == "products" else {"q", "country", "city", "page", "sort"}
    for key in params:
        if key not in allowed or len(params.getlist(key)) != 1:
            fail(key if key in allowed else "query", "unsupported_or_repeated")
    result = {key: params.get(key, "") for key in allowed}
    result["q"] = search_text(plain(result.get("q", ""), "q", 100))
    if re.search(r"[\x00-\x1f\x7f]", params.get("q", "")):
        fail("q", "invalid_text")
    for key in ("country", "city"):
        result[key] = plain(result.get(key, ""), key, 80)
    raw_page = result.get("page") or "1"
    if not re.fullmatch(r"[1-9][0-9]{0,4}", raw_page) or int(raw_page) > 10000:
        fail("page", "invalid")
    result["page"] = int(raw_page)
    result["sort"] = result.get("sort") or "newest"
    sorts = {"newest", "name"} | ({"price_asc", "price_desc"} if scope == "products" and not page_only else set())
    if result["sort"] not in sorts:
        fail("sort", "choice")
    for key, choices in {"currency": {"AFN", "USD"}, "pricing_mode": {"fixed", "negotiable"}, "tier": {"retail", "wholesale"}, "availability": {"available", "unavailable", "unknown"}}.items():
        if result.get(key) and result[key] not in choices:
            fail(key, "choice")
    if category:
        if result.get("category") and result["category"] != category:
            fail("category", "scope")
        result["category"] = category
    for key in ("min_price", "max_price"):
        value = result.get(key, "")
        if value:
            if not re.fullmatch(r"(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?", value):
                fail(key, "decimal")
            try:
                result[key] = Decimal(value)
            except InvalidOperation:
                fail(key, "decimal")
        else:
            result[key] = None
    if result["min_price"] is not None and result["max_price"] is not None and result["min_price"] > result["max_price"]:
        fail("min_price", "range")
    if result["min_price"] is not None or result["max_price"] is not None or result["sort"].startswith("price_"):
        if not result.get("currency") or not result.get("tier"):
            fail("currency", "price_requires_currency_and_tier")
    if result.get("category") and not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,39}", result["category"]):
        fail("category", "invalid")
    return result


def body(data):
    if not isinstance(data, dict) or set(data) != {"source_locale", "editions", "country", "city", "logo", "banner"}:
        fail("body", "fields")
    locale = data["source_locale"]
    editions = data["editions"]
    if locale not in LOCALES or not isinstance(editions, dict) or locale not in editions or not set(editions) <= set(LOCALES):
        fail("editions", "locale")
    cleaned = {}
    for language, edition in editions.items():
        if not isinstance(edition, dict) or set(edition) != {"description", "logo_alt", "banner_alt"}:
            fail("editions", "fields")
        cleaned[language] = {key: plain(edition[key], key, 2000 if key == "description" else 200, contact=True) for key in edition}
    result = {"source_locale": locale, "editions": cleaned, **{key: plain(data[key], key, 80, contact=True) for key in ("country", "city")}}
    for role in ("logo", "banner"):
        result[role] = str(identifier(data[role], role)) if data[role] is not None else None
        if result[role] and not cleaned[locale][role + "_alt"]:
            fail(role + "_alt", "required")
    return result
