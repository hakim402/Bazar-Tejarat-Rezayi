"""Sealed dispute/review/report examples in the runner's disposable storage only."""

import json
import os
from pathlib import Path
import sys
import uuid
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.models import Group
from django.core.management import BaseCommand, CommandError, call_command
from django.db import connection, transaction
from django.test import override_settings
from django.utils import timezone

from config.testing import assert_owned_database, ownership_manifest, run_id
from apps.accounts.models import User
from apps.catalogue.models import Variant
from apps.fulfilment import completion, models as delivery
from apps.fulfilment.management.commands.seed_fulfilment_examples import example_delivery
from apps.marketplace import services as stores
from apps.marketplace.models import Store
from apps.marketplace.management.commands.seed_marketplace_examples import image_file
from apps.messaging import cases, services as messaging
from apps.messaging.models import CaseAccess, CaseEvent, Report
from apps.messaging.management.commands.seed_messaging_examples import actor
from apps.orders import disputes, reviews
from apps.orders.models import DisputeRequest, Review, SellerOrder
from apps.orders.management.commands.seed_commerce_examples import (
    aftercare_version,
    example_aftercare_order,
    finance_version,
)
from apps.payments import media, queries as payment_queries, refunds, services as goods
from apps.payments.models import EvidenceBinding, RefundDecision, RefundDue
from apps.runtime.mariadb import schema

MANIFEST_FILENAME = "dispute-examples.json"


def owned_storage():
    assert_owned_database(connection)
    if settings.PRODUCTION or not settings.DEBUG or connection.vendor != "mysql":
        raise CommandError("Only native disposable browser fixtures are permitted.")
    root = Path(settings.DATA_ROOT)
    owned = Path(ownership_manifest()["root"])
    if root.is_symlink() or not root.resolve().is_relative_to(owned.resolve()):
        raise CommandError("Fixture storage must belong to this disposable run.")
    schema.verify(record=False, version=5)
    if not schema.ready():
        raise CommandError("Publish the complete native v5 graph before seeding.")
    return root


def order_record(order):
    return {
        "id": str(order.pk),
        "seller": str(order.seller_id),
        "invoice": str(order.invoice.pk),
        "number": order.invoice.number,
    }


def dispute_command(principal, order, action, **data):
    return disputes.mutate(principal, order.pk, action, {
        "command_id": uuid.uuid4(), "version": aftercare_version(order), **data,
    })


def decide_dispute(principal, dispute, action, **data):
    dispute.refresh_from_db()
    return disputes.decide(principal, dispute.pk, {
        "command_id": uuid.uuid4(), "version": aftercare_version(dispute.order),
        "dispute_version": dispute.version, "action": action,
        "reason": "Independent synthetic dispute fixture decision", **data,
    })


def refund_decision(principal, due, action, **data):
    due.refresh_from_db()
    return refunds.decide(principal, due.pk, {
        "command_id": uuid.uuid4(), "version": finance_version(due.order),
        "due_version": due.version, "action": action,
        "reason": "Independent synthetic dispute refund confirmation", **data,
    })


def delivered_order(seller, *, paid=False):
    value = example_delivery("cod", stage="delivered", charge="0.00")
    order = SellerOrder.objects.get(pk=value["id"])
    assert delivery.Delivery.objects.filter(order=order).count() == 1
    assert not delivery.Completion.objects.filter(order=order).exists()
    if paid:
        goods.mutate(seller, order.pk, "receipt", {
            "command_id": uuid.uuid4(), "version": finance_version(order),
            "amount": format(order.goods_total, ".2f"), "currency": order.currency,
            "paid_at": timezone.now() - timedelta(minutes=1),
            "description": "Synthetic actual full goods receipt for completed fixture",
        })
        assert payment_queries.confirmed(order) == order.goods_total
        assert delivery.Completion.objects.filter(order=order).count() == 1
    return order


