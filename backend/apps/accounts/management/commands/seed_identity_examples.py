import json
import sys
from pathlib import Path

from django.conf import settings
from django.contrib.auth.models import Group
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction
from config.testing import assert_owned_database

from apps.accounts.models import Account, User
from apps.accounts.services import audit, password_check


class Command(BaseCommand):
    help = "Opt-in synthetic identity examples from a private JSON file; never changes existing credentials/status."

    def add_arguments(self, parser):
        source = parser.add_mutually_exclusive_group(required=True)
        source.add_argument("--private-input")
        source.add_argument("--stdin", action="store_true")

    @transaction.atomic
    def handle(self, **options):
        if settings.PRODUCTION or not settings.DEBUG:
            raise CommandError("Synthetic identities require the disposable browser test runtime.")
        assert_owned_database(connection)
        if options["stdin"]:
            values = json.load(sys.stdin)
        else:
            source = Path(options["private_input"])
            if not source.is_absolute() or not source.is_file() or source.stat().st_mode & 0o077:
                raise CommandError("Use an absolute private input file with mode 0600.")
            values = json.loads(source.read_text())
        password = values["password"]
        password_check(password, User(email="synthetic@example.test"))
        call_command("setup_identity_groups", verbosity=0)
        specs = [
            ("buyer", ["buyer"], True, True),
            ("seller", ["seller"], True, True),
            ("linked", ["buyer", "seller"], True, True),
            ("unverified", ["buyer"], False, True),
            ("business", ["buyer"], True, True),
            ("suspended", ["buyer", "seller"], True, True),
            ("disabled", ["buyer"], True, False),
            ("unrelated", ["buyer"], True, True),
            ("support", ["staff"], True, True),
            ("logistics", ["staff"], True, True),
            ("owner", [], True, True),
        ]
        created = 0
        for name, contexts, verified, active in specs:
            email = f"phase03-{name}@example.test"
            if User.objects.filter(email=email).exists():
                continue
            user = User.objects.create_user(
                email,
                password,
                display_name="Synthetic " + name.title(),
                email_verified=verified,
                is_active=active,
                is_staff=name == "owner",
                is_superuser=name == "owner",
                owner_authority=name == "owner",
            )
            for context in contexts:
                account = Account.objects.create(
                    user=user,
                    context=context,
                    intent="business" if name == "business" else "individual",
                    status="suspended" if name == "suspended" and context == "seller" else "active",
                    review_status="pending" if context == "seller" or name == "business" else "not_requested",
                )
                if context == "staff":
                    account.permission_groups.add(
                        Group.objects.get(name="Rezayi: " + ("Support" if name == "support" else "Logistics"))
                    )
            audit("synthetic_identity_seeded", user=user)
            created += 1
        self.stdout.write(
            f"Created {created} isolated synthetic identities; existing identities unchanged; no factors pre-enrolled."
        )
