"""Inspect actual local four-language PDFs using run-owned frozen agreements."""

import argparse
import hashlib
import json
from pathlib import Path
import django
from pypdf import PdfReader
from django.db import connection
from config.testing import assert_owned_database


def main():
    django.setup()
    assert_owned_database(connection)
    from apps.orders.models import Invoice
    from apps.orders.documents import pdf_bytes, html_document

    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    target = parser.parse_args().output
    target.mkdir(parents=True, exist_ok=True)
    invoice = (
        Invoice.objects.filter(order__buyer__user__email="phase10-buyer@example.test").order_by("issued_at").first()
    )
    assert invoice and invoice.order.lines.count() == 40
    rows = []
    for locale in ["fa-AF", "ps", "ar", "en"]:
        path = target / ("invoice-" + locale + ".pdf")
        path.write_bytes(pdf_bytes(invoice, locale))
        (target / ("invoice-" + locale + ".html")).write_text(html_document(invoice, locale))
        doc = PdfReader(path)
        assert len(doc.pages) >= 2
        fonts = set()
        text = ""
        for page in doc.pages:
            text += page.extract_text()
            for ref in page["/Resources"]["/Font"].values():
                font = ref.get_object()
                descendants = font.get("/DescendantFonts", [])
                for item in descendants:
                    descriptor = item.get_object()["/FontDescriptor"].get_object()
                    assert descriptor.get("/FontFile2") or descriptor.get("/FontFile3")
                    fonts.add(str(font.get("/BaseFont")))
        assert fonts and invoice.number in text and "NEVER-PUBLIC" not in text
        rows.append(
            {
                "locale": locale,
                "pages": len(doc.pages),
                "bytes": path.stat().st_size,
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                "embedded_fonts": sorted(fonts),
            }
        )
    # Also exercise one permitted line whose full attributes cannot fit on a page.
    # These renderer-only specimens never create or alter database records.
    from types import SimpleNamespace as NS
    from decimal import Decimal

    attributes = {"attribute" + str(i): "Mixed specimen ABC 123 " + "طویل " * 35 for i in range(24)}
    attributes["attribute23"] = "LASTFIELD-SENTINEL " + "طویل " * 35
    assert all(len(value) <= 200 for value in attributes.values())
    line = NS(
        snapshot={
            "titles": {"en": "Long permitted product"},
            "source_locale": "en",
            "definition": {"attributes": attributes},
            "sku": "LONG-VALID-1",
            "unit": "piece",
            "unit_labels": {"en": "Piece"},
            "attribute_labels": {},
        },
        tier="retail",
        quantity=Decimal("1.000"),
        unit_price=Decimal("12.50"),
        goods_amount=Decimal("12.50"),
    )
    order = NS(
        lines=NS(all=lambda: [line]),
        currency="AFN",
        goods_total=Decimal("12.50"),
        payment_method="cod",
        due_at=None,
        snapshot={
            "buyer": "Synthetic buyer",
            "seller": "Synthetic seller",
            "terms": {"destination": {"country": "AF", "city": "kabul"}, "version": 1},
        },
    )
    specimen = NS(order=order, number="BR-SYNTHETIC-LONG", issued_at=invoice.issued_at)
    for locale in ["fa-AF", "ps", "ar", "en"]:
        path = target / ("long-row-" + locale + ".pdf")
        path.write_bytes(pdf_bytes(specimen, locale))
        document = PdfReader(path)
        text = "\n".join(page.extract_text() for page in document.pages)
        assert len(document.pages) >= 2 and "LASTFIELD-SENTINEL" in text
        assert text.count("1.000") == 1 and text.count("12.50") == 3
        rows.append(
            {
                "locale": locale,
                "kind": "long-single-line",
                "pages": len(document.pages),
                "bytes": path.stat().st_size,
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                "quantities_and_amounts_once": True,
                "last_attribute_present": True,
            }
        )
    (target / "inspection.json").write_text(json.dumps(rows, indent=2) + "\n")
    print(
        "Actual four-language multi-page invoices generated, parsed and embedded fonts checked. Visual inspection remains separate."
    )


if __name__ == "__main__":
    main()
