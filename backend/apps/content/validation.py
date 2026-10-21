"""Typed bounded editorial documents, safe route references, no executable markup or remote fetching."""

import json
import re
from urllib.parse import urlsplit
from rest_framework.exceptions import ValidationError
from .models import FIXED
from .contracts import Payload

AUTH = {
    "/auth/buyer-sign-in",
    "/auth/seller-sign-in",
    "/auth/buyer-registration",
    "/auth/seller-registration",
}
BIDI = re.compile(
    r"[\x00-\x08\x0b-\x1f\x7f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]"
)
SLUG = re.compile(r"^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$")


def target(value):
    if (
        value in AUTH
        or value in {"/", "/help"}
        or value in {"/" + k for k, v in FIXED.items() if v in {"page", "legal"}}
    ):
        return value
    if value.startswith("/help/") and SLUG.fullmatch(value[6:]) and len(value) <= 90:
        return value
    raise ValidationError(
        {"target": ["Use an implemented internal destination."]}, code="internal_target"
    )


def structure(data):
    return {
        "blocks": [
            {k: b[k] for k in ("id", "type", "enabled", "asset")}
            | {
                "targets": [(v["id"], v["target"]) for v in b["links"]],
                "item_count": len(b["items"]),
            }
            for b in data["blocks"]
        ],
        "navigation": [
            {
                "id": g["id"],
                "placement": g["placement"],
                "targets": [(v["id"], v["target"]) for v in g["links"]],
            }
            for g in data["navigation"]
        ],
        "support": data.get("support", {}),
    }


def check_text(value, path="payload"):
    if isinstance(value, str) and (BIDI.search(value) or "<" in value or ">" in value):
        raise ValidationError(
            {path: ["Use plain text without markup or direction controls."]},
            code="plain_text",
        )
    if isinstance(value, dict):
        for key, child in value.items():
            check_text(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            check_text(child, f"{path}.{index}")


def payload(value, kind):
    serializer = Payload(data=value)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    encoded = json.dumps(data, ensure_ascii=False)
    if len(encoded.encode()) > 80000:
        raise ValidationError(
            {"payload": ["Reduce the document to at most 80 KB."]},
            code="document_limit",
        )
    check_text(data)
    blocks, groups = data["blocks"], data["navigation"]
    if (
        len(blocks) > 24
        or len({b["id"] for b in blocks}) != len(blocks)
        or len(groups) > 6
    ):
        raise ValidationError(
            {
                "blocks": [
                    "Use unique section IDs, at most 24 sections and 6 navigation groups."
                ]
            },
            code="list_limit",
        )
    if kind != "shell" and groups or kind != "support" and "support" in data:
        raise ValidationError(
            {"payload": ["Settings fields do not belong to this content type."]}
        )
    if kind in {"shell", "support"} and blocks:
        raise ValidationError({"blocks": ["Use the dedicated settings fields."]})
    for block_index, b in enumerate(blocks):
        if b["id"] in {"main", "top", "content-preview"}:
            raise ValidationError({"id": ["Use a section-specific anchor."]})
        if len(set(b["items"])) != len(b["items"]):
            raise ValidationError(
                {f"payload.blocks.{block_index}.items": ["Use distinct list items."]},
                code="unique_items",
            )
        for index, link in enumerate(b["links"]):
            link["id"] = link["id"] or f"link-{index + 1}"
        if len({link["id"] for link in b["links"]}) != len(b["links"]):
            raise ValidationError(
                {"links": ["Use distinct link IDs."]}, code="unique_items"
            )
        if b["asset"] and not b["alt"].strip():
            raise ValidationError(
                {
                    f"payload.blocks.{block_index}.alt": [
                        "Provide image alternative text."
                    ]
                },
                code="image_alt",
            )
        if len(b["links"]) > 8:
            raise ValidationError(
                {
                    f"payload.blocks.{block_index}.links": [
                        "Use at most 8 section links."
                    ]
                },
                code="list_limit",
            )
        if b["type"] in {"catalogue", "store"} and (
            b["items"] or b["links"] or b["asset"]
        ):
            raise ValidationError(
                {
                    "blocks": [
                        "Future slots cannot contain commerce fixtures or destinations."
                    ]
                }
            )
        if kind != "home" and b["type"] in {"catalogue", "store"}:
            raise ValidationError({"blocks": ["Future slots belong on the homepage."]})
        for link_index, link in enumerate(b["links"]):
            try:
                target(link["target"])
            except ValidationError:
                raise ValidationError(
                    {
                        f"payload.blocks.{block_index}.links.{link_index}.target": [
                            "Use an implemented internal destination."
                        ]
                    },
                    code="internal_target",
                ) from None
    for index, group in enumerate(groups):
        group["id"] = group["id"] or f"group-{index + 1}"
        for position, link in enumerate(group["links"]):
            link["id"] = link["id"] or f"link-{position + 1}"
        if len({link["id"] for link in group["links"]}) != len(group["links"]):
            raise ValidationError(
                {"navigation": ["Use distinct link IDs."]}, code="unique_items"
            )
    if len({g["id"] for g in groups}) != len(groups):
        raise ValidationError(
            {"navigation": ["Use distinct group IDs."]}, code="unique_items"
        )
    for group_index, group in enumerate(groups):
        if len(group["links"]) > 12:
            raise ValidationError(
                {"navigation": ["Use at most 12 links per navigation group."]},
                code="list_limit",
            )
        for link_index, link in enumerate(group["links"]):
            try:
                target(link["target"])
            except ValidationError:
                raise ValidationError(
                    {
                        f"payload.navigation.{group_index}.links.{link_index}.target": [
                            "Use an implemented internal destination."
                        ]
                    },
                    code="internal_target",
                ) from None
    support = data.get("support", {})
    if support.get("phone") and not re.fullmatch(
        r"\+[0-9][0-9 ()-]{6,22}", support["phone"]
    ):
        raise ValidationError(
            {"phone": ["Use an international platform support number."]}
        )
    if support.get("website"):
        url = urlsplit(support["website"])
        if (
            url.scheme != "https"
            or url.username
            or url.password
            or url.fragment
            or BIDI.search(support["website"])
        ):
            raise ValidationError(
                {"website": ["Use a public HTTPS website without credentials."]}
            )
    return data
