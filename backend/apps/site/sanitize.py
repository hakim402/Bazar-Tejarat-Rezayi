"""Allowlist sanitizer for owner-authored page bodies; stdlib only, rebuilt output."""
import re
from html import escape
from html.parser import HTMLParser

ALLOWED = {"p", "br", "h2", "h3", "h4", "ul", "ol", "li", "blockquote", "strong", "em", "u", "s", "a", "img", "figure", "figcaption", "pre", "code", "hr"}
RENAMES = {"b": "strong", "i": "em", "del": "s", "strike": "s", "h1": "h2", "div": "p"}
VOID = {"br", "hr", "img"}
DROP_WITH_CONTENT = {"script", "style", "iframe", "object", "embed", "form", "input", "button", "textarea", "select", "option", "svg", "math", "template", "noscript", "link", "meta", "title", "head", "video", "audio", "source", "canvas", "map", "area", "base"}
MEDIA_SRC = re.compile(r"^/api/v1/site/media/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/$")
EXTERNAL_HREF = re.compile(r"^https?://[^\s]+$", re.IGNORECASE)
MAILTO_HREF = re.compile(r"^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$", re.IGNORECASE)
DIMENSION = re.compile(r"^\d{1,4}$")


class _BodySanitizer(HTMLParser):
    """Rebuilds HTML from scratch: only allowlisted tags/attributes survive."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out = []
        self.stack = []
        self.suppressed = 0

    def handle_starttag(self, tag, attrs):
        if self.suppressed:
            if tag in DROP_WITH_CONTENT:
                self.suppressed += 1
            return
        if tag in DROP_WITH_CONTENT:
            self.suppressed = 1
            return
        tag = RENAMES.get(tag, tag)
        if tag not in ALLOWED:
            return  # unknown wrapper: keep its children, drop the tag
        attributes = self.clean_attrs(tag, attrs)
        if tag in VOID:
            if attributes is not None:
                self.out.append(f"<{tag}{attributes}>")
            return
        if attributes is None:
            self.stack.append(None)  # e.g. link with a rejected href: unwrap
            return
        self.out.append(f"<{tag}{attributes}>")
        self.stack.append(tag)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if RENAMES.get(tag, tag) not in VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if self.suppressed:
            if tag in DROP_WITH_CONTENT:
                self.suppressed -= 1
            return
        tag = RENAMES.get(tag, tag)
        if tag in VOID or tag not in ALLOWED or tag not in self.stack:
            return
        while self.stack:
            open_tag = self.stack.pop()
            if open_tag is None:
                continue
            self.out.append(f"</{open_tag}>")
            if open_tag == tag:
                break

    def handle_data(self, data):
        if not self.suppressed:
            self.out.append(escape(data, quote=False))

    def clean_attrs(self, tag, attrs):
        values = {key.lower(): value or "" for key, value in attrs}
        if tag == "img":
            src = values.get("src", "").strip()
            if not MEDIA_SRC.match(src):
                return None  # only images already stored in the site media library
            kept = [f'src="{escape(src, quote=True)}"']
            alt = values.get("alt", "").strip()[:300]
            kept.append(f'alt="{escape(alt, quote=True)}"')
            for name in ("width", "height"):
                if DIMENSION.match(values.get(name, "")):
                    kept.append(f'{name}="{values[name]}"')
            return " " + " ".join(kept)
        if tag == "a":
            href = values.get("href", "").strip()
            if href.startswith("/") and not href.startswith("//"):
                return f' href="{escape(href, quote=True)}"'
            if EXTERNAL_HREF.match(href):
                return f' href="{escape(href, quote=True)}" target="_blank" rel="nofollow noopener"'
            if MAILTO_HREF.match(href):
                return f' href="{escape(href, quote=True)}"'
            return None
        return ""  # every other tag keeps no attributes (drops data-trix-*, class, style, ids)

    def result(self):
        self.close()
        while self.stack:
            open_tag = self.stack.pop()
            if open_tag is not None:
                self.out.append(f"</{open_tag}>")
        return "".join(self.out).strip()


def sanitize_body(html):
    parser = _BodySanitizer()
    parser.feed(html or "")
    return parser.result()