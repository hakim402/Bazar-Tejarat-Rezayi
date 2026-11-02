"""Phase 9 real-grant privacy, history, delivery and PostgreSQL race acceptance."""
from django.db import DatabaseError as WakeFailure

import io
import json
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier, Event as ThreadEvent
from types import SimpleNamespace
from unittest.mock import patch
from django.apps import apps
from django.contrib.auth.models import Group, Permission
from django.core import mail
from django.core.files.storage import storages
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import DatabaseError, connections, transaction, connection
from django.test import TestCase, TransactionTestCase, SimpleTestCase, override_settings
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from django.utils import timezone
from PIL import Image
from rest_framework.test import APIClient
from rest_framework.exceptions import ValidationError, NotFound, PermissionDenied
from django.http import Http404
from apps.accounts.models import User, Account, ContextGrant
from apps.organizations.access import Actor
from apps.organizations.models import BusinessProfile, Membership
from apps.verification.models import ReviewCase
from apps.messaging import services, access, queries, media, cases
from apps.messaging.models import Conversation, Message, Attachment, ReadState, Command, Report, CaseAccess, CaseEvent
from apps.notifications import services as notices, delivery
from apps.notifications.models import Event, Notice, Outbox, Preference, Attempt
from tests.test_catalogue import CatalogueFixture, image_file
from tests.test_identity import PASSWORD, signin
from tests.test_staff_admin import admin_signin, admin_post


def command(body="Synthetic private message", **extra):
    return {"command_id": uuid.uuid4(), "body": body, "images": [], **extra}


def request_actor(client, context, user):
    return Actor(
        SimpleNamespace(user=user, session=client.session, META={"REMOTE_ADDR": "127.0.0.1"}, request_id=uuid.uuid4()),
        context,
    )


class MessagingFixture(CatalogueFixture):
    def setUp(self):
        super().setUp()
        ReviewCase.objects.filter(profile=self.profile).update(
            snapshot={"display_name": "Reviewed synthetic seller", "contact_phone": "NEVER-PUBLIC-CONTACT"}
        )
        self.publish(self.save())
        self.grants.stop()
        self.reviewer_client = APIClient(enforce_csrf_checks=True)
        admin_signin(self.reviewer_client, self.reviewer.user)
        self.reviewer = request_actor(self.reviewer_client, "staff", self.reviewer.user)
        self.seller_account = self.seller.request.account
        self.seller_client = APIClient(enforce_csrf_checks=True)
        signin(self.seller_client, "seller", self.seller.user.email)
        self.seller = request_actor(self.seller_client, "seller", self.seller.user)
        self.buyer, self.buyer_client = self.connected("buyer", "message-buyer")
        self.other_buyer, self.other_client = self.connected("buyer", "other-message-buyer")
        self.group = Group.objects.create(name="Synthetic communication roles")
        self.group.permissions.set(
            Permission.objects.filter(content_type__app_label__in=["messaging", "notifications"])
        )
        self.staff, self.staff_client = self.connected("staff", "message-staff", group=self.group)
        self.root, self.root_client = self.connected("owner", "message-root")

    def connected(self, context, name, group=None):
        user = User.objects.create_user(
            name + "@example.test",
            PASSWORD,
            display_name="Synthetic " + name,
            email_verified=True,
            is_staff=context in {"staff", "owner"},
            is_superuser=context == "owner",
        )
        if context != "owner":
            Account.objects.create(user=user, context=context)
        if group:
            user.groups.add(group)
        client = APIClient(enforce_csrf_checks=True)
        if context in {"owner", "staff"}:
            admin_signin(client, user)
        else:
            signin(client, context, user.email)
        return request_actor(client, context, user), client

    def enquire(self, actor=None, **extra):
        return services.create_enquiry(actor or self.buyer, command(product=self.product.pk, locale="en", **extra))

    def room(self):
        value = self.enquire()
        return Conversation.objects.get(pk=value["conversation"])

    def post(self, client, path, data, method="post", format="json"):
        token = client.get("/api/v1/auth/csrf/").json()["csrf_token"]
        return getattr(client, method)("/api/v1/" + path, data, format=format, HTTP_X_CSRFTOKEN=token)

    def company(self, name="company"):
        profile = BusinessProfile.objects.create(
            account=self.seller.account, kind="company", display_name="Synthetic " + name
        )
        Membership.objects.create(
            company=profile, account=self.seller.account, is_owner=True, bundles=["messaging", "catalogue"]
        )
        ReviewCase.objects.create(profile=profile, status="approved", snapshot={"display_name": "Reviewed company"})
        from apps.catalogue import services as catalogue
        from apps.catalogue.media import upload as catalogue_upload
        from apps.catalogue.models import Product, ProductImage

        created = catalogue.create(self.seller, {"seller": profile.pk, "currency": "AFN", "pricing_mode": "fixed"})
        self.product = Product.objects.get(pk=created["id"])
        uploaded = catalogue_upload(self.seller, self.product.pk, self.product.version, image_file())
        self.image = ProductImage.objects.get(pk=uploaded["id"])
        self.body["images"] = [{"id": str(self.image.pk), "alt": "Synthetic company product", "variant": None}]
        self.publish(self.save())
        return profile

    def due(self):
        # An operational update increments the protected outbox version.
        for row in Outbox.objects.all():
            row.due_at = timezone.now() - timedelta(seconds=1)
            row.version += 1
            row.save()


