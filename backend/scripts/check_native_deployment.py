"""Synthetic production startup/checks and loopback WSGI smoke; never loads private .env."""

import argparse
import base64
import json
import os
import secrets
import subprocess
import sys
import threading
from unittest.mock import patch
import urllib.request
from wsgiref.simple_server import WSGIRequestHandler, make_server

import environ

import config.environment


class QuietHandler(WSGIRequestHandler):
    def log_message(self, *args):
        pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--development", action="store_true")
    parser.add_argument("--mfa", choices=["true", "false"], default="true")
    args = parser.parse_args()
    development = args.development
    os.environ.update(
        DJANGO_SETTINGS_MODULE="config.settings.production", DJANGO_DEBUG="false",
        DJANGO_SECRET_KEY=secrets.token_urlsafe(64),
        MFA_ENCRYPTION_KEY=base64.urlsafe_b64encode(secrets.token_bytes(32)).decode(),
        DATABASE_URL="postgresql://synthetic:synthetic@db.example.test/production?sslmode=verify-full",
        DJANGO_ALLOWED_HOSTS="api.bazartejaratrezayi.com",
        DJANGO_CORS_ALLOWED_ORIGINS="https://bazartejaratrezayi.com",
        DJANGO_CSRF_TRUSTED_ORIGINS="https://bazartejaratrezayi.com",
        FRONTEND_ORIGIN="https://bazartejaratrezayi.com", OWNER_MFA_REQUIRED=args.mfa,
        CELERY_BROKER_URL="redis://127.0.0.1:1/0", CELERY_RESULT_BACKEND="redis://127.0.0.1:1/0",
        PUBLIC_SIGNUP_ENABLED="false", GOOGLE_OAUTH_ENABLED="false", GOOGLE_CLIENT_ID="", GOOGLE_CLIENT_SECRET="", GOOGLE_REDIRECT_URI="",
        ACCOUNT_EMAIL_TRANSPORT="smtp", EMAIL_HOST="smtp.example.test", EMAIL_HOST_USER="sender@example.test",
        EMAIL_HOST_PASSWORD=secrets.token_urlsafe(32), DEFAULT_FROM_EMAIL="sender@example.test",
        EMAIL_PORT="587", EMAIL_USE_TLS="true", EMAIL_USE_SSL="false", EMAIL_TIMEOUT="3",
        CATALOGUE_TRANSLATION_ENABLED="false", CATALOGUE_S3_BUCKET="", GROQ_API_KEY="",
        GROQ_DAILY_CALL_LIMIT="0", GROQ_DAILY_CHARACTER_LIMIT="0", DJANGO_SECURE_HSTS_SECONDS="0",
    )
    # Each child initializes the actual production module with generated configuration.
    # Invalid/default cases must pass through the startup validator, not override_settings.
    if not development:
        probe = """
import sys
from unittest.mock import patch
import environ
import config.environment
from django.core.exceptions import ImproperlyConfigured
try:
    with patch.object(config.environment, 'load_environment', return_value=environ.Env()):
        from config.settings import production as settings
except ImproperlyConfigured:
    raise SystemExit(42)
assert settings.PRODUCTION and not settings.DEBUG
assert settings.SESSION_COOKIE_SECURE and settings.CSRF_COOKIE_SECURE
assert settings.SECURE_SSL_REDIRECT
assert settings.OWNER_MFA_REQUIRED == (sys.argv[1] == 'true')
assert settings.PUBLIC_SIGNUP_ENABLED == (sys.argv[2] == 'true')
"""
        for value, expected in ((None, 'true'), ('true', 'true'), ('false', 'false'),
                                ('', None), ('tru', None), ('0', None), ('disabled', None)):
            child_env = dict(os.environ)
            if value is None:
                child_env.pop('OWNER_MFA_REQUIRED', None)
            else:
                child_env['OWNER_MFA_REQUIRED'] = value
            result = subprocess.run([sys.executable, '-c', probe, expected or 'invalid', 'false'],
                                    env=child_env, capture_output=True, timeout=20)
            assert result.returncode == (0 if expected else 42), 'Production startup policy regression'
        for value, expected in ((None, 'false'), ('true', 'true'), ('false', 'false'), ('', None), ('yes', None)):
            child_env = dict(os.environ)
            if value is None:
                child_env.pop('PUBLIC_SIGNUP_ENABLED', None)
            else:
                child_env['PUBLIC_SIGNUP_ENABLED'] = value
            result = subprocess.run([sys.executable, '-c', probe, args.mfa, expected or 'invalid'],
                                    env=child_env, capture_output=True, timeout=20)
            assert result.returncode == (0 if expected else 42), 'Production signup initialization regression'

    if development:
        os.environ.update(
            DJANGO_SETTINGS_MODULE="config.settings.development", DJANGO_DEBUG="true",
            DATABASE_URL=os.environ["REZAYI_TEST_DATABASE_URL"],
            CELERY_BROKER_URL=os.environ["REZAYI_TEST_BROKER_URL"],
            CELERY_RESULT_BACKEND=os.environ["REZAYI_TEST_BROKER_URL"],
            ACCOUNT_EMAIL_TRANSPORT="capture", DATA_ROOT=os.environ["REZAYI_TEST_ROOT"] + "/data",
            PRIVATE_MAIL_ROOT=os.environ["REZAYI_TEST_ROOT"] + "/data/private-mail",
        )
    # This patch is scoped to this verifier. There is no alternate runtime env selector.
    with patch.object(config.environment, "load_environment", return_value=environ.Env()):
        if development:
            from config.wsgi import application
        else:
            from passenger_wsgi import application
    from django.conf import settings
    from django.core.checks import run_checks, Tags
    assert callable(application)
    if not development:
        assert not settings.DEBUG and settings.SETTINGS_MODULE == "config.settings.production"
        assert settings.SESSION_COOKIE_SECURE and settings.CSRF_COOKIE_SECURE and settings.SECURE_SSL_REDIRECT
    assert settings.OWNER_MFA_REQUIRED == (args.mfa == "true")
    from apps.accounts.services import admin_mfa_required
    assert admin_mfa_required() == (args.mfa == "true")
    findings = run_checks(include_deployment_checks=not development)
    errors = [f for f in findings if f.level >= 40]
    assert not errors, [f.id for f in errors]
    assert not run_checks(tags=[Tags.database])

    def secure_test_request(environ, start_response):
        # Test harness simulates TLS termination; application proxy trust stays disabled.
        environ["wsgi.url_scheme"] = "https"
        return application(environ, start_response)

    with make_server("127.0.0.1", 0, secure_test_request, handler_class=QuietHandler) as server:
        thread = threading.Thread(target=server.serve_forever)
        thread.start()
        try:
            paths = ["/api/v1/health/live/"]
            if development:
                paths.extend(["/api/v1/health/ready/", "/admin/login/", "/static/accounts/admin.css"])
            for path in paths:
                request = urllib.request.Request(
                    f"http://127.0.0.1:{server.server_port}" + path,
                    headers={"Host": "api.bazartejaratrezayi.com"})
                with urllib.request.urlopen(request, timeout=5) as response:
                    assert response.status == 200
                    if path.endswith("/live/"):
                        assert json.load(response)["status"] == "alive"
        finally:
            server.shutdown()
            thread.join(timeout=6)
            assert not thread.is_alive()
    print(json.dumps({"mode": "development" if development else "production", "wsgi_callable": "passed", "local_wsgi_http": "passed",
                      "deployment_findings": [{"id": f.id, "message": str(f.msg)} for f in findings],
                      "real_passenger_account": "not verified", "provider_calls": "none"}))


if __name__ == "__main__":
    main()
