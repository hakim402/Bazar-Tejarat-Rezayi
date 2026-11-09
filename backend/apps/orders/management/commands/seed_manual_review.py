"""Bounded synthetic manual-review seed for the preserved LOCAL preview only.

This is the preview-safe counterpart to the disposable ``seed_*`` fixtures: those
refuse every application database by design and that guard is left untouched. This
command instead refuses everything *except* the exact owned local synthetic preview
identified by the private ownership marker, and advances scenarios only as far as the
real domain guards allow. Every staff decision (verification, store approval, product
publication, delivery-charge review, cancellation/amendment/dispute decisions, review
moderation, refund confirmation and report resolution) is left to the owner's existing
native admin account; the command prints the pending actions and advances further on a
later rerun once the owner has approved them.

All identities use non-deliverable ``@example.test`` addresses, names are prefixed
``آزمایشی • Synthetic``, SKUs use ``SYN-REV-*`` and reasons use ``Synthetic manual-review``.
PDF-derived categories preserve the owner's exact Dari labels; other locales are working
translations. No real contact, price, ownership or claim from the PDF is invented.
"""

import json
import os
import re
import secrets
import time
import uuid
from datetime import timedelta
from email import policy
from email.parser import BytesParser
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import requests
from django.conf import settings
from django.core.management import BaseCommand, CommandError
from django.db import connection
from django.utils import timezone

from apps.accounts.models import User
from apps.catalogue.models import Category, Product, SaleUnit, Variant
from apps.catalogue import services as catalogue
from apps.catalogue.media import upload as product_upload
from apps.cart import services as cart
from apps.inventory import services as inventory
from apps.inventory.models import Position
from apps.marketplace import services as stores
from apps.marketplace.models import Store
from apps.messaging import services as messaging
from apps.messaging.models import Report
from apps.orders import services as orders
from apps.orders import cancellations, amendments, disputes, reviews
from apps.orders.models import SellerOrder, OrderLine, CancellationRequest, Amendment, DisputeRequest, Review
from apps.organizations import profiles
from apps.organizations.models import BusinessProfile
from apps.payments import services as goods, refunds, media as payment_media
from apps.payments.models import RefundDue
from apps.fulfilment import models as delivery, services as fulfilment, transitions
from apps.verification import services as verification
from apps.messaging.management.commands.seed_messaging_examples import actor
from apps.marketplace.management.commands.seed_marketplace_examples import image_file
from apps.orders.management.commands.seed_commerce_examples import finance_version, aftercare_version

MARKER_REL = "data/local-cpanel-alignment/20261102T081826Z/preview-ownership.json"
PREFIX = "seed-review-"
REASON = "Synthetic manual-review "
EMAIL_DOMAIN = "@example.test"

