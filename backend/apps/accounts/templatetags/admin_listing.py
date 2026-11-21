"""Trim rendered list text while retaining Unfold's links, sorting and form controls."""

import re
from html import escape
from html.parser import HTMLParser

from django import template
from django.utils.html import conditional_escape, format_html
from django.utils.safestring import SafeData, mark_safe
from django.utils.text import Truncator

register = template.Library()


@register.simple_tag
def get_listing_styles():
    # Unfold's results inclusion has its own context, without site context keys.
    from apps.accounts.admin.theme import LISTING_THEME
    return LISTING_THEME

UUID = re.compile(r"\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b", re.IGNORECASE)
TEXT_FIELDS = {"name", "title", "description", "subject", "reason", "text", "email", "bio", "message"}
IDENTITY_FIELDS = {"id", "pk", "identifier", "identity", "listing", "str", "reference", "code", "sku", "buyer", "seller", "user", "product", "order", "invoice", "account"}


class ListingCell(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.field = set()
        self.raw_tags = []

    def handle_starttag(self, tag, attrs):
        self.parts.append(self.get_starttag_text())
        if tag in {"td", "th"}:
            classes = dict(attrs).get("class", "")
            column = next((name[6:] for name in classes.split() if name.startswith("field-")), "")
            self.field = set(column.strip("_").lower().split("_"))
        if tag in {"script", "style", "textarea", "option"}:
            self.raw_tags.append(tag)

    def handle_startendtag(self, tag, attrs):
        self.parts.append(self.get_starttag_text())

    def handle_endtag(self, tag):
        self.parts.append(f"</{tag}>")
        if self.raw_tags and self.raw_tags[-1] == tag:
            self.raw_tags.pop()

    def handle_data(self, value):
        # Never alter editable values or executable/widget content.
        if self.raw_tags:
            self.parts.append(value if self.raw_tags[-1] in {"script", "style"} else escape(value, quote=False))
            return
        shown = UUID.sub(lambda match: match.group()[:8] + "…", value)
        if self.field & (TEXT_FIELDS | IDENTITY_FIELDS):
            limit = 72 if self.field & {"description", "reason", "text", "bio", "message"} else 36
            shown = Truncator(shown).chars(limit)
        self.parts.append(str(format_html('<span title="{}">{}</span>', value, shown)) if shown != value else escape(value, quote=False))

    def handle_comment(self, data):
        self.parts.append(f"<!--{data}-->")

    def handle_decl(self, decl):
        self.parts.append(f"<!{decl}>")


@register.filter
def listing_cell(value):
    # Only Unfold's already-escaped cell HTML is eligible for structural preservation.
    if not isinstance(value, SafeData):
        return conditional_escape(value)
    parser = ListingCell()
    parser.feed(str(value))
    parser.close()
    return mark_safe("".join(parser.parts))
