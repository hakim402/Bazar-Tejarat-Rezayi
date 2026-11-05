"""Retain synthetic, audited four-language handovers in the owned runner evidence."""

import argparse
import io
import json
from pathlib import Path
import django
from django.db import connection
from config.testing import assert_owned_database


def main():
    django.setup()
    assert_owned_database(connection)
    from apps.accounts.models import User
    from apps.fulfilment import documents
    from apps.fulfilment.management.commands.seed_fulfilment_examples import example_delivery
    from apps.messaging.management.commands.seed_messaging_examples import actor
    from pypdf import PdfReader

    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    output = parser.parse_args().output
    output.mkdir(parents=True, exist_ok=False)
    item = example_delivery("cod", stage="dispatched")
    seller = actor(User.objects.get(email="phase12-owner@example.test"), "seller")
    records = []
    for locale in documents.COPY:
        packet = documents.snapshot(seller, item["id"], locale)
        raw = documents.pdf_bytes(packet, locale)
        html = documents.html_bytes(packet, locale)
        assert packet["address"].encode() in html
        assert b"HandoverLatin" in html and b"HandoverArabic" in html and b"data:font/ttf;base64," in html
        assert f'dir="{"ltr" if locale == "en" else "rtl"}"'.encode() in html
        pdf = PdfReader(io.BytesIO(raw))
        assert packet["number"] in "".join(page.extract_text() for page in pdf.pages)
        embedded = 0
        for page in pdf.pages:
            for ref in page["/Resources"]["/Font"].values():
                for descendant in ref.get_object().get("/DescendantFonts", []):
                    descriptor = descendant.get_object()["/FontDescriptor"].get_object()
                    assert descriptor.get("/FontFile2") or descriptor.get("/FontFile3")
                    embedded += 1
        assert embedded
        (output / f"handover-{locale}.pdf").write_bytes(raw)
        (output / f"handover-{locale}.html").write_bytes(html)
        records.append({"locale": locale, "pages": len(pdf.pages), "embedded_fonts": embedded, "synthetic": True})
    (output / "inspection.json").write_text(json.dumps(records, indent=2) + "\n")
    print(
        "Four actual audited synthetic handovers generated with retained assets and embedded fonts; visual inspection separate."
    )


if __name__ == "__main__":
    main()
