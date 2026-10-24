"""Plain text, fixed route destinations and exact-host browser-native media policy."""
import ipaddress
import re
import socket
from urllib.parse import urlsplit
from django.conf import settings
from django.core.exceptions import ValidationError
from .models import PAGES

CONTROL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]")


def text(value):
    if CONTROL.search(value) or "<" in value or ">" in value:
        raise ValidationError("Use plain text without markup or direction controls.")
    return value


def destination(value):
    if not value:
        return value
    if CONTROL.search(value) or any(c.isspace() for c in value) or "\\" in value:
        raise ValidationError("Use a supported route or a safe HTTPS URL.")
    if value.startswith("/"):
        if value in {"/#demo-product-" + name for name in ["dried-fruit", "clothing", "beauty", "furniture"]} or re.fullmatch(r"/catalogue-preview/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", value):
            return value
        routes = {"/", "/help", *["/" + p for p in PAGES if p not in {"home", "payment-and-delivery", "cancellations-and-disputes", "verification"}], *["/help/" + p for p in ["payment-and-delivery", "cancellations-and-disputes", "verification"]], *["/auth/" + p for p in ["buyer-sign-in", "seller-sign-in", "buyer-registration", "seller-registration"]]}
        if value not in routes:
            raise ValidationError("Choose an existing public page, product preview or supported demo preview; omit the language prefix.")
        return value
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError:
        raise ValidationError("Use a valid URL and port.") from None
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or port not in {None, 443}:
        raise ValidationError("Use an HTTPS URL without credentials or a custom port.")
    host = parsed.hostname.lower()
    try:
        ipaddress.ip_address(host)
    except ValueError:
        if "." in host and not host.endswith((".localhost", ".local", ".internal", ".test", ".invalid")):
            return value
    raise ValidationError("Private, numeric or local destinations are not allowed.")


def external_media(value, kind):
    if not value:
        return value
    destination(value)
    parsed = urlsplit(value)
    if parsed.scheme != "https" or parsed.hostname not in settings.SITE_MEDIA_HOSTS or parsed.fragment or parsed.query:
        raise ValidationError("Use direct HTTPS media on an explicitly permitted exact host, without query or fragment.")
    try:
        addresses = socket.getaddrinfo(parsed.hostname, 443, type=socket.SOCK_STREAM)
        if not addresses or any(not ipaddress.ip_address(row[4][0]).is_global for row in addresses):
            raise ValueError
    except (OSError, ValueError):
        raise ValidationError("The permitted media host must resolve only to public network addresses.") from None
    suffix = parsed.path.lower().rsplit(".", 1)[-1]
    if suffix not in ({"mp4"} if kind == "video" else {"jpg", "jpeg", "png", "webp"}):
        raise ValidationError("Choose a direct MP4 video or JPEG/PNG/WebP image URL.")
    return value


def configuration(site, locales, slides):
    if locales["fa-AF"].name.strip() == "":
        raise ValidationError("Dari site name is required.")
    if site.announcement_enabled and not locales["fa-AF"].announcement.strip():
        raise ValidationError("An enabled announcement needs Dari text.")
    if site.announcement_url and not locales["fa-AF"].announcement_label.strip():
        raise ValidationError("An announcement link needs a Dari label.")
    if site.maintenance_enabled and not (locales["fa-AF"].maintenance_title.strip() and locales["fa-AF"].maintenance_message.strip()):
        raise ValidationError("Maintenance requires a Dari title and message.")
    for kind in ["image", "video"]:
        enabled = [slide for slide in slides if slide.enabled and not slide.is_draft and slide.placement == "main" and slide.kind == kind]
        if len(enabled) > 8:
            raise ValidationError("Publish up to eight included hero slides per media type. Disable an existing slide first.")
