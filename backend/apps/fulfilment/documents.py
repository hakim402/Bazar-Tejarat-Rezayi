"""Audited per-shipment handover, separate from original goods invoice and payments."""

from html import escape
from base64 import b64encode
from django.db import transaction
from django.utils import timezone
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import NotFound
from apps.accounts.models import AuditEvent
from apps.orders.documents import ASSETS, time_text, localized
from apps.catalogue.media import StorageUnavailable
from . import access, models as m

HANDOVER_CSP = (
    "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; "
    "frame-ancestors 'none'; base-uri 'none'"
)

COPY = {
    "en": (
        "Recipient handover",
        "Generated (Kabul)",
        "Provider",
        "Recipient",
        "Phone",
        "Delivery address",
        "Instructions",
        "Goods / SKU / quantity",
        "Authorized manual handover; no payment or carrier verification.",
    ),
    "fa-AF": (
        "سند تحویل به گیرنده",
        "زمان صدور (کابل)",
        "ارائه‌کنندهٔ تحویل",
        "گیرنده",
        "شمارهٔ تماس",
        "نشانی تحویل",
        "راهنمای تحویل",
        "کالا / شناسه / مقدار",
        "تحویل دستی مجاز؛ تأیید پرداخت یا شرکت حمل‌ونقل نیست.",
    ),
    "ps": (
        "ترلاسه کوونکي ته د سپارلو سند",
        "د جوړېدو وخت (کابل)",
        "د لېږد چمتو کوونکی",
        "ترلاسه کوونکی",
        "د اړیکې شمېره",
        "د سپارلو پته",
        "لارښوونې",
        "توکي / پېژند / مقدار",
        "مجاز لاسي سپارل؛ د تادیې یا لېږد شرکت تایید نه دی.",
    ),
    "ar": (
        "مستند تسليم للمستلم",
        "وقت الإنشاء (كابل)",
        "مقدم التوصيل",
        "المستلم",
        "الهاتف",
        "عنوان التسليم",
        "التعليمات",
        "البضائع / الرمز / الكمية",
        "تسليم يدوي مصرح به؛ لا يؤكد الدفع أو التحقق من الناقل.",
    ),
}


@transaction.atomic
def snapshot(actor, pk, locale):
    if locale not in COPY:
        raise NotFound()
    order = access.lock_order(actor, pk)
    caps = access.capabilities(actor, order)
    if not caps["handover"] or not caps["recipient"]:
        raise NotFound()
    shipment = get_object_or_404(
        m.Shipment.objects.select_related(
            "preparation__recipient", "preparation__arrangement__provider", "order__invoice"
        ),
        order=order,
    )
    recipient = shipment.preparation.recipient
    provider = shipment.preparation.arrangement.provider
    AuditEvent.objects.create(
        actor=actor.user,
        account=access.account_for(actor),
        context=actor.context,
        action="fulfilment_handover",
        resource_type="fulfilment.shipment",
        resource_id=shipment.pk,
        reason="Authorized per-shipment provider handover",
        state={"provider": str(provider.pk), "recipient_revision": recipient.revision, "locale": locale},
    )
    return {
        "number": order.invoice.number,
        "shipment": str(shipment.pk),
        "generated": time_text(timezone.now()),
        "provider": provider.name,
        "revision": recipient.revision,
        "name": recipient.name,
        "phone": recipient.phone,
        "address": recipient.address,
        "instructions": recipient.instructions,
        "destination": order.snapshot.get("terms", {}).get("destination", {}),
        "lines": [
            {
                "title": localized(line, locale),
                "sku": line.snapshot.get("sku", ""),
                "quantity": format(line.quantity, ".3f"),
                "unit": line.snapshot.get("unit_labels", {}).get(locale, line.snapshot.get("unit", "")),
            }
            for line in order.lines.all()
        ],
    }


def text_rows(data, locale):
    t = COPY[locale]

    def isolate(value, *, ltr=False):
        # Isolate each value from translated labels. A phone or ISO timestamp
        # must keep its exact order inside an RTL paragraph and PDF shaping.
        return ("\u2066" if ltr else "\u2068") + str(value) + "\u2069"

    return [
        t[0],
        isolate(data["number"], ltr=True),
        f"{t[1]}: {isolate(data['generated'], ltr=True)}",
        f"{t[2]}: {isolate(data['provider'])}",
        f"{t[3]} ({isolate('v' + str(data['revision']), ltr=True)}): {isolate(data['name'])}",
        f"{t[4]}: {isolate(data['phone'], ltr=True)}",
        f"{t[5]}: {isolate(data['address'])}",
        f"{t[6]}: {isolate(data['instructions'])}",
        t[7],
        *[
            f"{isolate(x['title'])} / {isolate(x['sku'], ltr=True)} / {isolate(x['quantity'], ltr=True)} {isolate(x['unit'])}"
            for x in data["lines"]
        ],
        t[8],
    ]


def html_bytes(data, locale):
    if locale not in COPY:
        raise StorageUnavailable()
    try:
        logo = b64encode((ASSETS / f"{locale}.svg").read_bytes()).decode()
        latin = b64encode((ASSETS / "NotoSans-Regular.ttf").read_bytes()).decode()
        arabic = b64encode((ASSETS / "NotoSansArabic-Regular.ttf").read_bytes()).decode()
    except OSError:
        raise StorageUnavailable() from None
    rows = text_rows(data, locale)
    body = "".join(f"<p><bdi>{escape(row)}</bdi></p>" for row in rows)
    stack = "HandoverLatin,HandoverArabic" if locale == "en" else "HandoverArabic,HandoverLatin"
    styles = (
        f"@font-face{{font-family:HandoverLatin;src:url(data:font/ttf;base64,{latin})}}"
        f"@font-face{{font-family:HandoverArabic;src:url(data:font/ttf;base64,{arabic})}}"
        f"body{{font:14px {stack},sans-serif;max-width:900px;margin:2rem auto;padding:1rem;color:#142b3d}}"
        "p{overflow-wrap:anywhere}img{width:180px}p:first-child{font-size:20px}"
        "@media print{body{margin:0}}@page{size:A4;margin:16mm}"
    )
    return (
        f'<!doctype html><html lang="{locale}" dir="{"ltr" if locale == "en" else "rtl"}"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>{escape(COPY[locale][0])}</title><style>{styles}</style><body><img alt="" width="180" src="data:image/svg+xml;base64,{logo}"><main>{body}</main></body></html>'
    ).encode()


def pdf_bytes(data, locale):
    if locale not in COPY:
        raise StorageUnavailable()
    try:
        from fpdf import FPDF

        pdf = FPDF()
        pdf.set_margins(14, 14, 14)
        pdf.set_auto_page_break(True, 18)
        for family, name in [("Arabic", "NotoSansArabic"), ("Latin", "NotoSans")]:
            for style, suffix in [("", "Regular"), ("B", "Bold")]:
                pdf.add_font(family, style, str(ASSETS / f"{name}-{suffix}.ttf"))
        pdf.set_fallback_fonts(["Latin", "Arabic"])
        pdf.set_text_shaping(True)
        pdf.add_page()
        pdf.image(str(ASSETS / f"{locale}.svg"), x=14 if locale == "en" else pdf.w - 62, y=12, w=48)
        pdf.set_y(35)
        pdf.set_font("Latin" if locale == "en" else "Arabic", size=11)
        for row in text_rows(data, locale):
            pdf.multi_cell(0, 8, row, align="L" if locale == "en" else "R", new_x="LMARGIN", new_y="NEXT")
        return bytes(pdf.output())
    except Exception:
        raise StorageUnavailable() from None
