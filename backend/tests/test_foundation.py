import json
import logging
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch
from uuid import UUID

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured, SuspiciousFileOperation
from django.core.files.base import ContentFile
from django.test import RequestFactory, SimpleTestCase, TestCase, override_settings
from django.urls import path
from rest_framework.exceptions import ValidationError
from rest_framework.test import APIClient
from rest_framework.views import APIView

from config.environment import database_config, isolated_database, load_environment
from apps.foundation.observability import SanitizedRequestErrorHandler, SanitizedSecurityHandler, audit_event
from apps.foundation.storage import FileLocation, PrivateFileStorage


class DatabaseConfigurationTests(SimpleTestCase):
    def test_explicit_postgres_and_percent_encoding(self):
        result = database_config("postgresql://user:p%40ss@localhost:5432/example?connect_timeout=4")
        self.assertEqual(result["PASSWORD"], "p@ss")
        self.assertEqual(result["ENGINE"], "django.db.backends.postgresql")
        self.assertEqual(result["OPTIONS"], {"connect_timeout": 4, "sslmode": "disable"})

    def test_rejects_unsafe_configuration_without_echoing_values(self):
        cases = [
            "",
            "sqlite:///database",
            "mysql://u:p@host/db",
            "postgres://host/db",
            "postgres://u:secret@host:99999/db",
            "postgres://u:secret@host/db?options=unsafe",
            "postgres://u:secret@host/db?connect_timeout=0",
            "postgres://u:secret@host/db?sslmode=invalid",
            "postgres://u:secret@host/db?sslmode=disable&sslmode=require",
        ]
        for value in cases:
            with self.subTest(case=cases.index(value)):
                with self.assertRaises(ImproperlyConfigured) as result:
                    database_config(value)
                self.assertNotIn("secret", str(result.exception))
                self.assertNotIn(value, str(result.exception)) if value else None

    def test_production_requires_verified_tls(self):
        result = database_config("postgres://u:p@db.example/db", production=True, conn_max_age=60)
        self.assertEqual(result["OPTIONS"]["sslmode"], "verify-full")
        with self.assertRaises(ImproperlyConfigured):
            database_config("postgres://u:p@db.example/db?sslmode=disable", production=True)

    def test_native_database_url_host_is_authoritative(self):
        with patch.dict("os.environ", {"DATABASE_HOST": "obsolete-container-host"}):
            result = database_config("postgres://u:p@localhost/db")
            self.assertEqual(result["HOST"], "localhost")

    def test_tests_fail_closed_on_business_database(self):
        for name in ["bazar_rezayi_db", "rezayi_local", "test_other"]:
            with self.assertRaises(ImproperlyConfigured):
                isolated_database(f"postgres://u:p@127.0.0.1/{name}")
        self.assertEqual(
            isolated_database("postgres://u:p@127.0.0.1/test_rezayi_phase02_unit")["TEST"]["NAME"],
            "test_rezayi_phase02_unit",
        )
        from tests.runner import IdentityTestRunner

        with self.assertRaises(ImproperlyConfigured):
            IdentityTestRunner.validate_target(
                {"HOST": "unrelated-host", "USER": "business", "NAME": "bazar_rezayi_db"}
            )