@override_settings(OWNER_MFA_REQUIRED=False)
class MessagingTests(MessagingFixture, TestCase):
    def test_atomic_enquiry_same_command_and_existing_thread_no_repost(self):
        data = command(
            "Call +93700000000 or me@example.test <script>safe plain text</script>",
            product=self.product.pk,
            locale="en",
        )
        first = services.create_enquiry(self.buyer, data)
        self.assertEqual(services.create_enquiry(self.buyer, data), first)
        self.assertEqual(
            (
                Conversation.objects.count(),
                Message.objects.count(),
                Event.objects.count(),
                Notice.objects.count(),
                Outbox.objects.count(),
            ),
            (1, 1, 1, 1, 1),
        )
        with self.assertRaises(services.CommandConflict):
            services.create_enquiry(self.buyer, {**data, "body": "different"})
        with self.assertRaises(services.ConversationExists):
            self.enquire()
        self.assertEqual(Message.objects.count(), 1)
        snapshot = Conversation.objects.get().snapshot
        self.assertNotIn("NEVER", json.dumps(snapshot))
        self.assertNotIn("contact", json.dumps(snapshot))
        self.assertEqual(snapshot["currency"], "AFN")

    def test_private_api_guest_wrong_context_cross_buyer_and_unknown_ids(self):
        room = self.room()
        path = f"/api/v1/messaging/buyer/conversations/{room.pk}/"
        self.assertIn(APIClient().get(path).status_code, [401, 403])
        self.assertEqual(self.other_client.get(path).status_code, 404)
        self.assertEqual(self.seller_client.get(path).status_code, 403)
        self.assertEqual(self.buyer_client.get(path).status_code, 200)
        self.assertEqual(self.buyer_client.get(f"/api/v1/messaging/staff/conversations/{room.pk}/").status_code, 404)
        for suffix in ["?before=0", "?after=-1", "?limit=51", "?after=1&before=2", "?q=private", "?after=1&after=2"]:
            self.assertEqual(
                self.buyer_client.get(f"/api/v1/messaging/buyer/conversations/{room.pk}/messages/{suffix}").status_code,
                400,
            )
        self.assertEqual(self.other_client.get("/api/v1/notifications/buyer/unread/").json()["unread_notices"], 0)
        self.assertEqual(self.seller_client.get("/api/v1/notifications/buyer/unread/").status_code, 403)

    def test_guest_enquiry_no_creation_and_self_wrong_role_ineligible_denied(self):
        data = command(product=self.product.pk)
        self.assertIn(
            self.post(APIClient(enforce_csrf_checks=True), "messaging/buyer/enquiries/", data).status_code, [401, 403]
        )
        self.assertEqual(self.post(self.seller_client, "messaging/buyer/enquiries/", data).status_code, 403)
        linked = Account.objects.create(user=self.seller.user, context="buyer")
        client = APIClient()
        signin(client, "buyer", linked.user.email)
        self.assertEqual(self.post(client, "messaging/buyer/enquiries/", data).status_code, 400)
        ReviewCase.objects.filter(profile=self.profile).update(status="rejected")
        self.assertEqual(self.post(self.buyer_client, "messaging/buyer/enquiries/", data).status_code, 404)
        self.assertEqual(Conversation.objects.count(), 0)

    def test_send_replay_mismatch_and_transaction_rollback_no_event(self):
        room = self.room()
        data = command("Reply")
        first = services.send(self.seller, room.pk, data)
        self.assertEqual(services.send(self.seller, room.pk, data), first)
        with self.assertRaises(services.CommandConflict):
            services.send(self.seller, room.pk, {**data, "body": "changed"})
        counts = (Message.objects.count(), Event.objects.count(), Notice.objects.count())
        with self.assertRaises(RuntimeError), transaction.atomic():
            services.send(self.seller, room.pk, command("rolled back"))
            raise RuntimeError()
        self.assertEqual(counts, (Message.objects.count(), Event.objects.count(), Notice.objects.count()))

    def test_broker_outage_does_not_undo_committed_message(self):
        with (
            self.captureOnCommitCallbacks(execute=True),
            patch("apps.runtime.jobs.enqueue", side_effect=WakeFailure("NO-PRIVATE-LOG")),
        ):
            room = self.room()
        self.assertEqual(room.messages.count(), 1)
        self.assertEqual(Outbox.objects.count(), 1)
        self.due()
        delivery.sweep()
        self.assertEqual(Outbox.objects.get().status, "captured")

    def test_monotonic_receipt_reads_never_acknowledge_unreturned_new_messages(self):
        room = self.room()
        history = queries.history(self.seller, room.pk)
        services.send(self.buyer, room.pk, command("Arrived after page"))
        services.acknowledge(self.seller, room.pk, {"sequence": 1, "receipt": history["receipt"]})
        state = ReadState.objects.get(account=self.seller.account, conversation=room)
        self.assertEqual((state.last_read, state.latest_incoming), (1, 2))
        with self.assertRaises(ValidationError):
            services.acknowledge(self.seller, room.pk, {"sequence": 2, "receipt": history["receipt"]})
        other = services.create_enquiry(self.other_buyer, command(product=self.product.pk))
        with self.assertRaises(ValidationError):
            services.acknowledge(self.seller, other["conversation"], {"sequence": 1, "receipt": history["receipt"]})
        self.assertEqual(notices.counts(self.seller)["unread_threads"], 2)
        self.assertEqual(queries.inbox(self.seller, unread=True)["count"], 2)

    def test_unknown_initial_upload_product_is_404_before_storage(self):
        with patch("apps.messaging.media.storages") as backends:
            response = self.post(
                self.buyer_client,
                f"messaging/buyer/enquiries/{uuid.uuid4()}/uploads/",
                {"command_id": str(uuid.uuid4()), "file": image_file()},
                format="multipart",
            )
        self.assertEqual(response.status_code, 404)
        backends.__getitem__.assert_not_called()
        self.assertEqual(Attachment.objects.count(), 0)

    def test_four_language_branded_email_has_no_conversation_preview(self):
        room = self.room()
        from apps.accounts.delivery import assemble_message
        from apps.accounts.models import ActionToken, AccountMail

        before = (ActionToken.objects.count(), AccountMail.objects.count())
        for locale in ["fa-AF", "ps", "ar", "en"]:
            with self.subTest(locale=locale):
                rendered = delivery.rendered(self.seller.account, room, locale)
                subject, text, html = rendered
                self.assertIn(f'lang="{locale}"', html)
                self.assertIn('dir="ltr"' if locale == "en" else 'dir="rtl"', html)
                self.assertIn(f"/{locale}/account/seller/messages/{room.pk}?seller={room.seller_id}", text)
                for secret in [
                    room.messages.first().body,
                    "NEVER-PUBLIC-CONTACT",
                    "messages/private-internal-object.jpg",
                    "attachments/private-internal-object",
                ]:
                    self.assertNotIn(secret, subject + text + html)
                message = assemble_message(rendered, self.seller.user.email, locale)
                self.assertEqual(len(message.attachments), 1)
                self.assertEqual(message.attachments[0]["Content-ID"], "<rezayi-brand>")
        self.assertEqual((ActionToken.objects.count(), AccountMail.objects.count()), before)

    def test_product_approval_loss_retains_snapshot_history_but_denies_send_upload(self):
        room = self.room()
        ReviewCase.objects.filter(profile=self.profile).update(status="rejected")
        self.assertFalse(queries.detail(self.buyer, room.pk)["can_send"])
        self.assertEqual(queries.history(self.buyer, room.pk)["latest"], 1)
        with self.assertRaises(ValidationError):
            services.send(self.buyer, room.pk, command())
        with self.assertRaises(ValidationError):
            media.upload(self.buyer, room.pk, uuid.uuid4(), image_file())
        self.assertEqual(Message.objects.count(), 1)

    def test_context_grant_identity_epoch_account_revocation(self):
        room = self.room()
        grant = self.buyer.request.session["grants"]["buyer"]["grant_id"]
        ContextGrant.objects.filter(pk=grant).update(revoked=True)
        self.assertEqual(self.buyer_client.get("/api/v1/messaging/buyer/conversations/").status_code, 403)
        self.assertEqual(self.buyer_client.get("/api/v1/notifications/buyer/unread/").status_code, 403)
        self.assertEqual(Message.objects.filter(conversation=room).count(), 1)
        User.objects.filter(pk=self.seller.user.pk).update(is_active=False)
        self.assertEqual(self.seller_client.get("/api/v1/messaging/seller/conversations/").status_code, 403)

    def test_company_messaging_only_members_personal_reads_and_fresh_revocation(self):
        company = self.company()
        member, client = self.connected("seller", "messaging-only")
        member2, _ = self.connected("seller", "second-messaging-member")
        nonmember, noclient = self.connected("seller", "fulfilment-only")
        m = Membership.objects.create(company=company, account=member.account, bundles=["messaging"])
        Membership.objects.create(company=company, account=member2.account, bundles=["messaging"])
        Membership.objects.create(company=company, account=nonmember.account, bundles=["fulfilment"])
        room = self.room()
        self.assertEqual(client.get(f"/api/v1/messaging/seller/conversations/{room.pk}/").status_code, 200)
        self.assertEqual(noclient.get(f"/api/v1/messaging/seller/conversations/{room.pk}/").status_code, 404)
        h = queries.history(member, room.pk)
        services.acknowledge(member, room.pk, {"sequence": 1, "receipt": h["receipt"]})
        self.assertEqual(notices.counts(member)["unread_threads"], 0)
        self.assertEqual(notices.counts(member2)["unread_threads"], 1)
        m.bundles = ["fulfilment"]
        m.save()
        self.assertEqual(client.get(f"/api/v1/messaging/seller/conversations/{room.pk}/").status_code, 404)
        self.assertEqual(client.get("/api/v1/notifications/seller/unread/").json()["unread_notices"], 0)
        with self.assertRaises((NotFound, Http404)):
            services.send(member, room.pk, command())

    def test_old_company_account_reference_does_not_restore_revoked_owner_history(self):
        company = self.company()
        room = self.room()
        Membership.objects.filter(company=company, account=self.seller.account).update(active=False)
        with self.assertRaises((NotFound, Http404)):
            queries.history(self.seller, room.pk)

    def test_private_images_reencode_bind_replay_head_and_cross_scope(self):
        room = self.room()
        raw = io.BytesIO()
        image = Image.new("RGB", (64, 48), "blue")
        exif = image.getexif()
        exif[270] = "PRIVATE-GPS-METADATA"
        image.save(raw, format="JPEG", exif=exif)
        key = uuid.uuid4()

        def upload():
            return SimpleUploadedFile("PRIVATE-FILENAME.jpg", raw.getvalue(), content_type="image/jpeg")

        result = media.upload(self.buyer, room.pk, key, upload())
        self.assertEqual(media.upload(self.buyer, room.pk, key, upload()), result)
        stored = Attachment.objects.get(pk=result["id"])
        self.assertNotIn(b"PRIVATE", storages[stored.storage_alias].open(stored.key).read())
        with self.assertRaises((NotFound, Http404)):
            access.participant_attachment(self.seller, stored.pk)
        with self.assertRaises((NotFound, Http404)):
            access.participant_attachment(self.other_buyer, stored.pk)
        services.send(self.buyer, room.pk, command("", images=[stored.pk]))
        self.assertEqual(access.participant_attachment(self.seller, stored.pk).pk, stored.pk)
        response = self.seller_client.head(f"/api/v1/messaging/seller/attachments/{stored.pk}/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, b"")
        self.assertIn("no-store", response["Cache-Control"])
        self.assertEqual(response["X-Content-Type-Options"], "nosniff")
        with self.assertRaises(ValidationError):
            services.send(self.buyer, room.pk, command("", images=[stored.pk]))
        with patch("apps.foundation.storage.FileLocation.open", side_effect=OSError("DO-NOT-EXPOSE")):
            response = self.seller_client.get(f"/api/v1/messaging/seller/attachments/{stored.pk}/")
            self.assertEqual(response.status_code, 503)
            self.assertNotIn(b"DO-NOT", response.content)

    def test_initial_image_only_enquiry_and_foreign_binding_denied(self):
        staged = media.upload(self.buyer, self.product.pk, uuid.uuid4(), image_file(), enquiry=True)
        value = services.create_enquiry(
            self.buyer, command("", product=self.product.pk, images=[uuid.UUID(staged["id"])])
        )
        self.assertEqual(Conversation.objects.get(pk=value["conversation"]).messages.first().body, "")
        other = media.upload(self.other_buyer, self.product.pk, uuid.uuid4(), image_file(), enquiry=True)
        with self.assertRaises(ValidationError):
            services.send(self.buyer, value["conversation"], command("", images=[uuid.UUID(other["id"])]))

    def test_image_real_type_animation_bounds_and_body_controls(self):
        room = self.room()
        files = [
            SimpleUploadedFile("fake.jpg", b"<svg/>", content_type="image/jpeg"),
            SimpleUploadedFile("big.png", b"x" * (media.MAX_BYTES + 1)),
        ]
        animated = io.BytesIO()
        Image.new("RGB", (40, 40), "red").save(
            animated,
            format="PNG",
            save_all=True,
            append_images=[Image.new("RGB", (40, 40), "blue")],
            duration=100,
            loop=0,
        )
        files.append(SimpleUploadedFile("animated.png", animated.getvalue()))
        for file in files:
            with self.assertRaises(ValidationError):
                media.upload(self.buyer, room.pk, uuid.uuid4(), file)
        for body in ["", "x" * 6001, "unsafe\u202etext"]:
            self.assertEqual(
                self.post(
                    self.buyer_client, f"messaging/buyer/conversations/{room.pk}/messages/", command(body)
                ).status_code,
                400,
            )
        self.assertEqual(Attachment.objects.count(), 0)

    def test_database_rejects_message_body_delete_retarget_and_bound_file_mutations(self):
        room = self.room()
        msg = room.messages.first()
        for operation in [
            lambda: Message.objects.filter(pk=msg.pk).update(body="rewritten"),
            lambda: Message.objects.filter(pk=msg.pk).delete(),
            lambda: Conversation.objects.filter(pk=room.pk).update(snapshot={}),
            lambda: Command.objects.all().update(outcome={}),
        ]:
            with self.assertRaises(DatabaseError), transaction.atomic():
                operation()
        staged = media.upload(self.buyer, room.pk, uuid.uuid4(), image_file())
        services.send(self.buyer, room.pk, command("", images=[uuid.UUID(staged["id"])]))
        for operation in [
            lambda: Attachment.objects.filter(pk=staged["id"]).update(message=None),
            lambda: Attachment.objects.filter(pk=staged["id"]).delete(),
        ]:
            with self.assertRaises(DatabaseError), transaction.atomic():
                operation()

    def test_report_replay_survives_real_throttle_without_collapsing_distinct_intents(self):
        from apps.accounts.models import RateBucket

        message = self.room().messages.first()
        path = f"messaging/buyer/messages/{message.pk}/reports/"
        packet = {"command_id": str(uuid.uuid4()), "category": "privacy", "reason": "Synthetic durable report"}
        original = self.post(self.buyer_client, path, packet)
        self.assertEqual(original.status_code, 201)
        for _ in range(9):
            replay = self.post(self.buyer_client, path, packet)
            self.assertEqual(replay.status_code, 201)
            self.assertEqual(replay.json(), original.json())
        throttled = self.post(self.buyer_client, path, packet)
        self.assertEqual(throttled.status_code, 429)
        self.assertEqual(Report.objects.filter(message=message).count(), 1)
        self.assertEqual(CaseEvent.objects.filter(report__message=message, action="reported").count(), 1)
        RateBucket.objects.all().delete()  # This test's isolated database only.
        reconciled = self.post(self.buyer_client, path, packet)
        self.assertEqual(reconciled.status_code, 201)
        self.assertEqual(reconciled.json(), original.json())
        conflict = self.post(self.buyer_client, path, {**packet, "reason": "Changed synthetic payload"})
        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(Report.objects.filter(message=message).count(), 1)
        distinct = self.post(self.buyer_client, path, {**packet, "command_id": str(uuid.uuid4())})
        self.assertEqual(distinct.status_code, 201)
        self.assertNotEqual(distinct.json()["id"], original.json()["id"])
        self.assertEqual(Report.objects.filter(message=message).count(), 2)
        self.assertEqual(CaseEvent.objects.filter(report__message=message, action="reported").count(), 2)

    def test_reporting_case_assignment_inspection_audit_and_closed_denial(self):
        room = self.room()
        msg = room.messages.first()
        data = {"command_id": uuid.uuid4(), "category": "privacy", "reason": "Synthetic participant report"}
        result = services.report(self.buyer, msg.pk, data)
        self.assertEqual(services.report(self.buyer, msg.pk, data), result)
        case = Report.objects.get(pk=result["id"])
        with self.assertRaises(NotFound):
            cases.inspect(self.staff, case.pk)
        with self.assertRaises((Http404, NotFound)):
            services.report(self.other_buyer, msg.pk, data)
        cases.transition(
            self.root,
            case.pk,
            version=1,
            action="assign",
            reason="Independent assignment",
            assigned_to=self.staff.account.pk,
        )
        value = cases.inspect(self.staff, case.pk)
        self.assertEqual(value["messages"][0]["body"], msg.body)
        self.assertEqual(CaseAccess.objects.filter(report=case).count(), 1)
        with patch("apps.messaging.cases.CaseAccess.objects.create", side_effect=RuntimeError("audit unavailable")):
            with self.assertRaises(RuntimeError):
                cases.inspect(self.staff, case.pk)
        self.assertEqual(ReadState.objects.get(account=self.seller.account, conversation=room).last_read, 0)
        cases.transition(self.staff, case.pk, version=2, action="resolve", reason="Reviewed synthetic report")
        with self.assertRaises(NotFound):
            cases.inspect(self.root, case.pk)
        self.assertTrue(Notice.objects.filter(event__kind="report_status", account=self.buyer.account).exists())
        cases.transition(self.root, case.pk, version=3, action="reopen", reason="Additional review required")
        case.refresh_from_db()
        self.assertEqual((case.status, case.assigned_to_id), ("open", None))
        with self.assertRaises(services.CommandConflict):
            cases.transition(self.root, case.pk, version=1, action="assign", reason="Stale assignment")

    def test_root_requires_real_open_case_and_cannot_decide_own_report(self):
        room = self.room()
        with self.assertRaises((Http404, NotFound)):
            cases.inspect(self.root, uuid.uuid4())
        Account.objects.create(user=self.root.user, context="buyer")
        buyer_client = APIClient()
        signin(buyer_client, "buyer", self.root.user.email)
        buyer_actor = request_actor(buyer_client, "buyer", self.root.user)
        value = self.enquire(buyer_actor)
        own_room = Conversation.objects.get(pk=value["conversation"])
        report = services.report(
            buyer_actor,
            own_room.messages.first().pk,
            {"command_id": uuid.uuid4(), "category": "other", "reason": "Own participant report"},
        )
        with self.assertRaises(PermissionDenied):
            cases.transition(self.root, report["id"], version=1, action="resolve", reason="Cannot decide own report")
        self.assertEqual(Report.objects.get(pk=report["id"]).status, "open")
        self.assertEqual(room.sequence, 1)

    def test_native_admin_metadata_has_no_bodies_or_arbitrary_crud(self):
        room = self.room()
        msg = room.messages.first()
        result = services.report(
            self.buyer, msg.pk, {"command_id": uuid.uuid4(), "category": "other", "reason": "Synthetic report"}
        )
        self.assertEqual(self.staff_client.get(reverse("admin:messaging_message_changelist")).status_code, 403)
        for label in ["messaging", "notifications"]:
            for model in apps.get_app_config(label).get_models():
                response = self.root_client.get(reverse(f"admin:{label}_{model._meta.model_name}_changelist"))
                self.assertEqual(response.status_code, 200, (model, response.content[:200]))
                self.assertNotContains(response, msg.body)
        path = reverse("admin:messaging_report_case", args=[result["id"]])
        self.assertNotContains(self.staff_client.get(path), msg.body)
        cases.transition(
            self.root,
            result["id"],
            version=1,
            action="assign",
            reason="Synthetic independent assignment",
            assigned_to=self.staff.account.pk,
        )
        self.assertContains(self.staff_client.get(path), msg.body)
        self.staff.user.groups.clear()
        self.assertEqual(self.staff_client.get(path).status_code, 404)
        self.assertEqual(admin_post(self.root_client, reverse("admin:messaging_report_add"), {}).status_code, 403)

    def test_notice_scopes_idempotent_read_and_optional_preference_version(self):
        room = self.room()
        notice = Notice.objects.get(account=self.seller.account)
        self.assertEqual(self.post(self.buyer_client, f"notifications/buyer/{notice.pk}/read/", {}).status_code, 404)
        self.assertEqual(self.post(self.seller_client, f"notifications/seller/{notice.pk}/read/", {}).status_code, 200)
        self.assertEqual(self.post(self.seller_client, f"notifications/seller/{notice.pk}/read/", {}).status_code, 200)
        self.assertEqual(notices.counts(self.seller), {"unread_notices": 0, "unread_threads": 1})
        result = notices.set_preference(self.seller, {"message_email": False, "locale": "ps", "version": 0})
        self.assertEqual(result["version"], 1)
        with self.assertRaises(services.CommandConflict):
            notices.set_preference(self.seller, {"message_email": True, "locale": "en", "version": 0})
        self.assertNotIn("body", json.dumps(notices.notices(self.seller), default=str))
        self.assertEqual(room.sequence, 1)

    def test_debounce_one_email_per_unread_episode_and_cooldown(self):
        room = self.room()
        self.assertEqual(delivery.dispatch(Outbox.objects.get().pk), "queued")
        services.send(self.buyer, room.pk, command("More unread activity"))
        self.assertEqual(Outbox.objects.count(), 1)
        self.due()
        self.assertEqual(delivery.dispatch(Outbox.objects.get().pk), "captured")
        self.assertEqual(len(mail.outbox), 1)
        delivery.sweep()
        self.assertEqual(len(mail.outbox), 1)
        text = mail.outbox[0].body
        self.assertNotIn("More unread", text)
        self.assertNotIn("Synthetic private message", text)
        self.assertNotIn("NEVER", text)
        h = queries.history(self.seller, room.pk)
        services.acknowledge(self.seller, room.pk, {"sequence": 2, "receipt": h["receipt"]})
        services.send(self.buyer, room.pk, command("New episode"))
        self.assertEqual(Outbox.objects.count(), 2)
        self.assertGreater(
            Outbox.objects.order_by("-created_at").first().due_at, timezone.now() + timedelta(minutes=14)
        )

    def test_read_optout_identity_change_and_claim_delay_revocation_cancel_mail(self):
        for scenario in ["read", "optout", "email", "revocation"]:
            with self.subTest(scenario=scenario):
                # Distinct buyer gives a new thread and independent outbox episode.
                actor, _ = self.connected("buyer", "cancel-" + scenario)
                room_id = self.enquire(actor)["conversation"]
                room = Conversation.objects.get(pk=room_id)
                row = Outbox.objects.get(conversation=room)
                row.due_at = timezone.now() - timedelta(seconds=1)
                row.version += 1
                row.save()

                def change(_):
                    if scenario == "read":
                        h = queries.history(self.seller, room.pk)
                        services.acknowledge(self.seller, room.pk, {"sequence": 1, "receipt": h["receipt"]})
                    elif scenario == "optout":
                        Preference.objects.update_or_create(
                            account=self.seller.account, defaults={"message_email": False}
                        )
                    elif scenario == "email":
                        User.objects.filter(pk=self.seller.user.pk).update(
                            email="changed-" + scenario + "@example.test"
                        )
                    else:
                        Account.objects.filter(pk=self.seller.account.pk).update(status="suspended")

                with patch("apps.notifications.delivery.before_dispatch", side_effect=change):
                    self.assertEqual(delivery.dispatch(row.pk), "cancelled")
                Preference.objects.all().delete()
                Account.objects.filter(pk=self.seller_account.pk).update(status="active")
                User.objects.filter(pk=self.seller.user.pk).update(email="seller@example.test")
                # Refresh the account's grants after deliberate epoch-changing fixture edits.
                signin(self.seller_client, "seller", "seller@example.test")
                self.seller = request_actor(self.seller_client, "seller", User.objects.get(pk=self.seller.user.pk))
        self.assertEqual(len(mail.outbox), 0)

    def test_definite_failure_retries_bounded_and_unknown_never_auto_resends(self):
        self.room()
        row = Outbox.objects.get()
        self.due()
        with patch("django.core.mail.EmailMultiAlternatives.send", side_effect=delivery.DefiniteDeliveryFailure):
            for expected in ["retry_due", "retry_due", "exhausted"]:
                self.assertEqual(delivery.dispatch(row.pk), expected)
                self.due()
        self.assertEqual(Attempt.objects.count(), 3)
        actor, _ = self.connected("buyer", "uncertain-buyer")
        room = self.enquire(actor)
        row = Outbox.objects.get(conversation_id=room["conversation"])
        self.due()
        with patch(
            "django.core.mail.EmailMultiAlternatives.send",
            side_effect=TimeoutError("possibly accepted private address"),
        ):
            self.assertEqual(delivery.dispatch(row.pk), "delivery_unknown")
        with patch("django.core.mail.EmailMultiAlternatives.send") as send:
            delivery.sweep()
            send.assert_not_called()
        row.refresh_from_db()
        with self.assertRaises(ValidationError):
            delivery.retry(self.root, row.pk, row.version, "Explicit retry", False)
        delivery.retry(self.root, row.pk, row.version, "Explicit retry with duplicate risk", True)
        self.assertEqual(delivery.dispatch(row.pk), "captured")

    def test_unknown_lease_recovery_and_report_history_are_retained(self):
        room = self.room()
        self.due()
        row = Outbox.objects.get()
        token = delivery.claim(row.pk)
        self.assertIsNotNone(token)
        delivery.prepare(row.pk, token)
        row.refresh_from_db()
        row.lease_until = timezone.now() - timedelta(seconds=1)
        row.version += 1
        row.save()
        self.assertEqual(delivery.dispatch(row.pk), "delivery_unknown")
        result = services.report(
            self.buyer,
            room.messages.first().pk,
            {"command_id": uuid.uuid4(), "category": "abuse", "reason": "Retained report"},
        )
        for operation in [
            lambda: Report.objects.filter(pk=result["id"]).update(message_id=uuid.uuid4()),
            lambda: CaseEvent.objects.all().delete(),
            lambda: Event.objects.all().delete(),
        ]:
            with self.assertRaises(DatabaseError), transaction.atomic():
                operation()

    def test_known_thread_reads_do_not_touch_unrelated_evidence_and_page_queries_are_bounded(self):
        room = self.room()
        with patch("apps.marketplace.access.storages") as backends:
            backends.__getitem__.return_value.exists.side_effect = OSError("Unrelated failure")
            queries.history(self.buyer, room.pk)
            notices.counts(self.seller)
            backends.__getitem__.assert_not_called()
        with CaptureQueriesContext(connection) as small:
            queries.history(self.buyer, room.pk)
        for index in range(55):
            services.send(self.buyer, room.pk, command(f"Synthetic page message {index}"))
        with CaptureQueriesContext(connection) as large:
            result = queries.history(self.buyer, room.pk, limit=20)
        self.assertTrue(result["has_more"])
        self.assertEqual(len(result["results"]), 20)
        self.assertLessEqual(len(large), len(small) + 1)
        print(
            f"Phase 9 history SQL: one message={len(small)}, 56 messages/page20={len(large)}; unrelated evidence storage calls=0"
        )
        # Grow another buyer's unrelated company/product/thread population without
        # replaying guarded publication setup; these are private fixture identities.
        from apps.catalogue.models import Product

        other_seller, _ = self.connected("seller", "unrelated-growth-seller")
        with CaptureQueriesContext(connection) as before_growth:
            baseline = queries.inbox(self.buyer)
            queries.history(self.buyer, room.pk, limit=20)
        profiles = BusinessProfile.objects.bulk_create(
            [
                BusinessProfile(account=other_seller.account, kind="company", display_name=f"Unrelated {i}")
                for i in range(30)
            ]
        )
        Membership.objects.bulk_create(
            [
                Membership(company=p, account=other_seller.account, is_owner=True, bundles=["messaging"])
                for p in profiles
            ]
        )
        products = Product.objects.bulk_create(
            [Product(seller=p, currency="AFN", pricing_mode="fixed") for p in profiles]
        )
        rooms = Conversation.objects.bulk_create(
            [
                Conversation(
                    buyer=self.other_buyer.account, seller=p, product=q, snapshot={"title": "Unrelated"}, sequence=1
                )
                for p, q in zip(profiles, products, strict=True)
            ]
        )
        inserted_messages = Message.objects.bulk_create(
            [
                Message(
                    published=connection.vendor != "mysql",
                    conversation=r,
                    sequence=1,
                    author=self.other_buyer.account,
                    context="buyer",
                    author_label="Unrelated buyer",
                    body="Unrelated private history",
                )
                for r in rooms
            ]
        )
        if connection.vendor == "mysql":
            Message.construction.filter(pk__in=[m.pk for m in inserted_messages]).update(published=True)
        with patch("apps.marketplace.access.storages") as backends, CaptureQueriesContext(connection) as after_growth:
            grown = queries.inbox(self.buyer)
            queries.history(self.buyer, room.pk, limit=20)
        backends.__getitem__.assert_not_called()
        self.assertEqual(grown, baseline)
        self.assertLessEqual(len(after_growth), len(before_growth) + 1)
        print(
            f"Phase 9 unrelated growth: 30 companies/products/threads/messages; scoped inbox+history SQL "
            f"{len(before_growth)} -> {len(after_growth)}; unrelated storage calls=0"
        )
        self.assertNotIn("storage_alias", json.dumps(result, default=str))

    def test_rate_and_aggregate_request_limits_without_message_side_effect(self):
        room = self.room()
        with patch(
            "apps.messaging.views.rate_limit",
            side_effect=__import__("apps.accounts.services", fromlist=["TooManyRequests"]).TooManyRequests(),
        ):
            response = self.post(self.buyer_client, f"messaging/buyer/conversations/{room.pk}/messages/", command())
            self.assertEqual(response.status_code, 429)
            self.assertEqual(response["Retry-After"], "900")
        response = self.post(
            self.buyer_client, f"messaging/buyer/conversations/{room.pk}/messages/", command("x" * 70000)
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(room.messages.count(), 1)

    def test_native_body_filter_oracles_and_generic_private_fields_are_denied(self):
        room = self.room()
        for path in [
            "/admin/messaging/message/?body__icontains=private",
            "/admin/messaging/conversation/?snapshot__title__contains=Synthetic",
            "/admin/notifications/outbox/?account__user__email__contains=example",
        ]:
            self.assertEqual(self.root_client.get(path).status_code, 400)
        path = reverse("admin:messaging_message_change", args=[room.messages.first().pk])
        self.assertNotContains(self.root_client.get(path), room.messages.first().body)
        self.assertEqual(admin_post(self.root_client, path, {"body": "Changed", "_save": "Save"}).status_code, 403)

    def test_reinstated_company_member_gets_no_old_email_replay_but_new_activity_can_notify(self):
        company = self.company()
        member, _ = self.connected("seller", "reinstated-notification-member")
        membership = Membership.objects.create(company=company, account=member.account, bundles=["messaging"])
        room = self.room()
        old = Outbox.objects.get(account=member.account, conversation=room)
        company.version += 1
        company.save(update_fields=["version"])
        membership.active = False
        membership.save(update_fields=["active"])
        membership.active = True
        membership.save(update_fields=["active"])
        self.due()
        self.assertEqual(delivery.dispatch(old.pk), "cancelled")
        services.send(self.buyer, room.pk, command("Newly authorized activity"))
        self.assertEqual(Outbox.objects.filter(account=member.account, conversation=room, status="queued").count(), 1)
        self.assertEqual(Notice.objects.filter(account=member.account, conversation=room).count(), 2)

    def test_reconcile_creation_and_send_after_publication_ends(self):
        data = command(product=self.product.pk)
        first = services.create_enquiry(self.buyer, data)
        sent = command("Committed before withdrawal")
        reply = services.send(self.seller, first["conversation"], sent)
        ReviewCase.objects.filter(profile=self.profile).update(status="rejected")
        self.assertEqual(services.create_enquiry(self.buyer, data), first)
        self.assertEqual(services.send(self.seller, first["conversation"], sent), reply)
        self.assertEqual(Message.objects.count(), 2)

    def test_expired_unbound_cleanup_retains_bound_history_and_unknown_files(self):
        from django.core.files.base import ContentFile

        room = self.room()
        image = media.upload(self.buyer, room.pk, uuid.uuid4(), image_file())
        services.send(self.buyer, room.pk, command("", images=[uuid.UUID(image["id"])]))
        bound = Attachment.objects.get(pk=image["id"])
        owned_key = f"messages/{uuid.uuid4().hex}.jpg"
        storages["private_local"].save(owned_key, ContentFile(b"expired synthetic"))
        expired = Attachment.objects.create(
            product=self.product,
            conversation=room,
            creator=self.buyer.account,
            key=owned_key,
            size=17,
            sha256="a" * 64,
            width=1,
            height=1,
            expires_at=timezone.now() - timedelta(days=1),
        )
        unknown_key = "messages/unrecorded-owner-file.jpg"
        storages["private_local"].save(unknown_key, ContentFile(b"retained unknown"))
        media.sweep_unbound()
        self.assertFalse(Attachment.objects.filter(pk=expired.pk).exists())
        self.assertFalse(storages["private_local"].exists(owned_key))
        self.assertTrue(storages["private_local"].exists(bound.key))
        self.assertTrue(storages["private_local"].exists(unknown_key))

    def test_protected_range_head_and_case_bytes_authorize_before_storage(self):
        room = self.room()
        image = media.upload(self.seller, room.pk, uuid.uuid4(), image_file())
        services.send(self.seller, room.pk, command("Protected image", images=[uuid.UUID(image["id"])]))
        path = f"/api/v1/messaging/buyer/attachments/{image['id']}/"
        response = self.buyer_client.get(path, HTTP_RANGE="bytes=0-9")
        self.assertEqual(response.status_code, 200)
        contents = b"".join(response.streaming_content)
        self.assertEqual(len(contents), image["size"])
        with patch("apps.foundation.storage.FileLocation.open") as opened:
            self.assertEqual(self.other_client.head(path).status_code, 404)
            opened.assert_not_called()
        report = services.report(
            self.buyer,
            room.messages.last().pk,
            {"command_id": uuid.uuid4(), "category": "privacy", "reason": "Protected file case"},
        )
        cases.transition(
            self.root,
            report["id"],
            version=1,
            action="assign",
            reason="Independent image reviewer",
            assigned_to=self.staff.account.pk,
        )
        download = reverse("admin:messaging_report_image", args=[report["id"], image["id"]])
        response = self.staff_client.head(download)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(CaseAccess.objects.filter(report_id=report["id"], action="image").count(), 1)
        with (
            patch("apps.messaging.cases.CaseAccess.objects.create", side_effect=RuntimeError("audit failure")),
            patch("apps.foundation.storage.FileLocation.open") as opened,
        ):
            self.assertEqual(self.staff_client.get(download).status_code, 500)
            opened.assert_not_called()

    def test_malformed_native_delivery_id_is_404_without_mutation(self):
        path = reverse("admin:notifications_outbox_change", args=["not-a-uuid"])
        before = (Outbox.objects.count(), Attempt.objects.count())
        response = admin_post(
            self.root_client,
            path,
            {
                "expected_version": 1,
                "retry_unknown": "on",
                "reason": "Synthetic scoped retry",
                "acknowledge_risk": "on",
                "_save": "Save",
            },
        )
        self.assertEqual(response.status_code, 404)
        self.assertEqual((Outbox.objects.count(), Attempt.objects.count()), before)

    def test_native_delivery_form_is_permission_scoped_and_audited(self):
        self.room()
        self.due()
        row = Outbox.objects.get()
        with patch("django.core.mail.EmailMultiAlternatives.send", side_effect=TimeoutError()):
            delivery.dispatch(row.pk)
        row.refresh_from_db()
        path = reverse("admin:notifications_outbox_change", args=[row.pk])
        self.assertEqual(self.staff_client.get(path).status_code, 200)
        response = admin_post(
            self.staff_client,
            path,
            {
                "expected_version": row.version,
                "retry_unknown": "on",
                "reason": "Operator reviewed duplicate risk",
                "acknowledge_risk": "on",
                "_save": "Save",
            },
        )
        self.assertEqual(response.status_code, 302)
        row.refresh_from_db()
        self.assertEqual(row.status, "queued")
        self.assertEqual(self.staff_client.get(reverse("admin:accounts_user_changelist")).status_code, 403)
        self.staff.user.groups.clear()
        self.assertEqual(
            admin_post(self.staff_client, path, {"expected_version": row.version, "retry_unknown": "on"}).status_code,
            403,
        )
        from apps.accounts.models import AuditEvent

        self.assertTrue(AuditEvent.objects.filter(actor=self.staff.user, action="message_delivery_retry").exists())

    def test_company_revocation_after_claim_and_sender_exclusion(self):
        company = self.company()
        member, _ = self.connected("seller", "recipient-member")
        membership = Membership.objects.create(company=company, account=member.account, bundles=["messaging"])
        room = self.room()
        self.due()
        row = Outbox.objects.get(account=member.account, conversation=room)
        with patch(
            "apps.notifications.delivery.before_dispatch",
            side_effect=lambda _: Membership.objects.filter(pk=membership.pk).update(active=False),
        ):
            self.assertEqual(delivery.dispatch(row.pk), "cancelled")
        self.assertFalse(
            Notice.objects.filter(account=self.buyer.account, event__message__author=self.buyer.account).exists()
        )
        self.assertEqual(notices.counts(member)["unread_notices"], 0)


@override_settings(OWNER_MFA_REQUIRED=False)
class MessagingConcurrencyTests(MessagingFixture, TransactionTestCase):
    def parallel(self, functions):
        barrier = Barrier(len(functions))

        def run(fn):
            try:
                barrier.wait(timeout=10)
                return fn()
            finally:
                connections.close_all()

        with ThreadPoolExecutor(len(functions)) as pool:
            return list(pool.map(run, functions))

    def test_concurrent_same_enquiry_and_same_send_have_one_durable_outcome(self):
        data = command(product=self.product.pk)
        result = self.parallel(
            [lambda: services.create_enquiry(self.buyer, data), lambda: services.create_enquiry(self.buyer, data)]
        )
        self.assertEqual(result[0], result[1])
        self.assertEqual(Message.objects.count(), 1)
        key = command("Concurrent send")
        pk = result[0]["conversation"]
        sent = self.parallel([lambda: services.send(self.seller, pk, key), lambda: services.send(self.seller, pk, key)])
        self.assertEqual(sent[0], sent[1])
        self.assertEqual(Message.objects.count(), 2)
        self.assertEqual(Event.objects.count(), 2)

    def test_distinct_enquiry_race_conflicts_without_duplicate_initial_message(self):
        def create():
            try:
                return self.enquire()["conversation"]
            except services.ConversationExists:
                return "exists"

        result = self.parallel([create, create])
        self.assertEqual(result.count("exists"), 1)
        self.assertEqual(Conversation.objects.count(), 1)
        self.assertEqual(Message.objects.count(), 1)

    def test_concurrent_workers_send_one_email(self):
        self.room()
        self.due()
        pk = Outbox.objects.get().pk
        result = self.parallel([lambda: delivery.dispatch(pk), lambda: delivery.dispatch(pk)])
        self.assertIn("captured", result)
        self.assertEqual(Outbox.objects.get().attempts, 1)
        self.assertEqual(len(mail.outbox), 1)

    def test_send_rechecks_membership_after_waiting_for_revocation_lock(self):
        company = self.company()
        member, _ = self.connected("seller", "barrier-member")
        membership = Membership.objects.create(company=company, account=member.account, bundles=["messaging"])
        room = self.room()
        locked = ThreadEvent()
        release = ThreadEvent()
        started = ThreadEvent()

        def revoke():
            try:
                with transaction.atomic():
                    BusinessProfile.objects.select_for_update().get(pk=company.pk)
                    locked.set()
                    release.wait(10)
                    Membership.objects.filter(pk=membership.pk).update(active=False)
            finally:
                connections.close_all()

        original_lock = access.lock_actor

        def lock_after_initial_scope(*args, **kwargs):
            # conversation(lock=True) has already resolved the initially valid
            # participant before this boundary; now wait for profile revocation.
            started.set()
            return original_lock(*args, **kwargs)

        def send():
            try:
                try:
                    with patch("apps.messaging.access.lock_actor", side_effect=lock_after_initial_scope):
                        services.send(member, room.pk, command("Must be denied"))
                    return "sent"
                except (NotFound, Http404):
                    return "denied"
            finally:
                connections.close_all()

        with ThreadPoolExecutor(2) as pool:
            a = pool.submit(revoke)
            self.assertTrue(locked.wait(10))
            b = pool.submit(send)
            self.assertTrue(started.wait(10))
            release.set()
            a.result(10)
            self.assertEqual(b.result(10), "denied")
        self.assertEqual(Message.objects.count(), 1)


class MessagingEvidenceTests(SimpleTestCase):
    def test_run_diagnostics_redact_session_and_csrf_headers(self):
        from scripts.run_tests import TestRun

        run = SimpleNamespace(generated={}, password="synthetic-fixture-password")
        value = TestRun.redact(
            run,
            "cookie: sessionid=private-session\nx-csrftoken: private-csrf\nSet-Cookie: private-cookie; HttpOnly\nordinary diagnostic",
        )
        for secret in ["private-session", "private-csrf", "private-cookie"]:
            self.assertNotIn(secret, value)
        self.assertIn("ordinary diagnostic", value)
