"""Disposable tests: generated process configuration only; no owner environment reads."""

import os
from django.core.exceptions import ImproperlyConfigured
from config.testing import owned_database, run_id

_identifier = run_id()
_test_database = owned_database(os.environ.get("REZAYI_TEST_DATABASE_URL", ""), _identifier)
_browser = os.environ.get("BROWSER_TEST_RUNTIME") == "true"
for _key in ("DJANGO_SECRET_KEY", "MFA_ENCRYPTION_KEY", "REZAYI_TEST_FRONTEND_ORIGIN", "REZAYI_TEST_BROKER_URL"):
    if not os.environ.get(_key):
        raise ImproperlyConfigured("Disposable test tooling must supply all temporary settings.")
os.environ.update(
    DJANGO_SETTINGS_MODULE="config.settings.test",
    DATABASE_URL=os.environ["REZAYI_TEST_DATABASE_URL"],
    DATABASE_HOST="",
    GOOGLE_OAUTH_ENABLED="false",
    ACCOUNT_EMAIL_TRANSPORT="capture",
    GOOGLE_CLIENT_ID="",
    GOOGLE_CLIENT_SECRET="",
    EMAIL_HOST_USER="",
    EMAIL_HOST_PASSWORD="",
    DEFAULT_FROM_EMAIL="",
    FRONTEND_ORIGIN=os.environ["REZAYI_TEST_FRONTEND_ORIGIN"],
    CELERY_BROKER_URL=os.environ["REZAYI_TEST_BROKER_URL"] if _browser else "memory://",
    CELERY_RESULT_BACKEND=os.environ["REZAYI_TEST_BROKER_URL"] if _browser else "cache+memory://",
    DATA_ROOT="/app/data",
    PRIVATE_MAIL_ROOT="/app/data/private-mail",
)

from .base import *  # noqa: E402, F403

DATABASES = {"default": _test_database}
DEBUG = _browser
ALLOWED_HOSTS = ["testserver", "localhost", "127.0.0.1"]
CORS_ALLOWED_ORIGINS = [FRONTEND_ORIGIN]  # noqa: F405
CSRF_TRUSTED_ORIGINS = CORS_ALLOWED_ORIGINS
TEST_RUNNER = "tests.runner.IdentityTestRunner"
SESSION_COOKIE_SECURE = False
CSRF_COOKIE_SECURE = False
EMAIL_BACKEND = (
    "apps.accounts.mail.PrivateCaptureBackend" if _browser else "django.core.mail.backends.locmem.EmailBackend"
)
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.PBKDF2PasswordHasher" if _browser else "django.contrib.auth.hashers.MD5PasswordHasher"
]
if not _browser:
    LOGGING = {"version": 1, "disable_existing_loggers": True}