# PDF goods/services axis. Dari labels are verbatim from the owner's note; the other
# locales are working translations, not PDF source facts. ``food`` reuses the existing
# default category whose Dari label already matches the PDF exactly.
PDF_CATEGORIES = [
    ("food", "مواد غذایی", "Food", "خوراکي توکي", "مواد غذائية", ["kg", "g", "piece", "pack"]),
    ("motorcycle-parts", "قطعات و لوازم یدکی (پرزه‌جات) موتورسیکلت", "Motorcycle spare parts", "د موټر سايکل پرزه جات", "قطع غيار الدراجات النارية", ["piece", "set"]),
    ("agricultural-products", "محصولات زراعتی", "Agricultural products", "کرنيز توکي", "منتجات زراعية", ["kg", "g", "carton"]),
    ("detergents-hygiene", "مواد شوینده و بهداشتی", "Detergents and hygiene", "پاکوونکي او روغتيايي توکي", "مواد التنظيف والصحة", ["piece", "litre", "pack"]),
    ("general-merchandise", "کالاهای تجاری عمومی", "General merchandise", "عمومي سوداګريز توکي", "بضائع تجارية عامة", ["piece", "set", "carton"]),
    ("services-repairs", "خدمات و تعمیرات", "Services and repairs", "خدمتونه او ترميمات", "خدمات وإصلاحات", ["piece"]),
    ("afghan-dried-fruit", "میوه خشک افغانستان", "Afghan dried fruit", "د افغانستان وچ مېوه", "فواكه مجففة أفغانية", ["kg", "g", "pack"]),
    ("foreign-dried-fruit", "میوه خشک خارجی", "Foreign dried fruit", "بهرنۍ وچه مېوه", "فواكه مجففة أجنبية", ["kg", "g", "pack"]),
    ("electrical-electronics", "لوازم برقی و الکترونیکی", "Electrical and electronics", "برېښنايي او الکترونيکي توکي", "أدوات كهربائية وإلكترونية", ["piece", "set"]),
    ("construction-materials", "لوازم ساختمانی", "Construction materials", "د ودانۍ توکي", "مواد بناء", ["piece", "set", "carton"]),
    ("cosmetics-hygiene", "لوازم آرایشی و بهداشتی", "Cosmetics and hygiene", "د ښکلا او روغتيا توکي", "مستحضرات تجميل وصحة", ["piece", "ml", "pack"]),
    ("household-kitchen", "لوازم خانگی و آشپزخانه", "Household and kitchen", "کورني او د پخلنځي توکي", "أدوات منزلية ومطبخ", ["piece", "set"]),
    ("children-goods", "کالا کودکان", "Children goods", "د ماشومانو توکي", "سلع الأطفال", ["piece", "set", "pack"]),
]

SELLERS = [
    {"key": "seller1", "email": PREFIX + "seller1" + EMAIL_DOMAIN, "name": "آزمایشی • Synthetic domestic retail",
     "business_type": "فروشگاه‌ها کوچک تک فروشی", "legal": "فروشگاه آزمایشی رضایی", "city": "Kabul"},
    {"key": "seller2", "email": PREFIX + "seller2" + EMAIL_DOMAIN, "name": "آزمایشی • Synthetic importer",
     "business_type": "واردکننده‌ها", "legal": "شرکت آزمایشی واردات", "city": "Herat"},
]
BUYERS = [
    {"key": "buyer1", "email": PREFIX + "buyer1" + EMAIL_DOMAIN, "name": "آزمایشی • Synthetic buyer one"},
    {"key": "buyer2", "email": PREFIX + "buyer2" + EMAIL_DOMAIN, "name": "آزمایشی • Synthetic buyer two"},
]
# sku, seller key, category, Dari title, unit, retail AFN
PRODUCTS = [
    ("SYN-REV-MOTO", "seller1", "motorcycle-parts", "پرزه‌جات موتورسیکلت — Synthetic", "piece", "850.00"),
    ("SYN-REV-DRIED", "seller1", "afghan-dried-fruit", "میوه خشک افغانستان — Synthetic", "kg", "1200.00"),
    ("SYN-REV-FOOD", "seller1", "food", "مواد غذایی — Synthetic", "kg", "450.00"),
    ("SYN-REV-FOREIGN", "seller2", "foreign-dried-fruit", "میوه خشک خارجی — Synthetic", "kg", "1500.00"),
    ("SYN-REV-COSM", "seller2", "cosmetics-hygiene", "لوازم آرایشی و بهداشتی — Synthetic", "piece", "600.00"),
    ("SYN-REV-HOME", "seller2", "household-kitchen", "لوازم خانگی و آشپزخانه — Synthetic", "piece", "2300.00"),
]


