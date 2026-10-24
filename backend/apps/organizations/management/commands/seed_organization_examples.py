"""Idempotent synthetic fixtures strictly restricted to the owned disposable test runtime."""

import io
import json
import sys
from unittest.mock import patch

from PIL import Image
from django.conf import settings
from django.contrib.auth.models import Group
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import BaseCommand, CommandError, call_command
from django.db import connection, transaction

from config.testing import assert_owned_database
from apps.accounts.models import Account, User
from apps.organizations.profiles import create_profile, current_case
from apps.organizations.models import Membership, BUNDLES
from apps.organizations.teams import invite
from apps.organizations.transfers import request_transfer, transfer_action
from apps.verification.services import application_action, review_action, upload_evidence
from apps.organizations.access import Actor


class FixtureActor(Actor):
    def __init__(self, account):
        self._account = account
        self.context = account.context
        self.request = type("FixtureRequest", (), {"user": account.user})()

    @property
    def account(self):
        return self._account


class Command(BaseCommand):
    help = "Prepare synthetic Phase 04 fixtures in the automatically owned disposable database only."

    def add_arguments(self, parser):
        parser.add_argument("--stdin", action="store_true", required=True)

    @transaction.atomic
    def handle(self, **options):
        if settings.PRODUCTION or not settings.DEBUG:
            raise CommandError("Use the disposable browser runtime.")
        assert_owned_database(connection)
        password = json.load(sys.stdin)["password"]
        call_command("setup_identity_groups", verbosity=0)
        if User.objects.filter(email="phase04-applicant@example.test").exists():
            self.stdout.write("Synthetic organization examples already exist; unchanged.")
            return

        def account(name, context="seller", group=None):
            user, created = User.objects.get_or_create(
                email=f"phase04-{name}@example.test",
                defaults={"display_name": "Synthetic " + name, "email_verified": True},
            )
            if created:
                user.set_password(password)
                user.save()
            result = Account.objects.create(user=user, context=context)
            if group:
                result.permission_groups.add(Group.objects.get(name=group))
            return result

        reviewer = FixtureActor(account("reviewer", "staff", "Rezayi: Business review"))
        company_actor = FixtureActor(account("company-owner"))
        applicant = FixtureActor(account("applicant"))
        buyer = FixtureActor(account("business", "buyer"))
        limited = account("member")
        invitee = account("invitee")
        revoked = account("revoked")
        account("unauthorized", "staff", "Rezayi: Support")
        account("unrelated")
        shared = account("shared")
        shared_buyer = Account.objects.create(user=shared.user, context="buyer", intent="business")

        def profile(actor, kind, name):
            return create_profile(
                actor,
                {
                    "kind": kind,
                    "display_name": name,
                    "legal_name": "Synthetic legal identity",
                    "business_type": "Synthetic trading",
                    "contact_phone": "0000000000",
                    "location": "Synthetic test address",
                    "representative": "Synthetic representative",
                },
            )

        def populate(item, actor, status="submitted"):
            for category in (
                ["identity"]
                if item.kind == "individual"
                else ["business", "representative_identity", "representative_authority"]
            ):
                output = io.BytesIO()
                Image.new("RGB", (16, 16), (20, 70, 110)).save(output, format="PNG")
                upload_evidence(
                    actor,
                    item.pk,
                    SimpleUploadedFile("synthetic.png", output.getvalue(), content_type="image/png"),
                    category,
                    current_case(item).version,
                )
            case = application_action(actor, item.pk, {"version": current_case(item).version, "action": "submit"})
            if status != "submitted":
                case = review_action(
                    reviewer,
                    case.pk,
                    {
                        "version": case.version,
                        "action": "assign",
                        "assigned_to": reviewer.account.pk,
                        "reason": "Synthetic assignment",
                    },
                )
                review_action(
                    reviewer,
                    case.pk,
                    {"version": case.version, "action": status, "reason": "Synthetic fixture decision"},
                )

        company = profile(company_actor, "company", "Synthetic company team")
        populate(company, company_actor, "approved")
        member = Membership.objects.create(company=company, account=limited, bundles=["catalogue"])
        Membership.objects.create(company=company, account=revoked, active=False, bundles=[])
        pending = profile(applicant, "individual", "Synthetic applicant pending")
        populate(pending, applicant)
        profile(buyer, "business", "Synthetic business buyer draft")
        shared_profile = profile(FixtureActor(shared), "individual", "Synthetic shared seller approved")
        populate(shared_profile, FixtureActor(shared), "approved")
        profile(FixtureActor(shared_buyer), "business", "Synthetic shared buyer unverified")
        for status in ("approved", "rejected", "submitted"):
            actor = FixtureActor(account("individual-" + status))
            item = profile(actor, "individual", "Synthetic individual " + status)
            populate(item, actor, status)
            actor = FixtureActor(account("company-" + status))
            item = profile(actor, "company", "Synthetic company " + status)
            populate(item, actor, status)
        approved_buyer = FixtureActor(account("business-approved", "buyer"))
        item = profile(approved_buyer, "business", "Synthetic approved business buyer")
        populate(item, approved_buyer, "approved")
        with patch("apps.organizations.mail.dispatch_invitation"):
            invite(company_actor, company.pk, {"email": invitee.user.email, "bundles": ["messaging"], "locale": "en"})
        # Historical completed/rejected examples use their own unrelated synthetic company.
        history_actor = FixtureActor(account("history-owner"))
        history_company = profile(history_actor, "company", "Synthetic transfer history")
        recipient = Membership.objects.create(company=history_company, account=limited, bundles=list(BUNDLES))
        item = request_transfer(history_actor, history_company.pk, {"recipient": recipient.pk, "retained_bundles": []})
        item = transfer_action(FixtureActor(limited), item.pk, {"version": item.version, "action": "accept"})
        transfer_action(
            reviewer, item.pk, {"version": item.version, "action": "reject", "reason": "Synthetic rejected example"}
        )
        item = request_transfer(
            history_actor, history_company.pk, {"recipient": recipient.pk, "retained_bundles": ["catalogue"]}
        )
        item = transfer_action(FixtureActor(limited), item.pk, {"version": item.version, "action": "accept"})
        transfer_action(
            reviewer, item.pk, {"version": item.version, "action": "approve", "reason": "Synthetic completed example"}
        )
        request_transfer(company_actor, company.pk, {"recipient": member.pk, "retained_bundles": ["messaging"]})
        self.stdout.write(
            "Prepared synthetic Phase 04 profiles, private evidence, team, invitations and transfers; no real data used."
        )
