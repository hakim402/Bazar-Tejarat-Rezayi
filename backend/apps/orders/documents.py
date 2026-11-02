"""Native private invoice rendering from retained data and fixed local assets only.
fpdf2 + embedded fonts + HarfBuzz apply actual Unicode bidi/shaping. No HTML,
URL fetcher, external browser, user template/path or remote font is executed.
"""

from pathlib import Path
from textwrap import wrap
from html import escape
from base64 import b64encode
from zoneinfo import ZoneInfo
from apps.catalogue.media import StorageUnavailable

ASSETS = Path(__file__).resolve().parent / "assets"
COPY = {
    "en": {
        "invoice": "Goods invoice",
        "buyer": "Buyer",
        "seller": "Seller",
        "issued": "Issued",
        "title": "Product / SKU",
        "quantity": "Quantity",
        "price": "Unit price",
        "amount": "Goods amount",
        "total": "Goods total",
        "delivery": "Delivery amount pending; arranged and paid separately. Excluded from goods total.",
        "state": "Unpaid · Unreserved · Not dispatched",
        "method": "Selected method",
        "destination": "Destination",
        "advance": "Advance",
        "cod": "Cash on delivery",
        "due": "Advance due (Kabul time)",
        "terms": "Accepted terms version",
        "fallback": "Source language",
        "negotiated": "Seller-finalized negotiated agreement; no second buyer confirmation.",
        "notice": "This retained goods agreement does not record payment or dispatch.",
        "page": "Page",
        "continued": "Continued",
        "retail": "Retail",
        "wholesale": "Wholesale",
    },
    "fa-AF": {
        "invoice": "صورتحساب کالا",
        "buyer": "خریدار",
        "seller": "فروشنده",
        "issued": "تاریخ صدور",
        "title": "محصول / شناسه",
        "quantity": "مقدار",
        "price": "قیمت واحد",
        "amount": "مبلغ کالا",
        "total": "مجموع کالا",
        "delivery": "هزینهٔ تحویل هنوز تعیین نشده و جداگانه پرداخت می‌شود؛ شامل مجموع کالا نیست.",
        "state": "پرداخت‌نشده · ذخیره‌نشده · ارسال‌نشده",
        "method": "روش انتخاب‌شده",
        "destination": "مقصد",
        "advance": "پیش‌پرداخت",
        "cod": "پرداخت هنگام تحویل",
        "due": "مهلت پیش‌پرداخت (وقت کابل)",
        "terms": "نسخهٔ شرایط پذیرفته‌شده",
        "fallback": "زبان منبع",
        "negotiated": "توافق مذاکره‌شده به نهایی‌سازی فروشنده؛ بدون تأیید دوبارهٔ خریدار.",
        "notice": "این توافق ثبت‌شدهٔ کالا، تأیید پرداخت یا ارسال نیست.",
        "page": "صفحه",
        "continued": "ادامه",
        "retail": "پرچون",
        "wholesale": "عمده",
    },
    "ps": {
        "invoice": "د توکو بل",
        "buyer": "پېرودونکی",
        "seller": "پلورونکی",
        "issued": "د صادرېدو نېټه",
        "title": "محصول / پېژند",
        "quantity": "مقدار",
        "price": "د واحد بیه",
        "amount": "د توکو مبلغ",
        "total": "د توکو ټولیز مبلغ",
        "delivery": "د لېږد لګښت لا نه دی ټاکل شوی؛ جلا تنظیم او ورکول کېږي او په ټولیز مبلغ کې نشته.",
        "state": "ناورکړل شوی · نا خوندي شوی · نه دی لېږل شوی",
        "method": "ټاکل شوې طریقه",
        "destination": "موخه",
        "advance": "مخکې تادیه",
        "cod": "د سپارلو پر مهال تادیه",
        "due": "د مخکې تادیې مهلت (کابل وخت)",
        "terms": "د منل شوو شرطونو نسخه",
        "fallback": "د سرچینې ژبه",
        "negotiated": "د پلورونکي وروستۍ خبرې شوې هوکړه؛ د پېرودونکي بیا تایید نه غواړي.",
        "notice": "دا د توکو ساتل شوې هوکړه د تادیې یا لېږد تایید نه دی.",
        "page": "پاڼه",
        "continued": "دوام",
        "retail": "پرچون",
        "wholesale": "عمده",
    },
    "ar": {
        "invoice": "فاتورة البضائع",
        "buyer": "المشتري",
        "seller": "البائع",
        "issued": "تاريخ الإصدار",
        "title": "المنتج / الرمز",
        "quantity": "الكمية",
        "price": "سعر الوحدة",
        "amount": "مبلغ البضائع",
        "total": "إجمالي البضائع",
        "delivery": "مبلغ التوصيل قيد التحديد ويُرتب ويُدفع منفصلاً؛ غير مشمول بإجمالي البضائع.",
        "state": "غير مدفوع · غير محجوز · غير مرسل",
        "method": "الطريقة المختارة",
        "destination": "الوجهة",
        "advance": "دفع مقدم",
        "cod": "الدفع عند الاستلام",
        "due": "مهلة الدفع المقدم (وقت كابل)",
        "terms": "نسخة الشروط المقبولة",
        "fallback": "لغة المصدر",
        "negotiated": "اتفاق تفاوضي أنهى البائع شروطه دون تأكيد ثانٍ من المشتري.",
        "notice": "اتفاق البضائع المحفوظ هذا لا يسجل الدفع أو الإرسال.",
        "page": "صفحة",
        "continued": "تابع",
        "retail": "تجزئة",
        "wholesale": "جملة",
    },
}


