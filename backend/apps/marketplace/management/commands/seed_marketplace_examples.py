"""Phase 8 acceptance data only in the runner's proven disposable database."""

import io
import json
import sys
import uuid
from types import SimpleNamespace
from unittest.mock import patch
from django.conf import settings
from django.contrib.auth.models import Group, Permission
from django.core.management import BaseCommand, CommandError, call_command
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connection, transaction
from PIL import Image
from config.testing import assert_owned_database
from apps.accounts.models import User, Account
from apps.organizations.access import Actor
from apps.organizations.models import BusinessProfile, Membership, BUNDLES
from apps.verification.models import ReviewCase
from apps.catalogue import services as catalogue
from apps.catalogue.media import upload
from apps.catalogue.models import Product, Variant
from apps.inventory import services as inventory
from apps.marketplace import services


def image_file():
    data = io.BytesIO()
    Image.new("RGB", (640, 480), (30, 100, 180)).save(data, format="PNG")
    return SimpleUploadedFile("synthetic.png", data.getvalue(), content_type="image/png")


class Command(BaseCommand):
    def add_arguments(self, parser):
        parser.add_argument("--stdin", action="store_true", required=True)

    @transaction.atomic
    def handle(self, **options):
        assert_owned_database(connection)
        if settings.PRODUCTION or not settings.DEBUG:
            raise CommandError("Only the disposable browser runtime is permitted.")
        password = json.load(sys.stdin)["password"]
        if User.objects.filter(email="phase08-seller@example.test").exists():
            return
        call_command("setup_marketplace_groups", verbosity=0)
        reviewer_account = Account.objects.get(context="staff", user__email="phase06-full@example.test")
        group = Group.objects.create(name="Synthetic Phase 8 store review")
        group.permissions.set(Permission.objects.filter(content_type__app_label="marketplace"))
        reviewer_account.user.groups.add(group)
        reviewer = Actor(SimpleNamespace(user=reviewer_account.user, account=reviewer_account), "staff")
        # Only these run-owned legacy fixtures receive explicit approved identity snapshots.
        for case in ReviewCase.objects.filter(status="approved", profile__account__user__email__endswith="@example.test"):
            ReviewCase.objects.filter(pk=case.pk).update(snapshot={**case.snapshot, "display_name": case.profile.display_name})
        profiles = {}
        with patch("apps.organizations.access.get_grant", side_effect=lambda request, context: request.account):
            for name, kind in [("seller", "individual"), ("company", "company"), ("empty", "individual"), ("pending", "individual"), ("suspended", "individual"), ("buyer", "business")]:
                user = User.objects.create_user(f"phase08-{name}@example.test", password, display_name="Synthetic Phase 8 " + name, email_verified=True)
                account = Account.objects.create(user=user, context="buyer" if name == "buyer" else "seller", status="suspended" if name == "suspended" else "active")
                profile = BusinessProfile.objects.create(account=account, kind=kind, display_name="خصوصی PRIVATE-MUTABLE " + name, contact_phone="PRIVATE-PHONE-93700000000", location="PRIVATE-PRECISE-ADDRESS")
                ReviewCase.objects.create(profile=profile, snapshot={"display_name": "فروشگاه آزمایشی — متجر تجريبي — Synthetic " + name, "contact_phone": "PRIVATE-SNAPSHOT-PHONE"}, status="draft" if name == "pending" else "approved")
                profiles[name] = profile
                if kind == "company":
                    Membership.objects.create(company=profile, account=account, is_owner=True, bundles=list(BUNDLES))
                    for role, bundles, active in [("cataloguer", ["catalogue"], True), ("fulfilment", ["fulfilment"], True), ("revoked", [], False)]:
                        member_user = User.objects.create_user(f"phase08-{role}@example.test", password, email_verified=True)
                        member = Account.objects.create(user=member_user, context="seller")
                        Membership.objects.create(company=profile, account=member, bundles=bundles, active=active)
                if name not in {"seller", "company", "empty"}:
                    continue
                actor = Actor(SimpleNamespace(user=user, account=account), "seller")
                if name != "empty":
                    image, store = services.upload(actor, profile.pk, 0, image_file())
                    store_body = {"source_locale": "fa-AF", "editions": {"fa-AF": {"description": "توضیحات آزمایشی تأییدشده برای فروشگاه", "logo_alt": "نشان آزمایشی", "banner_alt": ""}, "en": {"description": "Approved synthetic public store description", "logo_alt": "Synthetic store logo", "banner_alt": ""}}, "country": "Afghanistan", "city": "Kabul" if name == "seller" else "Herat", "logo": str(image.pk), "banner": None}
                    store = services.save(actor, profile.pk, {"version": store.version, "body": store_body})
                    revision = store.revisions.first()
                    store = services.seller_action(actor, profile.pk, {"version": store.version, "revision": revision.pk, "action": "submit"})
                    store = services.review(reviewer, revision.pk, {"version": store.version, "action": "assign", "assigned_to": reviewer_account.pk})
                    services.review(reviewer, revision.pk, {"version": store.version, "action": "approve"})
                for index in range(30 if name == "seller" else 15 if name == "company" else 0):
                    category = ("food", "clothing", "electronics", "cosmetics")[index % 4]
                    created = catalogue.create(actor, {"seller": profile.pk, "currency": "USD" if index % 3 == 0 else "AFN", "pricing_mode": "negotiable" if index % 5 == 0 else "fixed"})
                    product = Product.objects.get(pk=created["id"])
                    image = upload(actor, product.pk, product.version, image_file())
                    product.refresh_from_db()
                    body = {"locale": "fa-AF", "title": f"محصول آزمایشی {name} {index:02d} — Synthetic marketplace", "description": "محتوای آزمایشی تأییدشده. Synthetic approved public content.", "brand": "", "category": category, "attributes": {}, "images": [{"id": image["id"], "alt": "تصویر آزمایشی تأییدشده", "variant": None}], "variants": [{"sku": f"P8-{name}-{index:02d}", "unit": "piece", "increment": "1", "minimum": "5", "contents": "", "attributes": {}, "active": True, "retail": "123456789.12" if index == 0 else f"{index + 10}.50", "wholesale": None if index == 1 else f"{index + 8}.00"}]}
                    saved = catalogue.save(actor, product.pk, {"version": product.version, "body": body})
                    for action in ("submit", "publish"):
                        product.refresh_from_db()
                        catalogue.transition(actor if action == "submit" else reviewer, product.pk, {"version": product.version, "revision": saved["revision"], "action": action, "reason": "Synthetic isolated approval"})
                    variant = Variant.objects.get(product=product)
                    if index % 3 != 2:
                        inventory.configure(actor, profile.pk, variant.pk, {"token": str(uuid.uuid4()), "version": 0, "tracking": "plain", "expiry_required": False, "threshold": "1", "reason": "Synthetic setup"})
                        if index % 3 == 0:
                            inventory.manual(actor, profile.pk, variant.pk, {"token": str(uuid.uuid4()), "version": 1, "quantity": "10", "reason": "Synthetic receipt"})
        self.stdout.write("Run-owned Phase 8 fixtures: 45 published products, approved individual/company/empty stores and private ineligible profiles.")
