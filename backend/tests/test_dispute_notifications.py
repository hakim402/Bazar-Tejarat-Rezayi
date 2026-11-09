"""Typed dispute/review fan-out through the existing aftercare channel only."""

import uuid
from datetime import timedelta
from unittest.mock import patch

from django.core import mail
from django.test import TestCase, override_settings
from django.utils import timezone

from django.db import DatabaseError, connection, transaction
from django.db.models import F

from apps.accounts.models import Account, User
from apps.notifications import aftercare_events, services as notifications
from apps.notifications.models import AftercareEmail, AftercareEmailAttempt, AftercareNoticeCursor, Event, Notice
from apps.orders import access
from apps.orders.models import AftercareEvent
from apps.organizations.models import BusinessProfile, Membership
from tests.test_disputes import DisputeFixture
from tests.test_dispute_reports import ReportFixture


@override_settings(OWNER_MFA_REQUIRED=False)
class DisputeNotificationTests(DisputeFixture, TestCase):
    def fanout_action(self, order, action):
        event = Event.objects.get(aftercare_event__order=order, aftercare_event__action=action)
        cursor = AftercareNoticeCursor.objects.get(event=event)
        aftercare_events.fanout(cursor.pk)
        return event

    def make_due(self, row):
        # Only this disposable intent's scheduling metadata changes. Business
        # facts, delivery, recipients and command outcomes remain real services.
        row.due_at = timezone.now() - timedelta(minutes=1)
        row.status = "retry_due"
        row.version += 1
        row.save()

    def test_open_response_and_decision_have_exact_current_typed_recipients_and_deduplicate(self):
        order = self.completed()
        dispute = self.open_dispute(order)
        opened = self.fanout_action(order, "dispute_opened")
        self.assertEqual(list(Notice.objects.filter(event=opened).values_list("account_id", flat=True)),
                         [self.seller.account.pk])
        self.respond_dispute(dispute)
        responded = self.fanout_action(order, "dispute_response")
        self.assertEqual(list(Notice.objects.filter(event=responded).values_list("account_id", flat=True)), [order.buyer_id])
        self.assign_dispute(dispute)
        self.decide_dispute(dispute)
        decided = self.fanout_action(order, "dispute_decided")
        self.assertEqual(set(Notice.objects.filter(event=decided).values_list("account_id", flat=True)),
                         {order.buyer_id, self.seller.account.pk})
        self.assertIsNone(AftercareNoticeCursor.objects.get(event=decided).sender_id)
        for event in (opened, responded, decided):
            self.assertEqual(event.kind, "aftercare")
            self.assertTrue(AftercareNoticeCursor.objects.get(event=event).complete)
            for row in Notice.objects.filter(event=event):
                self.assertEqual(row.aftercare_order_id, order.pk)
                self.assertIsNone(row.order_id)
                self.assertIsNone(row.payment_order_id)
                self.assertIsNone(row.conversation_id)
            before = (Notice.objects.filter(event=event).count(), AftercareEmail.objects.filter(episode=event.pk).count())
            aftercare_events.fanout(AftercareNoticeCursor.objects.get(event=event).pk)
            self.assertEqual((Notice.objects.filter(event=event).count(), AftercareEmail.objects.filter(episode=event.pk).count()),
                             before)
        self.assertFalse(Notice.objects.filter(event=decided, account=self.other_buyer.account).exists())
        typed = next(row for row in notifications.notices(self.buyer)["results"] if row["id"] ==
                     str(Notice.objects.get(event=decided, account=self.buyer.account).pk))
        self.assertEqual((typed["aftercare"], typed["action"]), (str(order.pk), "dispute_decided"))
        self.assertNotIn(dispute.reason, str(typed))

    def test_fanout_rechecks_revoked_company_members_unverified_users_and_bundles(self):
        order = self.company_order(complete=True)
        eligible, _, _ = self.seller_member(order, "notice-current-member")
        revoked, _, revoked_member = self.seller_member(order, "notice-former-member")
        messaging, _, _ = self.seller_member(order, "notice-messaging-only", bundles=["messaging"])
        unverified, _, _ = self.seller_member(order, "notice-unverified-member")
        self.open_dispute(order)
        Membership.objects.filter(pk=revoked_member.pk).update(active=False)
        User.objects.filter(pk=unverified.user.pk).update(email_verified=False)
        event = self.fanout_action(order, "dispute_opened")
        recipients = set(Notice.objects.filter(event=event).values_list("account_id", flat=True))
        self.assertEqual(recipients, {self.seller.account.pk, eligible.account.pk})
        for actor in (revoked, messaging):
            self.assertNotIn(actor.account.pk, recipients)
        self.assertFalse(AftercareEmail.objects.filter(episode=event.pk, account__user=unverified.user).exists())

    def test_review_submitted_is_staff_queue_only_no_buyer_seller_notice_or_email(self):
        moderator, _ = self.dispute_reviewer(role="review_moderators")
        order = self.completed()
        review = self.submit_review(order)
        event = self.fanout_action(order, "review_submitted")
        self.assertTrue(access.review_scope(moderator).filter(pk=review.pk).exists())
        self.assertFalse(access.review_scope(self.staff).filter(pk=review.pk).exists())
        self.assertFalse(Notice.objects.filter(event=event, account__context__in=["buyer", "seller"]).exists())
        self.assertFalse(AftercareEmail.objects.filter(episode=event.pk).exists())
        self.assertTrue(AftercareNoticeCursor.objects.get(event=event).complete)

    def test_review_approval_and_buyer_withdrawal_never_generate_aftercare_buyer_email(self):
        for outcome in ("approve", "buyer_withdraw"):
            order = self.completed()
            review = self.submit_review(order)
            self.fanout_action(order, "review_submitted")
            if outcome == "approve":
                self.moderate_review(review)
                action = "review_decided"
            else:
                from apps.orders import reviews

                reviews.mutate(self.buyer, order.pk, "review_withdraw", self.dispute_packet(order))
                action = "review_withdrawn"
            event = self.fanout_action(order, action)
            with self.subTest(outcome=outcome):
                self.assertFalse(AftercareEmail.objects.filter(order=order).exists())
                self.assertTrue(AftercareNoticeCursor.objects.get(event=event).complete)
                if outcome == "approve":
                    self.assertEqual(set(Notice.objects.filter(event=event).values_list("account_id", flat=True)),
                                     {self.buyer.account.pk, self.seller.account.pk})
        self.assertEqual(len(mail.outbox), 0)

    def test_dispute_email_actual_capture_is_generic_branded_localized_and_exactly_once(self):
        order = self.completed()
        private_reason = "PRIVATE-DISPUTE-REASON +93000000000 private-proof@example.test"
        dispute = self.open_dispute(order, reason=private_reason)
        event = self.fanout_action(order, "dispute_opened")
        queued = AftercareEmail.objects.get(order=order, account=self.seller.account, episode=event.pk)
        self.make_due(queued)
        self.assertEqual(aftercare_events.dispatch(queued.pk), "captured")
        self.assertEqual(len(mail.outbox), 1)
        captured = mail.outbox[0]
        body = captured.body + str(captured.alternatives[0][0])
        self.assertIn(f"/account/seller/disputes/{dispute.pk}", body)
        self.assertIn("cid:rezayi-brand", body)
        for private in (private_reason, "private-proof@example.test", "+93000000000", "15.00",
                        self.buyer.user.email, str(order.invoice.number)):
            self.assertNotIn(private, body)
        self.assertEqual(aftercare_events.dispatch(queued.pk), "captured")
        self.assertEqual(len(mail.outbox), 1)
        for locale in ("fa-AF", "ps", "ar", "en"):
            for account in (self.buyer.account, self.seller.account):
                with self.subTest(locale=locale, context=account.context):
                    _, plain, html = aftercare_events.rendered(
                        account, order, locale, "dispute_opened", source_event=event.aftercare_event
                    )
                    self.assertIn(f"/{locale}/account/{account.context}/disputes/{dispute.pk}", plain)
                    self.assertNotIn(f"/disputes/{order.pk}", plain + html)
                    self.assertIn(f'lang="{locale}"', html)
                    self.assertIn('dir="ltr"' if locale == "en" else 'dir="rtl"', html)
                    self.assertNotIn(private_reason, plain + html)

    def test_dispute_email_optout_preserves_notice_and_read_cancels_existing_intent(self):
        order = self.completed()
        notifications.set_preference(self.seller, {
            "message_email": True, "aftercare_email": False, "locale": "en", "version": 0,
        })
        dispute = self.open_dispute(order)
        opened = self.fanout_action(order, "dispute_opened")
        self.assertTrue(Notice.objects.filter(event=opened, account=self.seller.account).exists())
        self.assertFalse(AftercareEmail.objects.filter(episode=opened.pk).exists())
        self.respond_dispute(dispute)
        responded = self.fanout_action(order, "dispute_response")
        queued = AftercareEmail.objects.get(episode=responded.pk, account=self.buyer.account)
        self.make_due(queued)
        notice = Notice.objects.get(event=responded, account=self.buyer.account)
        notifications.read_notice(self.buyer, notice.pk)
        self.assertEqual(aftercare_events.dispatch(queued.pk), "cancelled")
        self.assertEqual(len(mail.outbox), 0)

    def test_native_typed_dispute_notice_cannot_retarget_account_or_resource(self):
        order = self.completed()
        self.open_dispute(order)
        event = self.fanout_action(order, "dispute_opened")
        notice = Notice.objects.get(event=event, account=self.seller.account)
        before = self.dispute_state()
        self.guard_rejects("UPDATE notifications_notice SET account_id=%s WHERE id=%s",
                           [self.other_buyer.account.pk.hex, notice.pk.hex])
        self.guard_rejects("UPDATE notifications_notice SET aftercare_order_id=NULL,order_id=%s WHERE id=%s",
                           [order.pk.hex, notice.pk.hex])
        self.guard_rejects("DELETE FROM notifications_event WHERE id=%s", [event.pk.hex])
        self.assertEqual(self.dispute_state(), before)

    def test_dispute_response_decision_links_use_retained_dispute_not_order(self):
        order = self.completed()
        dispute = self.open_dispute(order)
        self.respond_dispute(dispute)
        self.assign_dispute(dispute)
        self.decide_dispute(dispute)
        for action in ("dispute_opened", "dispute_response", "dispute_decided"):
            event = Event.objects.get(aftercare_event__order=order, aftercare_event__action=action)
            for account in (self.buyer.account, self.seller.account):
                with self.subTest(action=action, context=account.context):
                    _, plain, html = aftercare_events.rendered(
                        account, order, "en", action, source_event=event.aftercare_event
                    )
                    self.assertIn(f"/account/{account.context}/disputes/{dispute.pk}", plain)
                    self.assertNotIn(f"/disputes/{order.pk}", plain + html)
        assigned = AftercareEvent.objects.get(order=order, action="dispute_assigned")
        _, plain, _ = aftercare_events.rendered(
            self.buyer.account, order, "en", "dispute_assigned", source_event=assigned
        )
        self.assertTrue(plain.endswith("/account/buyer/disputes"))


