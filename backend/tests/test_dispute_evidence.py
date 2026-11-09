import uuid

from django.test import TestCase, override_settings

from apps.accounts.models import AuditEvent
from apps.orders import aftercare_queries
from apps.payments import media
from tests.test_catalogue import image_file
from tests.test_disputes import DisputeFixture


@override_settings(OWNER_MFA_REQUIRED=False)
class DisputeEvidenceTests(DisputeFixture, TestCase):
    def test_orders_only_seller_reads_bound_dispute_without_financial_evidence_rights(self):
        order = self.company_order(complete=True)
        member, client, _ = self.seller_member(order, bundles=["orders_negotiation"])
        image = media.upload(self.buyer, order.pk, uuid.uuid4(), image_file())
        dispute = self.open_dispute(order, evidence=[image["id"]])
        row = aftercare_queries.dispute_detail(member, dispute.pk)
        self.assertEqual(row["evidence"], [image["id"]])
        self.assertTrue(row["can_respond"])
        path = f"/api/v1/payments/seller/evidence/{image['id']}/"
        response = client.get(path, HTTP_RANGE="bytes=0-10")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Accept-Ranges"], "none")
        self.assertIn("no-store", response["Cache-Control"])
        self.assertTrue(AuditEvent.objects.filter(actor=member.user, action="payment_evidence_read").exists())
        self.assertTrue(b"".join(response.streaming_content).startswith(b"\xff\xd8"))
        financial = media.upload(self.buyer, order.pk, uuid.uuid4(), image_file())
        self.assertEqual(client.get(f"/api/v1/payments/seller/evidence/{financial['id']}/").status_code, 404)

    def test_revoked_member_loses_bound_dispute_images_and_detail(self):
        order = self.company_order(complete=True)
        _, client, membership = self.seller_member(order, bundles=["orders_negotiation"])
        image = media.upload(self.buyer, order.pk, uuid.uuid4(), image_file())
        dispute = self.open_dispute(order, evidence=[image["id"]])
        membership.active = False
        membership.save(update_fields=["active"])
        self.assertEqual(client.get(f"/api/v1/payments/seller/evidence/{image['id']}/").status_code, 404)
        self.assertEqual(client.get(f"/api/v1/orders/seller/disputes/{dispute.pk}/").status_code, 404)

    def test_review_withdrawal_flag_is_exact_buyer_and_pending_only(self):
        order = self.completed()
        review = self.submit_review(order)
        self.assertTrue(aftercare_queries.review_row(review, self.buyer)["can_withdraw"])
        self.assertFalse(aftercare_queries.review_row(review, self.seller)["can_withdraw"])
        self.assertFalse(aftercare_queries.review_row(review, self.other_buyer)["can_withdraw"])
        self.moderate_review(review)
        review.refresh_from_db()
        self.assertFalse(aftercare_queries.review_row(review, self.buyer)["can_withdraw"])
