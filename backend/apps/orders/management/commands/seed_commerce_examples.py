"""Run-owned Phase 10 examples; never accepts an application database."""

import json
import sys
import uuid
from copy import deepcopy
from django.conf import settings
from django.core.management import BaseCommand, CommandError, call_command
from django.db import connection
from django.test import override_settings
from config.testing import assert_owned_database
from apps.accounts.models import User, Account
from apps.organizations.models import BusinessProfile, Membership, BUNDLES
from apps.verification.models import ReviewCase
from apps.catalogue.models import Product, Translation
from apps.catalogue import services as catalogue, translations
from apps.catalogue.media import upload
from apps.inventory import services as inventory
from apps.inventory.models import Position
from apps.cart import services as cart
from apps.orders import services as orders
from apps.messaging.management.commands.seed_messaging_examples import actor
from apps.marketplace.management.commands.seed_marketplace_examples import image_file


class Command(BaseCommand):
    def add_arguments(self, parser):
        parser.add_argument("--stdin", action="store_true", required=True)

    def handle(self, **options):
        assert_owned_database(connection)
        if settings.PRODUCTION or not settings.DEBUG:
            raise CommandError("Only native disposable browser fixtures are permitted.")
        password = json.load(sys.stdin)["password"]
        if User.objects.filter(email="phase10-buyer@example.test").exists():
            return
        call_command("setup_order_groups", verbosity=0)
        users = {}
        for name, context in [
            ("buyer", "buyer"),
            ("other", "buyer"),
            ("owner-a", "seller"),
            ("owner-b", "seller"),
            ("operations", "seller"),
            ("finance", "seller"),
        ]:
            user = User.objects.create_user(
                "phase10-" + name + "@example.test",
                password,
                display_name="آزمایشی • Synthetic " + name,
                email_verified=True,
            )
            Account.objects.create(user=user, context=context)
            users[name] = user
        root = User.objects.get(email="phase09-root@example.test")
        original = (
            Product.objects.filter(published__isnull=False, pricing_mode="fixed").select_related("published").first()
        )
        with override_settings(OWNER_MFA_REQUIRED=False, CATALOGUE_TRANSLATION_ENABLED=False):
            publisher = actor(root, "owner")
            for letter, count in [("a", 40), ("b", 1)]:
                owner = actor(users["owner-" + letter], "seller")
                profile = BusinessProfile.objects.create(
                    account=owner.account,
                    kind="company",
                    display_name="Synthetic commerce " + letter.upper(),
                    contact_phone="NEVER-PUBLIC-CONTACT",
                )
                Membership.objects.create(company=profile, account=owner.account, is_owner=True, bundles=list(BUNDLES))
                Membership.objects.create(
                    company=profile, account=users["operations"].accounts.get(), bundles=["orders_negotiation"]
                )
                if letter == "a":
                    Membership.objects.create(
                        company=profile, account=users["finance"].accounts.get(), bundles=["payments_refunds"]
                    )
                ReviewCase.objects.create(
                    profile=profile,
                    status="approved",
                    snapshot={"display_name": "فروشگاه آزمایشی • Synthetic commerce " + letter.upper()},
                )
                created = catalogue.create(owner, {"seller": profile.pk, "currency": "AFN", "pricing_mode": "fixed"})
                product = Product.objects.get(pk=created["id"])
                image = upload(owner, product.pk, product.version, image_file())
                product.refresh_from_db()
                body = deepcopy(original.published.body)
                body = {
                    k: body[k]
                    for k in ["locale", "title", "description", "brand", "category", "attributes", "images", "variants"]
                }
                body["category"] = "food"
                body["attributes"] = {"grade": "A"}
                body["title"] = (
                    "محصول آزمایشی با متن طولانی برای بررسی صورتحساب — Synthetic long mixed product ABC 123 " * 2
                )
                body["images"] = [{"id": image["id"], "alt": "Synthetic commerce image", "variant": None}]
                body["variants"] = [
                    {
                        "sku": f"P10-{letter.upper()}-{i:02d}-ABC123",
                        "unit": "piece",
                        "increment": "1.000",
                        "minimum": "5.000",
                        "contents": "",
                        "attributes": {"pack_size": str(i)},
                        "active": True,
                        "retail": "12.50",
                        "wholesale": "10.00",
                    }
                    for i in range(count)
                ]
                saved = catalogue.save(owner, product.pk, {"version": product.version, "body": body})
                product.refresh_from_db()
                catalogue.transition(
                    owner,
                    product.pk,
                    {
                        "version": product.version,
                        "revision": saved["revision"],
                        "action": "submit",
                        "reason": "Synthetic commerce fixture",
                    },
                )
                product.refresh_from_db()
                catalogue.transition(
                    publisher,
                    product.pk,
                    {
                        "version": product.version,
                        "revision": saved["revision"],
                        "action": "publish",
                        "reason": "Synthetic commerce fixture",
                    },
                )
                for locale, title in [
                    (
                        "en",
                        "Synthetic long goods description with mixed identifiers ABC 123 and stable quantities " * 2,
                    ),
                    ("ps", "د ازموینې اوږد محصول د بل د کتنې لپاره ABC 123 " * 4),
                    ("ar", "منتج تجريبي طويل لفحص الفاتورة والأرقام ABC 123 " * 4),
                ]:
                    tr, _created = Translation.objects.get_or_create(revision_id=saved["revision"], locale=locale)
                    translations.edit(
                        publisher,
                        product.pk,
                        saved["revision"],
                        locale,
                        {
                            "version": tr.version,
                            "action": "save",
                            "title": title[:200],
                            "description": "Synthetic",
                            "image_alts": {str(image["id"]): "Synthetic commerce image"},
                        },
                    )
                    tr.refresh_from_db()
                    translations.edit(
                        publisher,
                        product.pk,
                        saved["revision"],
                        locale,
                        {"version": tr.version, "action": "approve", "reason": "Synthetic translation approval"},
                    )
                orders.set_terms(
                    owner,
                    profile.pk,
                    {
                        "version": 0,
                        "enabled": True,
                        "destinations": [{"country": "AF", "all_cities": True, "cities": []}],
                        "methods": ["advance", "cod"],
                        "reason": "Synthetic explicit terms",
                    },
                )
                for variant in product.variants.all():
                    inventory.configure(
                        owner,
                        profile.pk,
                        variant.pk,
                        {
                            "token": str(uuid.uuid4()),
                            "version": 0,
                            "tracking": "plain",
                            "expiry_required": False,
                            "threshold": "1.000",
                            "reason": "Synthetic configured stock",
                        },
                    )
                    inventory.manual(
                        owner,
                        profile.pk,
                        variant.pk,
                        {
                            "token": str(uuid.uuid4()),
                            "version": Position.objects.get(pk=variant.pk).version,
                            "quantity": "200.000",
                            "reason": "Synthetic received stock",
                        },
                    )
                if letter == "a":
                    buyer = actor(users["buyer"], "buyer")
                    for variant in product.variants.all():
                        existing = cart.buyer(buyer)
                        cart.mutate(
                            buyer.request,
                            buyer,
                            {
                                "command_id": uuid.uuid4(),
                                "version": existing.version if existing else 0,
                                "action": "set",
                                "variant": variant.pk,
                                "tier": "retail",
                                "quantity": "1.000",
                            },
                        )
                    current = cart.buyer(buyer)
                    orders.submit(
                        buyer,
                        {
                            "command_id": uuid.uuid4(),
                            "version": current.version,
                            "currency": "AFN",
                            "lines": list(current.lines.values_list("pk", flat=True)),
                            "choices": [{"seller": profile.pk, "country": "AF", "city": "Kabul", "method": "advance"}],
                            "locale": "en",
                        },
                    )
        self.stdout.write(
            "Commerce synthetic seller terms, stock, role capabilities and retained multi-page invoice prepared."
        )
