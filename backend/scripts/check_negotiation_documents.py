"""Create an actual negotiated agreement only in the runner-owned database."""

import argparse
import json
import uuid
from pathlib import Path
import django
from django.db import connection
from django.test import override_settings
from config.testing import assert_owned_database


def main():
    django.setup()
    assert_owned_database(connection)
    from apps.accounts.models import User
    from apps.messaging.management.commands.seed_messaging_examples import actor
    from apps.cart import services as cart
    from apps.catalogue.models import Variant
    from apps.orders import negotiations as n
    from apps.orders.models import Negotiation, Invoice
    from apps.orders.documents import pdf_bytes, html_document, COPY
    from pypdf import PdfReader

    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    output = parser.parse_args().output
    output.mkdir(parents=True, exist_ok=True)
    with override_settings(OWNER_MFA_REQUIRED=False):
        buyer = actor(User.objects.get(email="phase11-buyer@example.test"), "buyer")
        seller = actor(User.objects.get(email="phase11-owner-a@example.test"), "seller")
        variant = Variant.objects.get(sku="P11-A-0")
        row = cart.buyer(buyer)
        lines = [
            {
                "variant": str(variant.pk),
                "tier": "retail",
                "quantity": "2.000",
                "unit_price": "10.00",
                "max_quantity": "4.000",
                "max_unit_price": "15.00",
            }
        ]
        choice = {"seller": str(variant.product.seller_id), "country": "AF", "city": "kabul", "method": "advance"}
        result = n.submit(
            buyer,
            {
                "command_id": uuid.uuid4(),
                "version": row.version,
                "currency": "AFN",
                "lines": list(row.lines.filter(variant=variant).values_list("pk", flat=True)),
                "proposals": [
                    {
                        "lines": lines,
                        "choice": choice,
                        "explanation": "seller-finalizes-v1",
                        "note": "Synthetic document review",
                    }
                ],
            },
        )
        request = Negotiation.objects.get(pk=result["outcomes"][0]["request"])
        final = n.transition(
            seller,
            request.pk,
            "finalize",
            {
                "command_id": uuid.uuid4(),
                "version": request.version,
                "reason": "Synthetic four-language invoice check",
                "lines": [{k: v for k, v in lines[0].items() if not k.startswith("max_")}],
                "choice": choice,
            },
        )
        invoice = Invoice.objects.get(pk=final["invoice"])
    records = []
    for locale in ["fa-AF", "ps", "ar", "en"]:
        path = output / f"negotiated-{locale}.pdf"
        path.write_bytes(pdf_bytes(invoice, locale))
        html = html_document(invoice, locale)
        (output / f"negotiated-{locale}.html").write_text(html)
        assert COPY[locale]["negotiated"] in html and "NEVER-PUBLIC" not in html
        doc = PdfReader(path)
        text = "".join(p.extract_text() for p in doc.pages)
        assert invoice.number in text
        fonts = set()
        for page in doc.pages:
            for ref in page["/Resources"]["/Font"].values():
                font = ref.get_object()
                for item in font.get("/DescendantFonts", []):
                    d = item.get_object()["/FontDescriptor"].get_object()
                    assert d.get("/FontFile2") or d.get("/FontFile3")
                    fonts.add(str(font.get("/BaseFont")))
        assert fonts
        records.append(
            {
                "locale": locale,
                "pages": len(doc.pages),
                "fonts": sorted(fonts),
                "origin": "negotiated",
                "limits_retained": invoice.order.snapshot["proposal"]["lines"][0]["max_unit_price"] == "15.00",
            }
        )
    (output / "inspection.json").write_text(json.dumps(records, indent=2) + "\n")
    print(
        "Actual negotiated four-language invoices generated with retained provenance, original assets and embedded fonts; visual review separate."
    )


if __name__ == "__main__":
    main()