@override_settings(OWNER_MFA_REQUIRED=False)
class ReportNotificationTests(ReportFixture, TestCase):
    def make_due(self, row):
        row.due_at = timezone.now() - timedelta(minutes=1)
        row.status = "retry_due"
        row.version += 1
        row.save()

    def status_event(self, report):
        report.refresh_from_db()
        return Event.objects.get(report=report, report_version=report.version)

    def assert_native_reject(self, create):
        self.assertEqual(connection.vendor, "mysql", "Require actual native MariaDB guards.")
        with self.assertRaises(DatabaseError) as error, transaction.atomic():
            create()
        self.assertEqual(error.exception.args[0], 1644)

    def test_report_assign_resolve_reopen_all_four_targets_publish_exact_reporter_episode_once(self):
        targets = self.four_targets()
        for kind, target in targets.items():
            report = self.target_report(kind, target)
            for action in ("assign", "resolve", "reopen"):
                self.transition_report(report, action)
                event = self.status_event(report)
                with self.subTest(kind=kind, action=action):
                    self.assertEqual(event.kind, "report_status")
                    notice = Notice.objects.get(event=event)
                    self.assertEqual(notice.account_id, report.reporter_id)
                    self.assertEqual(aftercare_events.report_notice_target(report), {
                        field + "_id": getattr(notice, field + "_id")
                        for field in ("conversation", "order", "product", "store")
                        if getattr(notice, field + "_id") is not None
                    })
                    queued = AftercareEmail.objects.get(episode=event.pk)
                    self.assertEqual((queued.report_id, queued.order_id, queued.account_id),
                                     (report.pk, None, report.reporter_id))
                    before = (Event.objects.filter(report=report).count(), Notice.objects.filter(event=event).count(),
                              AftercareEmail.objects.filter(report=report).count())
                    self.assertEqual(notifications.report_status(report).pk, event.pk)
                    self.assertEqual((Event.objects.filter(report=report).count(), Notice.objects.filter(event=event).count(),
                                      AftercareEmail.objects.filter(report=report).count()), before)
                    self.assertFalse(Notice.objects.filter(event=event, account=self.seller.account).exists())
        self.assertFalse(AftercareNoticeCursor.objects.filter(event__kind="report_status").exists())

    def capture_report(self, kind):
        target = (self.room().messages.first() if kind == "message" else self.completed() if kind == "order"
                  else self.store_target() if kind == "store" else self.product)
        reason = "PRIVATE-REPORT-REASON +93000000000 private-proof@example.test"
        report = self.target_report(kind, target, reason=reason)
        self.transition_report(report, "resolve")
        event = self.status_event(report)
        queued = AftercareEmail.objects.get(report=report, episode=event.pk)
        self.assertGreaterEqual(queued.due_at, queued.created_at + timedelta(seconds=59))
        self.make_due(queued)
        self.assertEqual(aftercare_events.dispatch(queued.pk), "captured")
        self.assertEqual(len(mail.outbox), 1)
        captured = mail.outbox[0]
        body = captured.body + str(captured.alternatives[0][0])
        self.assertTrue(captured.body.endswith("/fa-AF/account/buyer/notifications"))
        self.assertIn("cid:rezayi-brand", body)
        for private in (reason, "+93000000000", "private-proof@example.test", report.category,
                        str(report.pk), str(target.pk), self.buyer.user.email, "15.00"):
            self.assertNotIn(private, body)
        self.assertEqual(aftercare_events.dispatch(queued.pk), "captured")
        self.assertEqual(AftercareEmailAttempt.objects.filter(email=queued, status="captured").count(), 1)
        self.assertEqual(len(mail.outbox), 1)

    def test_message_report_actual_capture_privacy_and_dedup(self):
        self.capture_report("message")

    def test_order_report_actual_capture_privacy_and_dedup(self):
        self.capture_report("order")

    def test_product_report_actual_capture_privacy_and_dedup(self):
        self.capture_report("product")

    def test_store_report_actual_capture_privacy_and_dedup(self):
        self.capture_report("store")

    def test_report_body_four_locales_buyer_and_seller_authenticated_notifications_only(self):
        for locale in ("fa-AF", "ps", "ar", "en"):
            for account in (self.buyer.account, self.seller.account):
                with self.subTest(locale=locale, context=account.context):
                    subject, plain, html = aftercare_events.rendered(account, None, locale, "report_status")
                    self.assertIn(aftercare_events.REPORT_COPY[locale][0], subject)
                    self.assertTrue(plain.endswith(f"/{locale}/account/{account.context}/notifications"))
                    self.assertIn(f'lang="{locale}"', html)
                    self.assertIn('dir="ltr"' if locale == "en" else 'dir="rtl"', html)
                    self.assertIn("cid:rezayi-brand", html)

    def test_all_four_report_reads_cancel_the_matching_email_without_private_disclosure(self):
        for kind, target in self.four_targets().items():
            report = self.target_report(kind, target)
            self.transition_report(report, "resolve")
            event = self.status_event(report)
            row = AftercareEmail.objects.get(episode=event.pk)
            notice = Notice.objects.get(event=event)
            with self.subTest(kind=kind):
                listing = notifications.notices(self.buyer)
                projected = next(item for item in listing["results"] if item["id"] == str(notice.pk))
                self.assertEqual(projected["report"], str(report.pk))
                self.assertNotIn(report.reason, str(projected))
                self.assertEqual(notifications.read_notice(self.buyer, notice.pk), {"read": True})
                self.make_due(row)
                self.assertEqual(aftercare_events.dispatch(row.pk), "cancelled")
        self.assertEqual(len(mail.outbox), 0)

    def test_aftercare_optout_prevents_report_email_all_targets_but_preserves_notices(self):
        notifications.set_preference(self.buyer, {
            "message_email": True, "payment_email": True, "aftercare_email": False, "locale": "en", "version": 0,
        })
        for kind, target in self.four_targets().items():
            report = self.target_report(kind, target)
            self.transition_report(report, "resolve")
            event = self.status_event(report)
            with self.subTest(kind=kind):
                self.assertTrue(Notice.objects.filter(event=event, account=self.buyer.account).exists())
                self.assertFalse(AftercareEmail.objects.filter(episode=event.pk).exists())

    def test_late_aftercare_optout_cancels_existing_report_intents_all_targets(self):
        rows = []
        for kind, target in self.four_targets().items():
            report = self.target_report(kind, target)
            self.transition_report(report, "resolve")
            rows.append(AftercareEmail.objects.get(episode=self.status_event(report).pk))
        notifications.set_preference(self.buyer, {
            "message_email": True, "aftercare_email": False, "locale": "en", "version": 0,
        })
        for row in rows:
            self.make_due(row)
            self.assertEqual(aftercare_events.dispatch(row.pk), "cancelled")
        self.assertEqual(len(mail.outbox), 0)

    def test_stale_cached_reporter_active_verification_and_account_status_are_rechecked(self):
        reports = [self.target_report(kind, target) for kind, target in self.four_targets().items()]
        # Populate a cached reporter before revocation; report_status must not use it.
        for report in reports:
            self.assertTrue(report.reporter.user.email_verified)
        User.objects.filter(pk=self.buyer.user.pk).update(email_verified=False)
        for report in reports:
            self.transition_report(report, "resolve")
            event = self.status_event(report)
            self.assertFalse(Notice.objects.filter(event=event).exists())
            self.assertFalse(AftercareEmail.objects.filter(episode=event.pk).exists())
        User.objects.filter(pk=self.buyer.user.pk).update(email_verified=True)
        for report in reports:
            self.transition_report(report, "reopen")
            self.assertTrue(AftercareEmail.objects.filter(episode=self.status_event(report).pk).exists())
        account_id = self.buyer.account.pk
        Account.objects.filter(pk=account_id).update(status="suspended", access_epoch=F("access_epoch") + 1)
        for row in AftercareEmail.objects.filter(account_id=account_id):
            self.make_due(row)
            self.assertEqual(aftercare_events.dispatch(row.pk), "cancelled")
        self.assertEqual(len(mail.outbox), 0)

    def test_report_identity_email_credential_and_access_epochs_cancel_old_intents(self):
        for kind, target in self.four_targets().items():
            report = self.target_report(kind, target)
            self.transition_report(report, "resolve")
        account_id = self.buyer.account.pk
        rows = list(AftercareEmail.objects.filter(account_id=account_id))
        User.objects.filter(pk=self.buyer.user.pk).update(credential_epoch=F("credential_epoch") + 1)
        Account.objects.filter(pk=account_id).update(access_epoch=F("access_epoch") + 1)
        for row in rows:
            self.make_due(row)
            self.assertEqual(aftercare_events.dispatch(row.pk), "cancelled")
        self.assertEqual(len(mail.outbox), 0)

    def test_order_and_message_report_company_revocation_reinstatement_fences_old_generation(self):
        order = self.company_order(complete=True)
        actor, _, member = self.seller_member(order, "report-mail-member", bundles=["orders_negotiation", "messaging"])
        message = self.room().messages.first()
        for kind, target in (("order", order), ("message", message)):
            report = self.target_report(kind, target, actor=actor)
            self.transition_report(report, "resolve")
            queued = AftercareEmail.objects.get(episode=self.status_event(report).pk)
            Membership.objects.filter(pk=member.pk).update(active=False)
            self.make_due(queued)
            self.assertEqual(aftercare_events.dispatch(queued.pk), "cancelled")
            Membership.objects.filter(pk=member.pk).update(active=True)
            self.transition_report(report, "reopen")
            second = AftercareEmail.objects.get(episode=self.status_event(report).pk)
            BusinessProfile.objects.filter(pk=order.seller_id).update(version=F("version") + 1)
            self.make_due(second)
            self.assertEqual(aftercare_events.dispatch(second.pk), "cancelled")
        self.assertEqual(len(mail.outbox), 0)

    def test_queued_report_emails_share_existing_cooldown_and_preferences_are_independent(self):
        notifications.set_preference(self.buyer, {
            "message_email": False, "payment_email": False, "aftercare_email": True, "locale": "ps", "version": 0,
        })
        report = self.target_report("product", self.product)
        self.transition_report(report, "resolve")
        first = AftercareEmail.objects.get(episode=self.status_event(report).pk)
        self.transition_report(report, "reopen")
        second = AftercareEmail.objects.get(episode=self.status_event(report).pk)
        self.make_due(first)
        self.make_due(second)
        self.assertEqual(aftercare_events.dispatch(first.pk), "captured")
        self.assertEqual(aftercare_events.dispatch(second.pk), "retry_due")
        first.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual(second.attempts, 0)
        self.assertEqual(second.due_at, first.accepted_at + timedelta(minutes=15))
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn('lang="ps"', str(mail.outbox[0].alternatives[0][0]))
        with patch("apps.notifications.aftercare_events.timezone.now", return_value=second.due_at + timedelta(seconds=1)):
            self.assertEqual(aftercare_events.dispatch(second.pk), "captured")
        self.assertEqual(len(mail.outbox), 2)

    def test_each_identity_component_and_user_activation_independently_cancel_report_email(self):
        for field in ("email", "credential_epoch", "access_epoch", "is_active", "email_verified"):
            actor, _ = self.connected("buyer", "report-identity-" + field)
            account_id = actor.account.pk
            report = self.target_report("product", self.product, actor=actor)
            self.transition_report(report, "resolve")
            queued = AftercareEmail.objects.get(episode=self.status_event(report).pk)
            if field == "access_epoch":
                Account.objects.filter(pk=account_id).update(access_epoch=F("access_epoch") + 1)
            else:
                value = ("changed-report@example.test" if field == "email" else F(field) + 1
                         if field == "credential_epoch" else False)
                User.objects.filter(pk=actor.user.pk).update(**{field: value})
            self.make_due(queued)
            with self.subTest(field=field):
                self.assertEqual(aftercare_events.dispatch(queued.pk), "cancelled")
        self.assertEqual(len(mail.outbox), 0)

    def test_seller_report_mail_honours_existing_aftercare_acceptance_cooldown(self):
        order = self.accept("advance")
        self.cancel(order)
        aftercare_events.sweep_notices()
        old = AftercareEmail.objects.get(order=order, account=self.seller.account)
        self.make_due(old)
        self.assertEqual(aftercare_events.dispatch(old.pk), "captured")
        old.refresh_from_db()
        report = self.target_report("order", order, actor=self.seller)
        self.transition_report(report, "resolve")
        queued = AftercareEmail.objects.get(episode=self.status_event(report).pk)
        self.assertGreaterEqual(queued.due_at, old.accepted_at + timedelta(minutes=15))
        with patch("apps.notifications.aftercare_events.timezone.now", return_value=queued.due_at + timedelta(seconds=1)):
            self.assertEqual(aftercare_events.dispatch(queued.pk), "captured")
        self.assertTrue(mail.outbox[-1].body.endswith("/account/seller/notifications"))
        self.assertNotIn(str(report.pk), mail.outbox[-1].body)
        self.assertNotIn(str(order.pk), mail.outbox[-1].body)

    def test_report_email_native_insert_requires_exact_event_typed_notice_recipient_and_xor_target(self):
        order = self.completed()
        report = self.target_report("order", order)
        other = self.target_report("product", self.product)
        self.transition_report(report, "resolve")
        event = self.status_event(report)
        queued = AftercareEmail.objects.get(episode=event.pk)
        defaults = {"report": report, "account": self.buyer.account, "episode": event.pk,
                    "identity_digest": queued.identity_digest, "due_at": timezone.now()}
        for changes in ({"report": other}, {"account": self.other_buyer.account}, {"episode": uuid.uuid4()},
                        {"order": order}, {"report": None}, {"report": None, "order": order}):
            with self.subTest(changes=changes):
                self.assert_native_reject(lambda: AftercareEmail.objects.create(**{**defaults, **changes}))
        self.guard_rejects("UPDATE notifications_aftercareemail SET report_id=%s,version=version+1 WHERE id=%s",
                           [other.pk.hex, queued.pk.hex])
        self.guard_rejects("UPDATE notifications_aftercareemail SET report_id=NULL,order_id=%s,version=version+1 WHERE id=%s",
                           [order.pk.hex, queued.pk.hex])
        with self.assertRaises(DatabaseError) as error, transaction.atomic():
            AftercareEmail.objects.create(**defaults)
        self.assertEqual(error.exception.args[0], 1062)

    def test_report_notice_insert_all_four_native_targets_cannot_use_counterpart_or_other_anchor(self):
        targets = self.four_targets()
        for kind, target in targets.items():
            report = self.target_report(kind, target)
            self.transition_report(report, "resolve")
            event = self.status_event(report)
            notice_target = aftercare_events.report_notice_target(report)
            wrong_kind = "product" if kind != "product" else "order"
            with self.subTest(kind=kind):
                self.assert_native_reject(lambda: Notice.construction.create(
                    event=event, account=self.other_buyer.account, **notice_target
                ))
                self.assert_native_reject(lambda: Notice.construction.create(
                    event=event, account=self.buyer.account, **{wrong_kind + "_id": targets[wrong_kind].pk}
                ))
                self.assert_native_reject(lambda: Event.construction.create(
                    kind="report_status", report=report, report_version=report.version + 1
                ))

    def test_report_email_stale_claim_and_dispatch_leases_keep_existing_fencing(self):
        report = self.target_report("product", self.product)
        self.transition_report(report, "resolve")
        queued = AftercareEmail.objects.get(episode=self.status_event(report).pk)
        self.make_due(queued)
        token = aftercare_events.claim(queued.pk)
        self.assertIsNone(aftercare_events.claim(queued.pk))
        self.assertIsNone(aftercare_events.prepare(queued.pk, uuid.uuid4()))
        self.assertIsNotNone(aftercare_events.prepare(queued.pk, token))
        self.assertEqual(aftercare_events.finish(queued.pk, uuid.uuid4(), "captured", "adapter_accepted"), "dispatching")
        queued.refresh_from_db()
        with patch("apps.notifications.aftercare_events.timezone.now", return_value=queued.lease_until + timedelta(seconds=1)):
            self.assertIsNone(aftercare_events.claim(queued.pk))
        queued.refresh_from_db()
        self.assertEqual(queued.status, "delivery_unknown")
        self.assertEqual(aftercare_events.dispatch(queued.pk), "delivery_unknown")
        self.assertEqual(len(mail.outbox), 0)

    def test_expired_report_claim_cannot_prepare_and_reclaim_fences_old_token(self):
        report = self.target_report("product", self.product)
        self.transition_report(report, "resolve")
        queued = AftercareEmail.objects.get(episode=self.status_event(report).pk)
        self.make_due(queued)
        old_token = aftercare_events.claim(queued.pk)
        queued.refresh_from_db()
        with patch("apps.notifications.aftercare_events.timezone.now", return_value=queued.lease_until + timedelta(seconds=1)):
            self.assertIsNone(aftercare_events.prepare(queued.pk, old_token))
            new_token = aftercare_events.claim(queued.pk)
            self.assertIsNotNone(new_token)
            self.assertNotEqual(old_token, new_token)
            self.assertIsNone(aftercare_events.prepare(queued.pk, old_token))
        self.assertEqual(len(mail.outbox), 0)

    def test_report_native_recipient_requires_fresh_verification_for_every_target(self):
        cases = []
        for kind, target in self.four_targets().items():
            report = self.target_report(kind, target)
            self.transition_report(report, "resolve")
            cases.append((report, self.status_event(report)))
        User.objects.filter(pk=self.buyer.user.pk).update(email_verified=False)
        for report, event in cases:
            with self.subTest(kind=report.target_kind):
                self.assert_native_reject(lambda: Notice.construction.create(
                    event=event, account_id=report.reporter_id, **aftercare_events.report_notice_target(report)
                ))
                queued = AftercareEmail.objects.get(episode=event.pk)
                self.assert_native_reject(lambda: AftercareEmail.objects.create(
                    report=report, account_id=report.reporter_id, episode=event.pk,
                    identity_digest=queued.identity_digest, due_at=timezone.now()
                ))

    def test_read_report_status_replay_after_optin_never_creates_email(self):
        notifications.set_preference(self.buyer, {
            "message_email": True, "aftercare_email": False, "locale": "en", "version": 0,
        })
        report = self.target_report("product", self.product)
        self.transition_report(report, "resolve")
        event = self.status_event(report)
        notifications.read_notice(self.buyer, Notice.objects.get(event=event).pk)
        notifications.set_preference(self.buyer, {
            "message_email": True, "aftercare_email": True, "locale": "en", "version": 1,
        })
        notifications.report_status(report)
        self.assertFalse(AftercareEmail.objects.filter(episode=event.pk).exists())
        self.assert_native_reject(lambda: AftercareEmail.objects.create(
            report=report, account=self.buyer.account, episode=event.pk,
            identity_digest=aftercare_events.report_identity_digest(self.buyer.account, report), due_at=timezone.now()
        ))

    def test_original_aftercare_order_intent_and_report_intent_remain_separate_and_capture(self):
        order = self.accept("advance")
        self.cancel(order)
        aftercare_events.sweep_notices()
        old = AftercareEmail.objects.get(order=order)
        self.assertIsNone(old.report_id)
        report = self.target_report("order", order)
        self.transition_report(report, "resolve")
        new = AftercareEmail.objects.get(report=report)
        self.assertIsNone(new.order_id)
        self.make_due(old)
        self.make_due(new)
        self.assertEqual(aftercare_events.dispatch(old.pk), "captured")
        self.assertIn(f"/account/seller/aftercare/{order.pk}", mail.outbox[0].body)
        self.assertEqual(aftercare_events.dispatch(new.pk), "captured")
        self.assertTrue(mail.outbox[1].body.endswith("/account/buyer/notifications"))
