"""Phase 9 synthetic acceptance fixtures; refuses all non-owned databases."""

import json
import sys
import uuid
from types import SimpleNamespace
from django.conf import settings
from django.contrib.auth.models import Group
from django.core.management import BaseCommand, CommandError, call_command
from django.contrib.sessions.backends.db import SessionStore
from django.db import connection, transaction
from django.test import override_settings
from config.testing import assert_owned_database
from apps.accounts.models import User, Account
from apps.accounts.services import establish
from apps.organizations.access import Actor
from apps.organizations.models import BusinessProfile, Membership, BUNDLES
from apps.verification.models import ReviewCase
from apps.catalogue.models import Product
from apps.catalogue import services as catalogue
from apps.catalogue.media import upload
from apps.marketplace.management.commands.seed_marketplace_examples import image_file
from apps.messaging import services, cases, media


def actor(user, context):
    request = SimpleNamespace(
        user=user, session=SessionStore(), META={"REMOTE_ADDR": "127.0.0.1"}, request_id=uuid.uuid4()
    )
    establish(request, user, context, mfa=context in {"owner", "staff"}, admin_entry=context in {"owner", "staff"})
    return Actor(request, context)


class Command(BaseCommand):
    def add_arguments(self, parser):
        parser.add_argument("--stdin", action="store_true", required=True)

    @transaction.atomic
    def handle(self, **options):
        assert_owned_database(connection)
        if settings.PRODUCTION or not settings.DEBUG:
            raise CommandError("Only run-owned synthetic browser fixtures are permitted.")
        password = json.load(sys.stdin)["password"]
        if User.objects.filter(email="phase09-buyer@example.test").exists():
            return
        call_command("setup_messaging_groups", verbosity=0)
        identities = {}
        for name, context in [
            ("buyer", "buyer"),
            ("other-buyer", "buyer"),
            ("member", "seller"),
            ("multi-member", "seller"),
            ("fulfilment", "seller"),
            ("revoked", "seller"),
            ("company2", "seller"),
            ("support", "staff"),
            ("unassigned", "staff"),
            ("ungranted", "staff"),
            ("root", "owner"),
            ("dual", "buyer"),
        ]:
            user = User.objects.create_user(
                f"phase09-{name}@example.test",
                password,
                display_name="آزمایشی • تجريبي • Synthetic " + name,
                email_verified=True,
                is_staff=context in {"staff", "owner"},
                is_superuser=context == "owner",
            )
            if context != "owner":
                Account.objects.create(user=user, context=context)
            if name in {"support", "unassigned"}:
                user.groups.add(Group.objects.get(name="Rezayi: Message case reviewer"))
            if name == "dual":
                Account.objects.create(user=user, context="seller")
            identities[name] = user
        company = BusinessProfile.objects.get(account__user__email="phase08-company@example.test", kind="company")
        for name, bundles, active in [
            ("member", ["messaging"], True),
            ("multi-member", ["messaging"], True),
            ("fulfilment", ["fulfilment"], True),
            ("revoked", ["messaging"], False),
        ]:
            Membership.objects.create(
                company=company, account=identities[name].accounts.get(context="seller"), bundles=bundles, active=active
            )
        second = BusinessProfile.objects.create(
            account=identities["company2"].accounts.get(),
            kind="company",
            display_name="Synthetic independent company B",
            contact_phone="NEVER-PUBLIC-CONTACT",
        )
        Membership.objects.create(company=second, account=second.account, is_owner=True, bundles=list(BUNDLES))
        Membership.objects.create(
            company=second, account=identities["multi-member"].accounts.get(), bundles=["messaging"]
        )
        ReviewCase.objects.create(
            profile=second, status="approved", snapshot={"display_name": "فروشگاه مستقل • Independent company B"}
        )
        # Existing catalogue services remain authoritative; real native grants,
        # not a production authorization bypass, publish only synthetic data.
        with override_settings(OWNER_MFA_REQUIRED=False):
            publisher = actor(identities["root"], "owner")
            seller = actor(identities["company2"], "seller")
            created = catalogue.create(seller, {"seller": second.pk, "currency": "AFN", "pricing_mode": "fixed"})
            product = Product.objects.get(pk=created["id"])
            uploaded = upload(seller, product.pk, product.version, image_file())
            product.refresh_from_db()
            original = (
                Product.objects.filter(seller=company, published__isnull=False).select_related("published").first()
            )
            body = json.loads(json.dumps(original.published.body))
            body["images"] = [{"id": uploaded["id"], "alt": "Synthetic company B", "variant": None}]
            body["variants"] = [
                {
                    "sku": "P09-B",
                    "unit": "piece",
                    "increment": "1",
                    "minimum": "1",
                    "contents": "",
                    "attributes": {},
                    "active": True,
                    "retail": "12.50",
                    "wholesale": "10.00",
                }
            ]
            saved = catalogue.save(
                seller,
                product.pk,
                {
                    "version": product.version,
                    "body": {
                        key: body[key]
                        for key in (
                            "locale",
                            "title",
                            "description",
                            "brand",
                            "category",
                            "attributes",
                            "images",
                            "variants",
                        )
                    },
                },
            )
            product.refresh_from_db()
            catalogue.transition(
                seller,
                product.pk,
                {
                    "version": product.version,
                    "revision": saved["revision"],
                    "action": "submit",
                    "reason": "Synthetic fixture",
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
                    "reason": "Synthetic independent fixture approval",
                },
            )
        buyer = actor(identities["buyer"], "buyer")
        other = actor(identities["other-buyer"], "buyer")
        products = Product.objects.filter(
            seller__account__user__email="phase08-seller@example.test", published__isnull=False
        ).order_by("created_at")[:24]
        for index, p in enumerate(products):
            services.create_enquiry(
                buyer,
                {
                    "command_id": uuid.uuid4(),
                    "product": p.pk,
                    "body": f"پیام آزمایشی {index} • رسالة تجريبية • Synthetic private enquiry",
                    "images": [],
                    "locale": "fa-AF",
                },
            )
        main = services.create_enquiry(
            buyer,
            {
                "command_id": uuid.uuid4(),
                "product": original.pk,
                "body": "دری پښتو العربية English — I choose to share +93700000000. <script>plain text</script>",
                "images": [],
                "locale": "fa-AF",
            },
        )
        services.create_enquiry(
            other,
            {
                "command_id": uuid.uuid4(),
                "product": original.pk,
                "body": "Private conversation of an unrelated buyer",
                "images": [],
                "locale": "en",
            },
        )
        services.create_enquiry(
            buyer,
            {
                "command_id": uuid.uuid4(),
                "product": product.pk,
                "body": "Independent company B thread",
                "images": [],
                "locale": "en",
            },
        )
        member = actor(identities["member"], "seller")
        pk = main["conversation"]
        for index in range(55):
            services.send(
                member,
                pk,
                {
                    "command_id": uuid.uuid4(),
                    "body": f"پاسخ آزمایشی • ځواب • رد تجريبي • Synthetic reply {index:02d} — "
                    + ("Long mixed text ABC-123 / کابل. " * 20 if index == 54 else ""),
                    "images": [],
                },
            )
        image = media.upload(member, pk, uuid.uuid4(), image_file())
        services.send(
            member,
            pk,
            {"command_id": uuid.uuid4(), "body": "Synthetic protected image", "images": [uuid.UUID(image["id"])]},
        )
        result = services.report(
            buyer,
            uuid.UUID(main["message"]),
            {
                "command_id": uuid.uuid4(),
                "category": "privacy",
                "reason": "Synthetic case for isolated staff privacy verification",
            },
        )
        with override_settings(OWNER_MFA_REQUIRED=False):
            cases.transition(
                actor(identities["root"], "owner"),
                result["id"],
                version=1,
                action="assign",
                reason="Synthetic independent case assignment",
                assigned_to=identities["support"].accounts.get().pk,
            )
        self.stdout.write(
            "Run-owned communication fixtures prepared: paginated threads/history, messaging-only companies, images and assigned/unassigned cases. No real accounts/providers used."
        )
