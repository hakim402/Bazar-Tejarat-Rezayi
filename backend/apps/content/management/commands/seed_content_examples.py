"""Synthetic editorial journeys, restricted to an owned disposable database."""

import copy
import json
import sys
from types import SimpleNamespace
from unittest.mock import patch
from django.conf import settings
from django.contrib.auth.models import Group
from django.core.management import BaseCommand, CommandError, call_command
from django.db import connection, transaction
from django.utils import timezone
from config.testing import assert_owned_database
from apps.accounts.models import Account, User
from apps.content.models import ContentItem
from apps.content.drafts import draft
from apps.content.services import save, transition


class Command(BaseCommand):
    def add_arguments(self, parser):
        parser.add_argument("--stdin", action="store_true", required=True)

    @transaction.atomic
    def handle(self, **options):
        if settings.PRODUCTION or not settings.DEBUG:
            raise CommandError("Only the disposable browser runtime is permitted.")
        assert_owned_database(connection)
        password = json.load(sys.stdin)["password"]
        if User.objects.filter(email="phase05-editor@example.test").exists():
            self.stdout.write("Existing synthetic content unchanged.")
            return
        call_command("setup_content", verbosity=0)
        for name, permissions in [
            ("editor", ["read_drafts", "edit_content", "manage_settings"]),
            ("reviewer", ["read_drafts", "publish_content", "manage_settings"]),
            (
                "publisher",
                ["read_drafts", "edit_content", "publish_content", "manage_settings"],
            ),
        ]:
            user = User.objects.create_user(
                email=f"phase05-{name}@example.test",
                password=password,
                display_name="Synthetic editorial " + name,
                email_verified=True,
            )
            account = Account.objects.create(user=user, context="staff")
            group = Group.objects.create(name="Synthetic editorial " + name)
            from django.contrib.auth.models import Permission

            group.permissions.set(
                Permission.objects.filter(
                    content_type__app_label="content", codename__in=permissions
                )
            )
            account.permission_groups.add(group)
        owner = User.objects.filter(owner_authority=True).first()
        if owner is None:
            raise CommandError("Prepare identity fixtures first.")
        request = SimpleNamespace(user=owner)
        with patch("apps.content.services.get_grant"):
            for item in ContentItem.objects.order_by("key"):
                for locale in ["fa-AF", "en", "ps", "ar"]:
                    value = copy.deepcopy(draft(item.key))
                    titles = {
                        "en": "Synthetic review: " + item.key,
                        "ps": "د ازموینې محتوا: " + item.key,
                        "ar": "محتوى تجريبي: " + item.key,
                    }
                    if locale != "fa-AF":
                        value["title"] = titles[locale]
                    value["description"] = {
                        "fa-AF": "محتوای آزمایشی برای بررسی؛ معلومات واقعی نیست.",
                        "en": "Synthetic disposable editorial review fixture.",
                        "ps": "د بیاکتنې ازمویښتي منځپانګه؛ ریښتیني معلومات نه دي.",
                        "ar": "محتوى تجريبي للمراجعة؛ ليس معلومات فعلية.",
                    }[locale]
                    if locale != "fa-AF":
                        for index, block in enumerate(value.get("blocks", [])):
                            block["title"] = (
                                {
                                    "en": "Synthetic review section",
                                    "ps": "د ازموینې برخه",
                                    "ar": "قسم المراجعة التجريبي",
                                }[locale]
                                + " "
                                + str(index + 1)
                            )
                            if block.get("text"):
                                block["text"] = {
                                    "en": "Synthetic editorial text for reviewing readable layout and publication behavior. This is disposable test content, not a published business promise.",
                                    "ps": "دا ازمویښتي منځپانګه د لوستلو، بڼې او خپرولو د بیاکتنې لپاره ده. دا ریښتینې سوداګریزه ژمنه نه ده.",
                                    "ar": "هذا نص تجريبي لمراجعة وضوح القراءة والتصميم وسلوك النشر. ليس وعدًا تجاريًا منشورًا.",
                                }[locale]
                            for link in block.get("links", []):
                                link["label"] = {
                                    "en": "How it works",
                                    "ps": "څنګه کار کوي",
                                    "ar": "كيف يعمل",
                                }[locale]
                        for group in value.get("navigation", []):
                            group["label"] = {
                                "en": "Marketplace guide",
                                "ps": "د بازار لارښود",
                                "ar": "دليل السوق",
                            }[locale] + (" · " + group["placement"])
                            for link in group["links"]:
                                link["label"] = {
                                    "en": {
                                        "how-it-works": "How it works",
                                        "wholesale": "Wholesale",
                                        "sell": "Sell with Rezayi",
                                        "about": "About",
                                        "contact": "Contact",
                                        "terms": "Terms",
                                        "privacy": "Privacy",
                                    },
                                    "ps": {
                                        "how-it-works": "څنګه کار کوي",
                                        "wholesale": "عمده پېرود",
                                        "sell": "پلور",
                                        "about": "زموږ په اړه",
                                        "contact": "اړیکه",
                                        "terms": "شرایط",
                                        "privacy": "محرمیت",
                                    },
                                    "ar": {
                                        "how-it-works": "كيف يعمل",
                                        "wholesale": "الجملة",
                                        "sell": "البيع",
                                        "about": "حول السوق",
                                        "contact": "اتصل بنا",
                                        "terms": "الشروط",
                                        "privacy": "الخصوصية",
                                    },
                                }[locale].get(link["target"][1:], link["label"])
                    if item.kind == "support":
                        value["support"] = {
                            "email": "support@example.test",
                            "phone": "+12025550123",
                            "website": "https://example.test",
                        }
                    if item.kind == "legal":
                        value["blocks"] = [
                            {
                                "id": "policy",
                                "type": "text",
                                "title": value["title"],
                                "text": "Synthetic policy for disposable tests only. Not an approved policy.",
                            }
                        ]
                    source = item.revisions.filter(locale="fa-AF").first()
                    result = save(
                        request,
                        "owner",
                        item.key,
                        {
                            "version": item.version,
                            "locale": locale,
                            "source": source.pk
                            if source and locale != "fa-AF"
                            else None,
                            "payload": value,
                        },
                    )
                    item.refresh_from_db()
                    transition(
                        request,
                        "owner",
                        item.key,
                        {
                            "version": item.version,
                            "revision": result["revision"],
                            "action": "submit",
                            "reason": "Synthetic review",
                        },
                    )
                    item.refresh_from_db()
                    transition(
                        request,
                        "owner",
                        item.key,
                        {
                            "version": item.version,
                            "revision": result["revision"],
                            "action": "publish",
                            "reason": "Synthetic publication",
                            "owner_approval": True,
                            "effective_date": timezone.localdate(),
                        },
                    )
                    item.refresh_from_db()
        self.stdout.write(
            "Synthetic editorial fixtures prepared in owned disposable database only."
        )