def localized(line, locale):
    text = line.snapshot["titles"]
    source = line.snapshot["source_locale"]
    chosen = locale if locale in text else source
    return text[chosen] + (f" ({COPY[locale]['fallback']}: {source})" if chosen != locale else "")


def variant_text(line, locale):
    definition = line.snapshot["definition"]
    labels = line.snapshot.get("attribute_labels", {})
    result = []
    for key, value in definition.get("attributes", {}).items():
        name = labels.get(key, {}).get(locale, labels.get(key, {}).get("fa-AF", key))
        result.append(f"{name}: {value}")
    if definition.get("contents"):
        result.append(f"{COPY[locale]['fallback']} ({line.snapshot['source_locale']}): {definition['contents']}")
    return " · ".join(result)


def time_text(value):
    return value.astimezone(ZoneInfo("Asia/Kabul")).strftime("%Y-%m-%d %H:%M")


def pdf_bytes(invoice, locale):
    if locale not in COPY:
        raise StorageUnavailable()
    try:
        from fpdf import FPDF
        from fpdf.fonts import FontFace

        t = COPY[locale]
        order = invoice.order
        lines = list(order.lines.all())
        assert 1 <= len(lines) <= 100

        class InvoicePDF(FPDF):
            def header(self):
                self.image(str(ASSETS / f"{locale}.svg"), x=12 if locale == "en" else self.w - 60, y=10, w=48)
                self.set_y(29)
                self.set_font("Arabic" if locale != "en" else "Latin", "B", 15)
                self.multi_cell(0, 8, t["invoice"], align="R" if locale != "en" else "L", new_x="LMARGIN", new_y="NEXT")
                self.set_font("Latin", "", 10)
                self.cell(0, 7, invoice.number, align="R", new_x="LMARGIN", new_y="NEXT")
                self.ln(3)

            def footer(self):
                self.set_y(-13)
                self.set_font("Latin", "", 9)
                self.cell(0, 6, str(self.page_no()), align="C")

        pdf = InvoicePDF()
        pdf.set_margins(12, 12, 12)
        pdf.set_auto_page_break(True, 18)
        for family, name in [("Arabic", "NotoSansArabic"), ("Latin", "NotoSans")]:
            pdf.add_font(family, "", str(ASSETS / (name + "-Regular.ttf")))
            pdf.add_font(family, "B", str(ASSETS / (name + "-Bold.ttf")))
        pdf.set_font("Arabic" if locale != "en" else "Latin", "", 10)
        pdf.set_fallback_fonts(["Latin", "Arabic"])
        pdf.set_text_shaping(True)
        pdf.set_title(t["invoice"] + " " + invoice.number)
        pdf.add_page()
        align = "R" if locale != "en" else "L"

        def paragraph(text, bold=False):
            pdf.set_font("Arabic" if locale != "en" else "Latin", "B" if bold else "", 10)
            pdf.multi_cell(0, 7, text, align=align, new_x="LMARGIN", new_y="NEXT", wrapmode="WORD")

        paragraph(t["issued"] + ":")
        paragraph(time_text(invoice.issued_at) + " · " + order.currency)
        paragraph(t["buyer"] + ": " + order.snapshot["buyer"])
        paragraph(t["seller"] + ": " + order.snapshot["seller"])
        pdf.ln(4)
        headers = [t["title"], t["quantity"], t["price"], t["amount"]]
        pdf.set_font("Arabic" if locale != "en" else "Latin", "", 9)
        with pdf.table(
            col_widths=(90, 28, 30, 38) if locale == "en" else (38, 30, 28, 90),
            width=186,
            line_height=6,
            padding=2,
            text_align=align,
            wrapmode="WORD",
            headings_style=FontFace(emphasis="B", fill_color=(234, 244, 255)),
            repeat_headings=1,
        ) as table:
            table.row(headers if locale == "en" else list(reversed(headers)))
            for line in lines:
                cells = [
                    localized(line, locale)
                    + ("\n" + variant_text(line, locale) if variant_text(line, locale) else "")
                    + "\n"
                    + line.snapshot["sku"]
                    + " · "
                    + line.snapshot["unit_labels"].get(locale, line.snapshot["unit"])
                    + " · "
                    + t[line.tier],
                    format(line.quantity, ".3f"),
                    format(line.unit_price, ".2f") + " " + order.currency,
                    format(line.goods_amount, ".2f") + " " + order.currency,
                ]
                paragraphs = []
                for paragraph_text in cells[0].splitlines():
                    paragraphs.extend(
                        wrap(
                            paragraph_text,
                            width=600,
                            break_long_words=True,
                            break_on_hyphens=False,
                            replace_whitespace=False,
                            drop_whitespace=False,
                        )
                        or [""]
                    )
                chunks = []
                for paragraph_text in paragraphs:
                    if chunks and len(chunks[-1]) + len(paragraph_text) + 1 <= 600:
                        chunks[-1] += "\n" + paragraph_text
                    else:
                        chunks.append(paragraph_text)
                for index, chunk in enumerate(chunks):
                    text = chunk if index == 0 else f"{t['continued']} · {line.snapshot['sku']}\n{chunk}"
                    row = [text, *(cells[1:] if index == 0 else ["", "", ""])]
                    table.row(row if locale == "en" else list(reversed(row)))
        terms = order.snapshot["terms"]
        summary = [
            (t["total"] + ": " + format(order.goods_total, ".2f") + " " + order.currency, True),
            (t["delivery"], False),
            (t["state"], False),
            (t["method"] + ": " + t[order.payment_method], False),
            (t["destination"] + ": " + terms["destination"]["country"] + " / " + terms["destination"]["city"], False),
            (t["terms"] + ": " + str(terms["version"]), False),
        ]
        if order.due_at:
            summary.extend([(t["due"] + ":", False), (time_text(order.due_at), False)])
        if getattr(order,"negotiation_id",None):
            summary.append((t["negotiated"], False))
        summary.append((t["notice"], False))
        from fpdf.enums import MethodReturnValue

        height = 5
        for text, bold in summary:
            pdf.set_font("Arabic" if locale != "en" else "Latin", "B" if bold else "", 10)
            height += pdf.multi_cell(
                0,
                7,
                text,
                align=align,
                new_x="LMARGIN",
                new_y="NEXT",
                wrapmode="WORD",
                dry_run=True,
                output=MethodReturnValue.HEIGHT,
            )
        if pdf.will_page_break(height):
            pdf.add_page()
        pdf.ln(5)
        for text, bold in summary:
            paragraph(text, bold)
        return bytes(pdf.output())
    except Exception:
        raise StorageUnavailable() from None