class EnvironmentPrecedenceTests(SimpleTestCase):
    def test_process_environment_wins_over_single_file(self):
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, ".env").write_text("FOUNDATION_ENV_PROBE=file-value\n")
            with patch.dict("os.environ", {"FOUNDATION_ENV_PROBE":"process-value"}):
                env = load_environment(Path(directory))
                self.assertEqual(env("FOUNDATION_ENV_PROBE"),"process-value")

    def test_missing_single_file_allows_explicit_process_configuration(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict("os.environ", {"FOUNDATION_ENV_PROBE":"process-value"}):
            self.assertEqual(load_environment(Path(directory))("FOUNDATION_ENV_PROBE"),"process-value")


class ValidationView(APIView):
    authentication_classes = []
    permission_classes = []

    def get(self, request):
        raise ValidationError({"field": ["This field is required."]})


class BrokenView(ValidationView):
    def get(self, request):
        raise RuntimeError("private-exception-value")


def broken_django_view(request):
    private_local = "sensitive-local-and-message"
    raise ValueError(private_local)


urlpatterns = [
    path("validation/", ValidationView.as_view()),
    path("broken/", BrokenView.as_view()),
    path("api/v1/plain-broken/", broken_django_view),
]


class ApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_bootstrap_contract_cache_and_no_cookie(self):
        response = self.client.get("/api/v1/bootstrap/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["default_locale"], "fa-AF")
        self.assertEqual(response.json()["supported_locales"], ["fa-AF", "en", "ps", "ar"])
        self.assertEqual(response.json()["currencies"], ["AFN", "USD"])
        self.assertNotIn("Set-Cookie", response)
        self.assertEqual(response["Cache-Control"], "no-store")
        UUID(response["X-Request-ID"])

    def test_origin_allowlist_and_preflight(self):
        allowed = self.client.get("/api/v1/bootstrap/", HTTP_ORIGIN=settings.FRONTEND_ORIGIN)
        self.assertEqual(allowed["Access-Control-Allow-Origin"], settings.FRONTEND_ORIGIN)
        self.assertEqual(allowed["Access-Control-Allow-Credentials"], "true")
        denied = self.client.get("/api/v1/bootstrap/", HTTP_ORIGIN="https://evil.example")
        self.assertNotIn("Access-Control-Allow-Origin", denied)
        preflight = self.client.options(
            "/api/v1/bootstrap/",
            HTTP_ORIGIN=settings.FRONTEND_ORIGIN,
            HTTP_ACCESS_CONTROL_REQUEST_METHOD="GET",
            HTTP_ACCESS_CONTROL_REQUEST_HEADERS="x-request-id",
        )
        self.assertEqual(preflight.status_code, 200)

    def test_liveness_is_database_free(self):
        response = self.client.get("/api/v1/health/live/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "alive"})
        self.assertEqual(response["Cache-Control"], "no-store")

    @patch("apps.foundation.views.redis.Redis.from_url")
    @patch("apps.foundation.views.connections")
    def test_readiness_success_and_both_dependency_failures(self, connections, redis):
        cursor = connections["default"].cursor.return_value.__enter__.return_value
        cursor.fetchone.return_value = (1,)
        redis.return_value.ping.return_value = True
        self.assertEqual(self.client.get("/api/v1/health/ready/").status_code, 200)
        connections["default"].cursor.side_effect = RuntimeError("database-private-value")
        response = self.client.get("/api/v1/health/ready/")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json(), {"status": "not_ready"})
        connections["default"].cursor.side_effect = None
        redis.return_value.ping.side_effect = RuntimeError("redis-private-value")
        response = self.client.get("/api/v1/health/ready/")
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("private", response.content.decode())

    def test_unknown_and_method_errors_are_safe(self):
        for method, url, status in [("get", "/api/v1/missing/", 404), ("post", "/api/v1/bootstrap/", 405)]:
            response = getattr(self.client, method)(url)
            self.assertEqual(response.status_code, status)
            self.assertIn("request_id", response.json()["error"])
            self.assertNotIn("traceback", response.content.decode().lower())

    @override_settings(ROOT_URLCONF=__name__)
    def test_validation_and_internal_error_envelopes(self):
        response = self.client.get("/validation/")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["fields"], {"field": ["This field is required."]})
        response = self.client.get("/broken/")
        self.assertEqual(response.status_code, 500)
        self.assertNotIn("private-exception-value", response.content.decode())

    def test_correlation_is_validated(self):
        response = self.client.get("/api/v1/bootstrap/", HTTP_X_REQUEST_ID="unsafe\nvalue")
        UUID(response["X-Request-ID"])
        valid = "78f5d85e-3bde-47eb-879f-53b72fb261f4"
        self.assertEqual(self.client.get("/api/v1/bootstrap/", HTTP_X_REQUEST_ID=valid)["X-Request-ID"], valid)

    def test_schema_contains_authoritative_bootstrap(self):
        response = self.client.get("/api/v1/schema/", HTTP_ACCEPT="application/vnd.oai.openapi+json")
        self.assertEqual(response.status_code, 200)
        self.assertIn("/api/v1/bootstrap/", response.json()["paths"])
        self.assertIn("Bootstrap", response.json()["components"]["schemas"])

    @override_settings(ROOT_URLCONF=__name__)
    def test_unexpected_error_retains_safe_correlated_diagnostics(self):
        with self.assertLogs("foundation", level="INFO") as captured:
            response = self.client.get("/broken/?evidence=private-query", HTTP_AUTHORIZATION="Bearer private-header")
        failures = [json.loads(record.message) for record in captured.records if record.name == "foundation.errors"]
        self.assertEqual(len(failures), 1)
        failure = failures[0]
        self.assertEqual(failure["exception_type"], "RuntimeError")
        self.assertEqual(failure["request_id"], response.json()["error"]["request_id"])
        self.assertEqual(failure["request_id"], response["X-Request-ID"])
        self.assertTrue(any(frame["function"] == "get" for frame in failure["frames"]))
        for record in captured.records:
            self.assertIsNone(record.exc_info)
            for private_value in ["private-exception-value", "private-query", "private-header"]:
                self.assertNotIn(private_value, record.message)
                self.assertNotIn(private_value, response.content.decode())

    @override_settings(ROOT_URLCONF=__name__, DEBUG=True)
    def test_plain_django_api_failure_is_safe_even_in_development(self):
        with self.assertLogs("foundation.errors", level="ERROR") as captured:
            response = self.client.get("/api/v1/plain-broken/")
        self.assertEqual(response.status_code, 500)
        self.assertEqual(json.loads(captured.records[0].message)["exception_type"], "ValueError")
        self.assertEqual(json.loads(captured.records[0].message)["request_id"], response["X-Request-ID"])
        self.assertNotIn("sensitive-local-and-message", response.content.decode())
        self.assertNotIn("sensitive-local-and-message", captured.records[0].message)

    @override_settings(DEBUG=True)
    def test_security_rejection_is_retained_without_raw_host_or_debug_details(self):
        security_logger = logging.getLogger("django.security.DisallowedHost")
        with (
            patch.object(security_logger, "disabled", False),
            patch.object(security_logger, "handlers", [SanitizedSecurityHandler()]),
            patch.object(security_logger, "propagate", False),
            patch.object(security_logger, "level", logging.WARNING),
            self.assertLogs("foundation.security", level="WARNING") as captured,
        ):
            response = self.client.get("/api/v1/bootstrap/", HTTP_HOST="private-host.invalid")
        self.assertEqual(response.status_code, 400)
        event = json.loads(captured.records[0].message)
        self.assertEqual(event["reason"], "invalid_host")
        self.assertEqual(event["request_id"], response["X-Request-ID"])
        self.assertNotIn("private-host", captured.records[0].message)
        self.assertNotIn("private-host", response.content.decode())

    def test_django_exception_handler_never_formats_raw_record_and_deduplicates(self):
        request = RequestFactory().get("/api/v1/bootstrap/?private=query")
        request.request_id = "78f5d85e-3bde-47eb-879f-53b72fb261f4"
        try:
            raise RuntimeError("sensitive-error-message")
        except RuntimeError:
            record = logging.LogRecord(
                "django.request", logging.ERROR, "private-path", 1, "private-log-message", (), sys.exc_info()
            )
        record.request = request
        handler = SanitizedRequestErrorHandler()
        with self.assertLogs("foundation.errors", level="ERROR") as captured:
            handler.emit(record)
            handler.emit(record)
        self.assertEqual(len(captured.records), 1)
        event = json.loads(captured.records[0].message)
        self.assertEqual(event["request_id"], request.request_id)
        self.assertEqual(event["exception_type"], "RuntimeError")
        self.assertTrue(event["frames"])
        self.assertIsNone(captured.records[0].exc_info)
        self.assertNotIn("sensitive-error-message", captured.records[0].message)
        self.assertNotIn("private-", captured.records[0].message)


class StorageAndAuditTests(SimpleTestCase):
    def test_no_public_url_for_private_evidence_or_path_escape(self):
        with self.assertRaises(SuspiciousFileOperation):
            PrivateFileStorage().url("evidence.pdf")
        with self.assertRaises(SuspiciousFileOperation):
            FileLocation("private_local", "evidence.pdf").public_url()
        for key in ["/absolute", "../escape", "a/../escape", "a\\escape", ""]:
            with self.assertRaises(SuspiciousFileOperation):
                FileLocation("public_local", key)

    def test_recorded_location_survives_new_upload_default_change(self):
        with tempfile.TemporaryDirectory() as directory:
            config = {
                **settings.STORAGES,
                "public_local": {
                    "BACKEND": "django.core.files.storage.FileSystemStorage",
                    "OPTIONS": {"location": directory, "base_url": "/media/catalogue/"},
                },
            }
            with override_settings(STORAGES=config):
                from django.core.files.storage import storages

                storages["public_local"].save("old/item.bin", ContentFile(b"preserved"))
                location = FileLocation("public_local", "old/item.bin")
                with override_settings(NEW_PUBLIC_STORAGE_ALIAS="future_cloud"):
                    with location.open() as data:
                        self.assertEqual(data.read(), b"preserved")
                self.assertTrue(Path(directory, "old/item.bin").exists())

    def test_case_scoped_reads_require_case_context(self):
        with self.assertRaises(ValueError):
            audit_event(
                actor_id="actor",
                context="staff",
                resource_type="message",
                resource_id="id",
                action="case_read",
                reason_code="assigned_case",
                request_id="id",
            )

    def test_audit_uses_controlled_reasons(self):
        with self.assertRaises(ValueError):
            audit_event(
                actor_id="actor",
                context="staff",
                resource_type="case",
                resource_id="id",
                action="read",
                reason_code="free text body",
                request_id="id",
            )
        with self.assertLogs("foundation.audit", level="INFO") as records:
            audit_event(
                actor_id="actor",
                context="staff",
                resource_type="case",
                resource_id="id",
                action="read",
                reason_code="assigned_case",
                request_id="id",
            )
        event = json.loads(records.records[0].message)
        self.assertIn("time", event)
        self.assertNotIn("body", event)