class Seed:
    def __init__(self, command):
        self.command = command
        self.task = Path(settings.DATA_ROOT).parent
        self.marker = json.loads((self.task / "preview-ownership.json").read_text())
        self.mail_root = Path(self.marker["private_mail_root"])
        self.api = self.marker["api_origin"]
        self.origin = self.marker["origin"]
        self.manifest_path = self.task / "seed-review-manifest.json"
        self.access_path = self.task / "seed-review-access.json"
        self.manifest = self._load(self.manifest_path, {"users": {}, "profiles": {}, "stores": {}, "products": {}, "orders": {}, "reports": {}, "categories": []})
        self.access = self._load(self.access_path, {"synthetic_local_only": True, "accounts": {}})
        self.counts = {"created": {}, "updated": {}, "skipped": {}}
        self.pending = []

    @staticmethod
    def _load(path, default):
        if path.exists():
            return json.loads(path.read_text())
        return default

    def _save(self, path, value):
        candidate = path.with_name("." + path.name + "-candidate")
        with os.fdopen(os.open(candidate, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as out:
            json.dump(value, out, indent=2, ensure_ascii=False)
        os.replace(candidate, path)

    def save(self):
        self._save(self.manifest_path, self.manifest)
        self._save(self.access_path, self.access)

    def bump(self, kind, key, created):
        bucket = "created" if created else "skipped"
        self.counts[bucket][kind] = self.counts[bucket].get(kind, 0) + 1

    def pending_action(self, area, action, target):
        self.pending.append({"area": area, "action": action, "target": str(target)})

    # -- target verification -------------------------------------------------
    def verify_target(self):
        if settings.PRODUCTION or not settings.DEBUG:
            raise CommandError("This seed only runs in local development, never production.")
        if self.marker.get("purpose") != "owned-local-synthetic-preview" or self.marker.get("uid") != os.getuid():
            raise CommandError("Ownership marker does not describe this owned local preview.")
        db = settings.DATABASES["default"]
        socket = db.get("OPTIONS", {}).get("unix_socket", db.get("HOST"))
        if (db["NAME"], db.get("USER"), socket) != (self.marker["database"], self.marker["role"], self.marker["socket"]):
            raise CommandError("Resolved database/role/socket do not match the owned preview marker.")
        with connection.cursor() as cursor:
            cursor.execute("SELECT DATABASE(), CURRENT_USER()")
            live_db, live_user = cursor.fetchone()
        if live_db != self.marker["database"] or not live_user.startswith(self.marker["role"] + "@"):
            raise CommandError("Live connection is not the owned preview database.")

    # -- identity via real auth + capture mail -------------------------------
    def _csrf(self, session):
        response = session.get(self.api + "/api/v1/auth/csrf/", timeout=10)
        response.raise_for_status()
        return response.json()["csrf_token"]

    def _headers(self, session):
        return {"Origin": self.origin, "X-CSRFToken": self._csrf(session)}

    def _capture_token(self, email, deadline):
        while time.monotonic() < deadline:
            for path in self.mail_root.glob("*.eml"):
                message = BytesParser(policy=policy.default).parsebytes(path.read_bytes())
                if email not in str(message["To"]):
                    continue
                for part in message.walk():
                    if part.get_content_type() not in ("text/plain", "text/html"):
                        continue
                    for raw in re.findall(r"http://127\.0\.0\.1:3100/[^\s<>\"']+", part.get_content()):
                        parsed = urlsplit(raw)
                        params = parse_qs(parsed.fragment)
                        if parsed.hostname == "127.0.0.1" and parsed.port == 3100 and "verify" in parsed.path and params.get("token"):
                            return params["token"][0]
            time.sleep(1)
        return None

    def ensure_user(self, spec, context, intent):
        email = spec["email"]
        user = User.objects.filter(email=email).first()
        if user and user.email_verified:
            self.bump("user", email, False)
            return user
        session = requests.Session()
        if user is None:
            password = "Synthetic-" + secrets.token_urlsafe(24) + "-8!"
            self.access["accounts"][email] = {"context": context, "password": password, "display_name": spec["name"]}
            response = session.post(
                self.api + f"/api/v1/auth/{context}/register/",
                json={"email": email, "password": password, "display_name": spec["name"], "intent": intent, "consent": True, "locale": "fa-AF"},
                headers=self._headers(session), timeout=15,
            )
            if response.status_code != 202:
                raise CommandError(f"Synthetic registration failed for {context}; inspect privately, no credential output.")
            self.save()
            user = User.objects.get(email=email)
            self.bump("user", email, True)
        else:
            self.bump("user", email, False)
        if not user.email_verified:
            token = self._capture_token(email, time.monotonic() + 90)
            if token is None:
                session.post(self.api + "/api/v1/auth/mail/verify/", json={"email": email, "locale": "fa-AF"}, headers=self._headers(session), timeout=15)
                token = self._capture_token(email, time.monotonic() + 90)
            if token is None:
                raise CommandError("Capture verification token not found; is the bounded clock running? Preserve mail and retry.")
            response = session.post(self.api + "/api/v1/auth/verify/", json={"token": token}, headers=self._headers(session), timeout=15)
            if response.status_code != 200:
                raise CommandError("Synthetic email verification failed; preserve captured state.")
            user.refresh_from_db()
            self.counts["updated"]["user"] = self.counts["updated"].get("user", 0) + 1
        self.manifest["users"][spec["key"]] = str(user.pk)
        return user

    # -- categories ----------------------------------------------------------
    def seed_categories(self):
        units = [
            ("piece", "عدد", "Piece", "دانه", "قطعة", False),
            ("set", "ست", "Set", "سیټ", "طقم", False),
            ("kg", "کیلوگرام", "Kilogram", "کیلوګرام", "كيلوغرام", True),
            ("g", "گرام", "Gram", "ګرام", "غرام", True),
            ("litre", "لیتر", "Litre", "لیتر", "لتر", True),
            ("ml", "میلی‌لیتر", "Millilitre", "میلي لیتر", "مليلتر", True),
            ("pack", "بسته", "Pack", "بسته", "عبوة", False),
            ("carton", "کارتن", "Carton", "کارتن", "كرتون", False),
        ]
        for code, fa, en, ps, ar, fractional in units:
            _, created = SaleUnit.objects.get_or_create(code=code, defaults={"labels": {"fa-AF": fa, "en": en, "ps": ps, "ar": ar}, "fractional": fractional})
            self.bump("sale_unit", code, created)
        for code, fa, en, ps, ar, unit_codes in PDF_CATEGORIES:
            labels = {"fa-AF": fa, "en": en, "ps": ps, "ar": ar}
            category, created = Category.objects.get_or_create(code=code, defaults={"labels": labels, "attributes": []})
            if created:
                category.units.set(SaleUnit.objects.filter(code__in=unit_codes))
                self.manifest["categories"].append(code)
            self.bump("category", code, created)

    # -- seller profiles -----------------------------------------------------
    def seed_profiles(self):
        result = {}
        for spec in SELLERS:
            user = User.objects.get(pk=self.manifest["users"][spec["key"]])
            seller = actor(user, "seller")
            profile = BusinessProfile.objects.filter(account=seller.account, kind="individual").first()
            if profile is None:
                profile = profiles.create_profile(seller, {
                    "kind": "individual", "display_name": spec["name"], "legal_name": spec["legal"],
                    "business_type": spec["business_type"], "contact_phone": "000-TEST-ONLY",
                    "location": "Synthetic private location — never real contact data",
                })
                self.bump("profile", spec["key"], True)
            else:
                self.bump("profile", spec["key"], False)
            self.manifest["profiles"][spec["key"]] = str(profile.pk)
            case = profiles.current_case(profile)
            if case.status == "draft":
                if not case.evidence.exists():
                    verification.upload_evidence(seller, profile.pk, image_file(), "identity", case.version)
                    case.refresh_from_db()
                verification.application_action(seller, profile.pk, {"version": case.version, "action": "submit"})
                self.counts["updated"]["profile"] = self.counts["updated"].get("profile", 0) + 1
            if not profiles.approved(profile):
                self.pending_action("verification", "Approve seller business profile (native admin)", case.pk)
            result[spec["key"]] = (seller, profile)
        return result

    # -- stores, products, stock, terms --------------------------------------
    def seed_commerce_catalog(self, sellers):
        for spec in SELLERS:
            seller, profile = sellers[spec["key"]]
            if not profiles.approved(profile):
                continue
            store = Store.objects.filter(profile=profile).first()
            if store is None or store.published_id is None:
                if store is None:
                    image, store = stores.upload(seller, profile.pk, 0, image_file())
                    logo = str(image.pk)
                else:
                    logo = None
                if not store.revisions.filter(state="submitted").exists() and store.published_id is None:
                    body = {
                        "source_locale": "fa-AF",
                        "editions": {
                            "fa-AF": {"description": "فروشگاه آزمایشی برای بازبینی دستی — Synthetic manual-review", "logo_alt": "نشان آزمایشی", "banner_alt": ""},
                            "en": {"description": "Synthetic manual-review store", "logo_alt": "Synthetic logo", "banner_alt": ""},
                        },
                        "country": "Afghanistan", "city": spec["city"], "logo": logo, "banner": None,
                    }
                    store = stores.save(seller, profile.pk, {"version": store.version, "body": body})
                    revision = store.revisions.order_by("-number").first()
                    if revision.state == "draft":
                        store = stores.seller_action(seller, profile.pk, {"version": store.version, "revision": revision.pk, "action": "submit"})
                    self.bump("store", spec["key"], True)
                revision = store.revisions.filter(state="submitted").first()
                if revision is not None:
                    self.pending_action("marketplace", "Approve store revision (native admin)", revision.pk)
            else:
                self.bump("store", spec["key"], False)
            self.manifest["stores"][spec["key"]] = str(profile.pk)
            terms = orders.terms(profile)
            if not terms.get("enabled"):
                orders.set_terms(seller, profile.pk, {
                    "version": terms.get("version", 0), "enabled": True,
                    "destinations": [{"country": "AF", "all_cities": True, "cities": []}],
                    "methods": ["advance", "cod"], "reason": REASON + "checkout terms",
                })
        for sku, seller_key, category, title, unit, retail in PRODUCTS:
            seller, profile = sellers[seller_key]
            if not profiles.approved(profile):
                continue
            variant = Variant.objects.filter(sku=sku).first()
            if variant is not None:
                self.bump("product", sku, False)
                self.manifest["products"][sku] = str(variant.product_id)
                if variant.product.published_id is None:
                    self.pending_action("catalogue", "Publish product (native admin)", variant.product_id)
                continue
            created = catalogue.create(seller, {"seller": profile.pk, "currency": "AFN", "pricing_mode": "fixed"})
            product = Product.objects.get(pk=created["id"])
            image = product_upload(seller, product.pk, product.version, image_file())
            product.refresh_from_db()
            body = {
                "locale": "fa-AF", "title": title, "description": "محتوای آزمایشی برای بازبینی دستی. Synthetic manual-review content.",
                "brand": "", "category": category, "attributes": {},
                "images": [{"id": image["id"], "alt": "تصویر آزمایشی", "variant": None}],
                "variants": [{"sku": sku, "unit": unit, "increment": "1", "minimum": "1", "contents": "", "attributes": {}, "active": True, "retail": retail, "wholesale": None}],
            }
            saved = catalogue.save(seller, product.pk, {"version": product.version, "body": body})
            product.refresh_from_db()
            catalogue.transition(seller, product.pk, {"version": product.version, "revision": saved["revision"], "action": "submit", "reason": REASON + "publication request"})
            self.manifest["products"][sku] = str(product.pk)
            self.bump("product", sku, True)
            self.pending_action("catalogue", "Publish product (native admin)", product.pk)
            variant = Variant.objects.get(product=product)
            position = Position.objects.filter(pk=variant.pk).first()
            if position is None:
                inventory.configure(seller, profile.pk, variant.pk, {"token": str(uuid.uuid4()), "version": 0, "tracking": "plain", "expiry_required": False, "threshold": "1.000", "reason": REASON + "stock setup"})
                inventory.manual(seller, profile.pk, variant.pk, {"token": str(uuid.uuid4()), "version": Position.objects.get(pk=variant.pk).version, "quantity": "200.000", "reason": REASON + "stock receipt"})

    # -- orders --------------------------------------------------------------
    def _order(self, scenario, buyer, sku, quantity, method):
        existing = self.manifest["orders"].get(scenario)
        if existing and SellerOrder.objects.filter(pk=existing).exists():
            self.bump("order", scenario, False)
            return SellerOrder.objects.get(pk=existing)
        variant = Variant.objects.select_related("product").get(sku=sku)
        if variant.product.published_id is None:
            return None
        current = cart.buyer(buyer)
        cart.mutate(buyer.request, buyer, {"command_id": uuid.uuid4(), "version": current.version if current else 0, "action": "set", "variant": variant.pk, "tier": "retail", "quantity": quantity})
        current = cart.buyer(buyer)
        lines = list(current.lines.filter(variant=variant, tier="retail").values_list("pk", flat=True))
        result = orders.submit(buyer, {"command_id": uuid.uuid4(), "version": current.version, "currency": "AFN", "lines": lines, "choices": [{"seller": variant.product.seller_id, "country": "AF", "city": "Kabul", "method": method}], "locale": "fa-AF"})
        outcome = result["outcomes"][0]
        if outcome.get("state") != "accepted" and not outcome.get("order"):
            raise CommandError(f"Checkout for {scenario} did not accept: {outcome.get('code', outcome)}")
        order = SellerOrder.objects.get(pk=outcome["order"])
        self.manifest["orders"][scenario] = str(order.pk)
        self.bump("order", scenario, True)
        return order

    def _receipt(self, seller, order):
        if goods.confirmed(order) >= order.goods_total:
            return
        goods.mutate(seller, order.pk, "receipt", {"command_id": uuid.uuid4(), "version": finance_version(order), "amount": format(order.goods_total, ".2f"), "currency": order.currency, "paid_at": timezone.now() - timedelta(minutes=1), "description": REASON + "actual goods funds"})

    def _delivery_to_charge(self, buyer, seller, order, sku):
        if delivery.Delivery.objects.filter(order=order).exists():
            return
        state = delivery.State.objects.filter(order=order).first()
        if not delivery.Recipient.objects.filter(order=order).exists():
            fulfilment.mutate(buyer, order.pk, "recipient", {"command_id": uuid.uuid4(), "version": state.version if state else 0, "goods_version": finance_version(order), "recipient_revision": 0, "name": "Synthetic delivery recipient", "phone": "000-TEST-ONLY", "address": "Synthetic private address — never real contact data", "instructions": "Synthetic manual handover", "reason": REASON + "recipient"})
        arrangement = delivery.Arrangement.objects.filter(order=order).first()
        if arrangement is None:
            result = fulfilment.mutate(seller, order.pk, "arrange", {"command_id": uuid.uuid4(), "version": delivery.State.objects.get(order=order).version, "goods_version": finance_version(order), "provider": "Synthetic manual delivery provider", "arranger": "seller", "self_delivery": False, "instructions": "Manual whole-order delivery"})
            arrangement = delivery.Arrangement.objects.get(pk=result["arrangement"])
        charge_case = delivery.ReviewCase.objects.filter(order=order, kind="charge").first()
        if charge_case is None:
            variant = Variant.objects.get(sku=sku)
            preparation = delivery.Preparation.objects.filter(order=order).first()
            if preparation is None:
                result = fulfilment.mutate(seller, order.pk, "prepare", {"command_id": uuid.uuid4(), "version": delivery.State.objects.get(order=order).version, "goods_version": finance_version(order), "recipient": delivery.Recipient.objects.filter(order=order).order_by("-revision").first().pk, "arrangement": arrangement.pk, "reason": REASON + "whole preparation", "lines": [{"variant": variant.pk, "batch": None, "quantity": "1.000"}]})
                preparation = delivery.Preparation.objects.get(pk=result["preparation"])
            fulfilment.mutate(seller, order.pk, "charge", {"command_id": uuid.uuid4(), "version": delivery.State.objects.get(order=order).version, "goods_version": finance_version(order), "provider": arrangement.provider_id, "amount": "0.00", "currency": "AFN", "reason": REASON + "zero delivery cost"})
            charge_case = delivery.ReviewCase.objects.filter(order=order, kind="charge").first()
        if charge_case and charge_case.state != "approved":
            self.pending_action("fulfilment", "Approve zero delivery-charge case (native admin)", charge_case.pk)

    def _dispatch_deliver(self, buyer, seller, order, sku):
        charge_case = delivery.ReviewCase.objects.filter(order=order, kind="charge").first()
        if not charge_case or charge_case.state != "approved":
            return False
        if not delivery.Delivery.objects.filter(order=order).exists():
            preparation = delivery.Preparation.objects.filter(order=order).order_by("-event__version").first()
            packet = transitions.packet(seller, order, delivery.State.objects.get(order=order), {"preparation": preparation.pk, "reason": REASON + "whole dispatch"})[0]
            fulfilment.mutate(seller, order.pk, "dispatch", {"command_id": uuid.uuid4(), **packet})
        if not delivery.Delivery.objects.filter(order=order).exists():
            fulfilment.mutate(buyer, order.pk, "deliver", {"command_id": uuid.uuid4(), "version": delivery.State.objects.get(order=order).version, "goods_version": finance_version(order), "occurred_at": timezone.now(), "reason": REASON + "actual whole delivery"})
        return delivery.Delivery.objects.filter(order=order).exists()

    def seed_scenarios(self, sellers):
        buyer1 = actor(User.objects.get(pk=self.manifest["users"]["buyer1"]), "buyer")
        buyer2 = actor(User.objects.get(pk=self.manifest["users"]["buyer2"]), "buyer")
        seller1, profile1 = sellers["seller1"]
        seller2, profile2 = sellers["seller2"]
        published = all(Variant.objects.filter(sku=sku).select_related("product").first() and Variant.objects.get(sku=sku).product.published_id for sku, *_ in PRODUCTS)
        if not published:
            return
        # O1: advance cancellation + refund chain.
        order = self._order("cancellation", buyer1, "SYN-REV-MOTO", "2.000", "advance")
        if order:
            self._receipt(seller1, order)
            if not CancellationRequest.objects.filter(order=order).exists():
                cancellations.mutate(buyer1, order.pk, "request", {"command_id": uuid.uuid4(), "version": aftercare_version(order), "reason": REASON + "buyer cancellation"})
                self.bump("cancellation", "O1", True)
            request = CancellationRequest.objects.filter(order=order).order_by("-created_at").first()
            if request and request.state == "pending":
                self.pending_action("aftercare", "Decide cancellation request (native admin)", request.pk)
            due = RefundDue.objects.filter(order=order).first()
            if due and not due.reports.exists():
                refunds.mutate(seller1, order.pk, "report", {"command_id": uuid.uuid4(), "version": finance_version(order), "due": str(due.pk), "amount": format(due.amount, ".2f"), "sent_at": timezone.now() - timedelta(minutes=1), "reference": "SYNTHETIC-REVIEW-REFUND", "description": REASON + "seller-issued goods refund"})
                self.bump("refund_report", "O1", True)
            if due and due.reports.exists():
                self.pending_action("payments", "Confirm goods refund independently (native admin)", due.pk)
        # O2: advance amendment.
        order = self._order("amendment", buyer1, "SYN-REV-DRIED", "3.000", "advance")
        if order:
            if not Amendment.objects.filter(order=order).exists():
                line = OrderLine.objects.filter(order=order).order_by("pk").first()
                amendments.mutate(seller1, order.pk, "propose", {"command_id": uuid.uuid4(), "version": aftercare_version(order), "lines": [{"line": str(line.pk), "quantity": "2.000", "unit_price": format(line.unit_price, ".2f")}], "reason": REASON + "seller quantity decrease"})
                self.bump("amendment", "O2", True)
            amendment = Amendment.objects.filter(order=order).order_by("-created_at").first()
            if amendment and amendment.state == "pending":
                self.pending_action("aftercare", "Decide amendment proposal (native admin)", amendment.pk)
        # O3: delivered dispute.
        order = self._order("dispute", buyer1, "SYN-REV-FOOD", "1.000", "cod")
        if order:
            self._delivery_to_charge(buyer1, seller1, order, "SYN-REV-FOOD")
            if self._dispatch_deliver(buyer1, seller1, order, "SYN-REV-FOOD"):
                if not DisputeRequest.objects.filter(order=order).exists():
                    evidence = payment_media.upload(buyer1, order.pk, uuid.uuid4(), image_file())
                    result = disputes.mutate(buyer1, order.pk, "dispute_open", {"command_id": uuid.uuid4(), "version": aftercare_version(order), "reason": REASON + "post-delivery dispute", "evidence": [evidence["id"]]})
                    dispute = DisputeRequest.objects.get(pk=result["dispute"])
                    disputes.mutate(seller1, order.pk, "dispute_respond", {"command_id": uuid.uuid4(), "version": aftercare_version(order), "dispute": str(dispute.pk), "text": "پاسخ آزمایشی • Synthetic manual-review seller response"})
                    self.bump("dispute", "O3", True)
                dispute = DisputeRequest.objects.filter(order=order).first()
                if dispute and dispute.state == "pending":
                    self.pending_action("disputes", "Decide dispute (native admin)", dispute.pk)
        # O4: completed review.
        order = self._order("review", buyer2, "SYN-REV-FOREIGN", "1.000", "cod")
        if order:
            self._delivery_to_charge(buyer2, seller2, order, "SYN-REV-FOREIGN")
            if self._dispatch_deliver(buyer2, seller2, order, "SYN-REV-FOREIGN"):
                self._receipt(seller2, order)
                if not Review.objects.filter(order=order).exists():
                    reviews.mutate(buyer2, order.pk, "review_submit", {"command_id": uuid.uuid4(), "version": aftercare_version(order), "rating": 4, "language": "fa-AF", "text": "نظر آزمایشی • Synthetic manual-review buyer review"})
                    self.bump("review", "O4", True)
                review = Review.objects.filter(order=order).first()
                if review and review.state == "pending":
                    self.pending_action("reviews", "Moderate buyer review (native admin)", review.pk)
        # O5: accepted order, used as an order-report target.
        order5 = self._order("accepted", buyer1, "SYN-REV-COSM", "1.000", "cod")
        # Reports: product / store / order.
        targets = [("product", Variant.objects.get(sku="SYN-REV-HOME").product_id), ("store", Store.objects.get(profile=profile1).pk)]
        if order5:
            targets.append(("order", order5.pk))
        for kind, target in targets:
            if kind in self.manifest["reports"] and Report.objects.filter(pk=self.manifest["reports"][kind]).exists():
                self.bump("report", kind, False)
                continue
            result = messaging.report_target(buyer1, kind, target, {"command_id": uuid.uuid4(), "category": "other", "reason": REASON + kind + " report"})
            self.manifest["reports"][kind] = str(result["id"])
            self.bump("report", kind, True)
            self.pending_action("messaging", "Resolve report case (native admin)", result["id"])


class Command(BaseCommand):
    help = "Seed bounded synthetic manual-review data into the exact owned local preview; leaves staff approvals to the owner."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Verify target and report current state without writing.")

    def handle(self, **options):
        seed = Seed(self)
        seed.verify_target()
        if options["dry_run"]:
            self.stdout.write("Target verified: owned local preview. No writes performed.")
            return
        # No outer transaction: registration commits in the live web process and must be
        # visible to subsequent reads, and orders.submit commits per-seller outcomes itself.
        # Each domain service is independently atomic; the manifest makes reruns resumable.
        seed.seed_categories()
        for spec in BUYERS:
            seed.ensure_user(spec, "buyer", "individual")
        for spec in SELLERS:
            seed.ensure_user(spec, "seller", "individual")
        sellers = seed.seed_profiles()
        seed.seed_commerce_catalog(sellers)
        seed.seed_scenarios(sellers)
        seed.save()
        self.stdout.write(json.dumps({
            "counts": seed.counts,
            "pending_owner_actions": seed.pending,
            "pdf_categories": seed.manifest["categories"],
            "note": "Rerun after approving pending actions in the native admin to advance scenarios. No staff decision was automated.",
        }, indent=2, ensure_ascii=False))