def html_document(invoice, locale):
    if locale not in COPY:
        raise StorageUnavailable()
    t = COPY[locale]
    order = invoice.order

    def e(value):
        return escape(str(value), quote=True)

    rows = "".join(
        "<tr><td>"
        + e(localized(x, locale))
        + "<br>"
        + e(variant_text(x, locale))
        + "<br><bdi>"
        + e(x.snapshot["sku"])
        + "</bdi><br>"
        + e(t[x.tier])
        + " · "
        + e(x.snapshot["unit_labels"].get(locale, x.snapshot["unit"]))
        + "</td><td><bdi>"
        + format(x.quantity, ".3f")
        + "</bdi></td><td><bdi>"
        + format(x.unit_price, ".2f")
        + "</bdi></td><td><bdi>"
        + format(x.goods_amount, ".2f")
        + "</bdi></td></tr>"
        for x in order.lines.all()
    )
    logo = b64encode((ASSETS / f"{locale}.svg").read_bytes()).decode()
    latin_font = b64encode((ASSETS / "NotoSans-Regular.ttf").read_bytes()).decode()
    arabic_font = b64encode((ASSETS / "NotoSansArabic-Regular.ttf").read_bytes()).decode()
    font_stack = "InvoiceLatin,InvoiceArabic" if locale == "en" else "InvoiceArabic,InvoiceLatin"
    accepted_terms = order.snapshot["terms"]
    details = "".join(
        "<p>" + e(t[label]) + ": <bdi>" + e(value) + "</bdi></p>"
        for label, value in [
            ("issued", time_text(invoice.issued_at)),
            ("method", t[order.payment_method]),
            ("destination", accepted_terms["destination"]["country"] + " / " + accepted_terms["destination"]["city"]),
            ("terms", accepted_terms["version"]),
        ]
    )
    if order.due_at:
        details += "<p>" + e(t["due"]) + ": <bdi>" + e(time_text(order.due_at)) + "</bdi></p>"
    return f"""<!doctype html><html lang="{locale}" dir="{"ltr" if locale == "en" else "rtl"}"><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><title>{e(t["invoice"])} {e(invoice.number)}</title><style>@font-face{{font-family:InvoiceLatin;src:url(data:font/ttf;base64,{latin_font})}}@font-face{{font-family:InvoiceArabic;src:url(data:font/ttf;base64,{arabic_font})}}body{{font:14px {font_stack},sans-serif;max-width:900px;margin:2rem auto;padding:1rem;color:#142b3d}}img{{width:180px}}table{{width:100%;border-collapse:collapse;table-layout:fixed}}th,td{{padding:10px;border:1px solid #c4d0da;overflow-wrap:anywhere;text-align:start}}thead{{display:table-header-group}}tr,.summary{{break-inside:avoid}}h2{{break-after:avoid}}@media print{{body{{margin:0}}}}@page{{size:A4;margin:16mm}}</style><img alt="" src="data:image/svg+xml;base64,{logo}"><h1>{e(t["invoice"])}</h1><p><bdi>{e(invoice.number)} · {order.currency}</bdi></p><p>{e(t["buyer"])}: {e(order.snapshot["buyer"])}</p><p>{e(t["seller"])}: {e(order.snapshot["seller"])}</p><table><colgroup><col style="width:48%"><col style="width:15%"><col style="width:16%"><col style="width:21%"></colgroup><thead><tr>{"".join("<th>" + e(t[k]) + "</th>" for k in ["title", "quantity", "price", "amount"])}</tr></thead><tbody>{rows}</tbody></table><section class="summary"><h2>{e(t["total"])}: <bdi>{format(order.goods_total, ".2f")} {order.currency}</bdi></h2><p>{e(t["delivery"])}</p><p>{e(t["state"])}</p>{details}<p>{e(t["negotiated"]) if getattr(order,"negotiation_id",None) else ""}</p><p>{e(t["notice"])}</p></section></html>"""