@override_settings(OWNER_MFA_REQUIRED=False)
@transaction.atomic
def seed():
    owned_storage()
    buyer_user = User.objects.get(email="phase12-buyer@example.test", email_verified=True, is_active=True)
    seller_user = User.objects.get(email="phase12-owner@example.test", email_verified=True, is_active=True)
    root_user = User.objects.get(
        email="phase09-root@example.test", email_verified=True, is_active=True, is_staff=True, is_superuser=True,
    )
    # Reuse the existing synthetic staff identity: CR-120 forbids the root dispute
    # decider confirming its own refund. Never create/promote another identity.
    confirmer_user = User.objects.get(
        email="phase12-reviewer@example.test", email_verified=True, is_active=True, is_staff=True,
    )
    confirmer_user.accounts.get(context="staff", status="active")
    for command in ("setup_dispute_groups", "setup_aftercare_groups", "setup_messaging_groups"):
        call_command(command, verbosity=0)
    confirmer_user.groups.add(
        Group.objects.get(name="Rezayi: Goods refund review"),
        Group.objects.get(name="Rezayi: Aftercare assignment"),
        Group.objects.get(name="Rezayi: Message case reviewer"),
    )
    buyer = actor(buyer_user, "buyer")
    seller = actor(seller_user, "seller")
    root = actor(root_user, "owner")
    confirmer = actor(confirmer_user, "staff")
    variant = Variant.objects.select_related("product__seller").get(sku="P12-FIXED")
    assert variant.product.seller.account.user_id == seller.user.pk
    store = Store.objects.filter(profile=variant.product.seller).first()
    if store is None:
        store = stores.save(seller, variant.product.seller_id, {
            "version": 0,
            "body": {
                "source_locale": "fa-AF",
                "editions": {"fa-AF": {
                    "description": "فروشگاه آزمایشی • Synthetic dispute fixture store",
                    "logo_alt": "", "banner_alt": "",
                }},
                "country": "Afghanistan", "city": "Kabul", "logo": None, "banner": None,
            },
        })
    manifest = {
        "format": 1, "run_id": run_id(), "native_schema_version": 5,
        "seller": str(variant.product.seller_id), "store": str(store.pk),
        "product": str(variant.product_id), "orders": {}, "disputes": {}, "reviews": {}, "reports": {},
    }
    # Accepted-only cannot open a dispute; delivered-unpaid cannot submit a review.
    accepted = example_aftercare_order(buyer, "P12-FIXED", "1.000", method="cod")
    manifest["orders"]["accepted"] = order_record(accepted)
    unpaid = delivered_order(seller)
    manifest["orders"]["delivered"] = order_record(unpaid)
    completed = delivered_order(seller, paid=True)
    manifest["orders"]["completed"] = order_record(completed)

    for name, outcome, paid in (
        ("pending", None, False), ("responded", None, True),
        ("dismissed", "dismiss", True), ("resolved", "resolve", True),
        ("refund_ordered", "refund", True), ("refund_confirmed", "refund", True),
    ):
        order = delivered_order(seller, paid=paid)
        prior = list(delivery.Completion.objects.filter(order=order).values())
        evidence = media.upload(buyer, order.pk, uuid.uuid4(), image_file())
        result = dispute_command(
            buyer, order, "dispute_open", reason="Synthetic dispute fixture " + name,
            evidence=[evidence["id"]],
        )
        dispute = DisputeRequest.objects.get(pk=result["dispute"])
        assert EvidenceBinding.objects.filter(dispute=dispute, evidence_id=evidence["id"]).exists()
        decide_dispute(root, dispute, "assign", assigned_to=root.user.pk)
        if name != "pending":
            dispute_command(
                seller, order, "dispute_respond", dispute=str(dispute.pk),
                text="پاسخ آزمایشی • Synthetic retained seller response",
            )
        if outcome:
            decide_dispute(root, dispute, outcome, **({"amount": "2.00"} if outcome == "refund" else {}))
            assert delivery.BlockerClosure.objects.filter(blocker_id=dispute.blocker_id).count() == 1
        completion.recover(order.pk)
        assert prior == list(delivery.Completion.objects.filter(order=order).values())
        if not paid:
            assert not delivery.Completion.objects.filter(order=order).exists()
        dispute.refresh_from_db()
        assert dispute.state == (disputes.OUTCOME_FOR_ACTION[outcome] if outcome else "pending")
        record = {
            **order_record(order), "dispute": str(dispute.pk), "state": dispute.state,
            "evidence": evidence["id"], "blocker": str(dispute.blocker_id), "refund_due": None,
            "refund_report": None, "refund_decision": None,
        }
        if outcome == "refund":
            due = RefundDue.objects.get(order=order, cause="dispute")
            record["refund_due"] = str(due.pk)
            assert not RefundDecision.objects.filter(report__due=due).exists()
            if name == "refund_confirmed":
                refund_image = media.upload(seller, order.pk, uuid.uuid4(), image_file())
                result = refunds.mutate(seller, order.pk, "report", {
                    "command_id": uuid.uuid4(), "version": finance_version(order),
                    "due": str(due.pk), "amount": format(due.amount, ".2f"),
                    "sent_at": timezone.now() - timedelta(minutes=1), "reference": "SYNTHETIC-DISPUTE-REFUND",
                    "description": "Synthetic seller-reported actual refund", "evidence": [refund_image["id"]],
                })
                refund_decision(root, due, "assign", assigned_to=confirmer.user.pk)
                refund_decision(confirmer, due, "confirm")
                decision = RefundDecision.objects.get(report_id=result["report"], action="confirmed")
                assert decision.actor_id != dispute.decision.actor_id
                record.update(refund_report=result["report"], refund_decision=str(decision.pk))
        manifest["disputes"][name] = record

    for name, action in (
        ("pending", None), ("approved", "approve"), ("rejected", "reject"),
        ("withdrawn", "buyer_withdraw"), ("moderator_withdrawn", "moderator_withdraw"),
    ):
        order = delivered_order(seller, paid=True)
        result = reviews.mutate(buyer, order.pk, "review_submit", {
            "command_id": uuid.uuid4(), "version": aftercare_version(order),
            "rating": 4 if name == "approved" else 2, "language": "fa-AF",
            "text": "نظر آزمایشی • Synthetic retained review " + name,
        })
        review = Review.objects.get(pk=result["review"])
        if action == "buyer_withdraw":
            reviews.mutate(buyer, order.pk, "review_withdraw", {
                "command_id": uuid.uuid4(), "version": aftercare_version(order),
                "reason": "Synthetic pending buyer review withdrawal",
            })
        elif action:
            for moderation in (["approve", "withdraw"] if action == "moderator_withdraw" else [action]):
                review.refresh_from_db()
                reviews.moderate(root, review.pk, {
                    "command_id": uuid.uuid4(), "version": aftercare_version(order),
                    "review_version": review.version, "action": moderation,
                    "reason": "Independent synthetic review fixture moderation",
                })
        review.refresh_from_db()
        manifest["reviews"][name] = {**order_record(order), "review": str(review.pk), "state": review.state}

    before_reports = reviews.aggregate(variant.product.seller)
    assert before_reports == {"count": 1, "average": "4.0"}
    enquiry = messaging.create_enquiry(buyer, {
        "command_id": uuid.uuid4(), "product": variant.product_id, "locale": "fa-AF",
        "body": "Synthetic private order-case enquiry", "images": [],
    })
    for kind, target in (("product", variant.product_id), ("store", store.pk), ("order", completed.pk)):
        result = messaging.report_target(buyer, kind, target, {
            "command_id": uuid.uuid4(), "category": "other", "reason": "Synthetic retained " + kind + " report",
        })
        report = Report.objects.get(pk=result["id"])
        for action in ("assign", "resolve", "reopen", "assign"):
            report = cases.transition(root, report.pk, version=report.version, action=action,
                                      reason="Independent synthetic report case history",
                                      **({"assigned_to": confirmer.account.pk} if action == "assign" else {}))
        if kind == "order":
            cases.inspect(confirmer, report.pk)
            assert CaseAccess.objects.filter(report=report, conversation_id=enquiry["conversation"]).exists()
        assert list(CaseEvent.objects.filter(report=report).order_by("version").values_list("action", flat=True)) == [
            "reported", "assign", "resolve", "reopen", "assign",
        ]
        manifest["reports"][kind] = {"id": str(report.pk), "target": str(target), "state": report.status}
    assert before_reports == reviews.aggregate(variant.product.seller)
    manifest["public_summary"] = before_reports
    return manifest


class Command(BaseCommand):
    def add_arguments(self, parser):
        parser.add_argument("--stdin", action="store_true", required=True)

    def handle(self, **options):
        root = owned_storage()
        values = json.load(sys.stdin)
        if not isinstance(values.get("password"), str) or not values["password"]:
            raise CommandError("Supply the generated fixture password on stdin.")
        path = root / MANIFEST_FILENAME
        if path.is_symlink():
            raise CommandError("The fixture manifest must not be a symlink.")
        if path.exists():
            previous = json.loads(path.read_text())
            if previous.get("run_id") != run_id() or previous.get("native_schema_version") != 5:
                raise CommandError("The fixture manifest does not belong to this native v5 run.")
            self.stdout.write("Existing owned dispute fixture manifest retained: " + MANIFEST_FILENAME)
            return
        if DisputeRequest.objects.filter(reason__startswith="Synthetic dispute fixture ").exists():
            raise CommandError("An interrupted fixture run needs a new owned database, not a duplicate reseed.")
        manifest = seed()
        root.mkdir(mode=0o700, parents=True, exist_ok=True)
        with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as stream:
            json.dump(manifest, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
        self.stdout.write("Owned sealed dispute/review/report fixtures prepared; private manifest: " + MANIFEST_FILENAME)
