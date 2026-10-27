"""Retired URLs are absent even with an authenticated admin grant, including dynamic aliases."""

import json
from pathlib import Path
from django.test import TransactionTestCase
from rest_framework.test import APIClient
from apps.accounts.models import Account, User
from tests.test_identity import PASSWORD, signin, native_auth
from tests.test_staff_admin import role_user, admin_signin


class StaffRetirementTests(TransactionTestCase):
    def test_all_retired_adapters_are_404_for_every_actor_and_verb(self):
        owner = User.objects.create_superuser("retirement-owner@example.test", PASSWORD, email_verified=True)
        staff, _, _ = role_user(
            "retirement-staff",
            "verification",
            ["view_queue", "assign_review", "decide_review", "read_evidence", "review_transfer"],
        )
        clients = [APIClient()]
        for user in [owner, staff]:
            client = APIClient(enforce_csrf_checks=True)
            admin_signin(client, user)
            clients.append(client)
        for role in ["buyer", "seller"]:
            user = User.objects.create_user(f"retirement-{role}@example.test", PASSWORD, email_verified=True)
            Account.objects.create(user=user, context=role)
            client = APIClient(enforce_csrf_checks=True)
            signin(client, role, user.email)
            clients.append(client)
        pk = "00000000-0000-4000-8000-000000000001"
        paths = [
            "auth/mfa/enroll/",
            "auth/mfa/challenge/",
            "verification/queue/",
            f"verification/cases/{pk}/",
            "verification/transfers/",
            f"verification/transfers/{pk}/",
            "inventory/staff/shortages/",
            f"inventory/staff/shortages/{pk}/",
        ]
        for context in ["staff", "owner", "unknown"]:
            paths += [
                f"auth/{context}/{action}/"
                for action in ["signin", "session", "profile", "password", "logout", "mfa/reset"]
            ]
            paths += [
                f"catalogue/{context}/{action}/"
                for action in [
                    "products",
                    "taxonomy",
                    "units",
                    f"products/{pk}",
                    f"products/{pk}/actions",
                    f"products/{pk}/prices",
                    f"products/{pk}/images",
                    f"images/{pk}",
                    f"products/{pk}/translations/{pk}/en",
                ]
            ]
            paths += [
                f"verification/evidence/{context}/{pk}/",
                f"verification/{context}/profiles/{pk}/application/",
                f"verification/{context}/profiles/{pk}/evidence/",
            ]
            paths += [
                f"organizations/{context}/profiles/",
                f"organizations/{context}/profiles/{pk}/",
                f"organizations/{context}/profiles/{pk}/team/",
                f"organizations/{context}/profiles/{pk}/invitations/",
                f"organizations/{context}/profiles/{pk}/members/{pk}/",
                f"organizations/{context}/profiles/{pk}/transfers/",
            ]
        for client in clients:
            token = client.get("/api/v1/auth/csrf/").json()["csrf_token"]
            for path in paths:
                self.assertEqual(client.post("/api/v1/" + path, {}).status_code, 404, path)
                for verb in ["get", "post", "patch", "delete"]:
                    response = getattr(client, verb)("/api/v1/" + path, {}, HTTP_X_CSRFTOKEN=token)
                    self.assertEqual(response.status_code, 404, (path, verb))
                    self.assertIn("no-store", response["Cache-Control"])

    def test_old_pending_api_mfa_cannot_finish_through_native_admin(self):
        from apps.accounts.services import begin_signin

        staff, _, _ = role_user("old-pending", "verification", ["decide_review"])
        client = APIClient(enforce_csrf_checks=True)
        request = client.get("/api/v1/auth/csrf/").wsgi_request
        begin_signin(request, staff.email, PASSWORD, "staff")
        # Deliberately retain an old API pending context with no native entry binding.
        session = client.session
        session["pending_mfa"] = request.session["pending_mfa"]
        session.save()
        response = native_auth(client, "enroll")
        self.assertTrue(response.context["error"])
        self.assertFalse(client.session.get("grants"))

    def test_openapi_contains_only_marketplace_contexts_and_no_retired_operations(self):
        schema = json.loads((Path(__file__).resolve().parents[1] / "schema.json").read_text())
        for path in schema["paths"]:
            self.assertNotIn("/staff/", path)
            self.assertNotIn("/owner/", path)
            self.assertNotIn("/auth/mfa/", path)
            self.assertNotIn("/verification/cases/", path)
            self.assertNotIn("/verification/queue/", path)
            self.assertNotIn("/verification/transfers/", path)
