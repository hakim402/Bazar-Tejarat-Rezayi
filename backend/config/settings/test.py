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
    GOOGLE_OAUTH_ENABLED="false",
    ACCOUNT_EMAIL_TRANSPORT="capture",
    GOOGLE_CLIENT_ID="",
    GOOGLE_CLIENT_SECRET="",
    GOOGLE_REDIRECT_URI="",
    ACCOUNT_REPLY_TO="",
    EMAIL_HOST="smtp.example.test",
    EMAIL_HOST_USER="",
    EMAIL_HOST_PASSWORD="",
    DEFAULT_FROM_EMAIL="",
    FRONTEND_ORIGIN=os.environ["REZAYI_TEST_FRONTEND_ORIGIN"],
    CELERY_BROKER_URL=os.environ["REZAYI_TEST_BROKER_URL"] if _browser else "memory://",
    CELERY_RESULT_BACKEND=os.environ["REZAYI_TEST_BROKER_URL"] if _browser else "cache+memory://",
    DATA_ROOT=os.environ["REZAYI_TEST_ROOT"] + "/data",
    PRIVATE_MAIL_ROOT=os.environ["REZAYI_TEST_ROOT"] + "/data/private-mail",
    CATALOGUE_S3_BUCKET="",
    CATALOGUE_S3_ACCESS_KEY="",
    CATALOGUE_S3_SECRET_KEY="",
    OWNER_MFA_REQUIRED=os.environ.get("REZAYI_TEST_OWNER_MFA_REQUIRED", "true"),
)

from .base import *  # noqa: E402, F403

DATABASES = {"default": _test_database}
STATIC_ROOT = os.environ["REZAYI_TEST_ROOT"] + "/staticfiles"
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

# Tests never use a private key or a live translation/storage account.
CATALOGUE_STORAGE_ALIAS = "catalogue_local"
CATALOGUE_TRANSLATION_ENABLED = False
GROQ_API_KEY = ""
GROQ_MODEL = ""
GROQ_DAILY_CALL_LIMIT = 0
GROQ_DAILY_CHARACTER_LIMIT = 0
GROQ_TRANSLATION_LOCALES = ()
CATALOGUE_TRANSLATION_ADAPTER = "deterministic" if _browser and os.environ.get("REZAYI_TEST_TRANSLATION_ADAPTER") == "deterministic" else "disabled"
STORAGES.pop("catalogue_s3", None)  # noqa: F405

CATALOGUE_TEST_ADAPTER_ALLOWED = True

if CATALOGUE_TRANSLATION_ADAPTER == "deterministic":
    CATALOGUE_TRANSLATION_ENABLED = True

STORAGES["site_local"]["OPTIONS"]["location"] = os.environ["REZAYI_TEST_ROOT"] + "/site-public"  # noqa: F405
SITE_MEDIA_HOSTS = ()

if _browser:
    MIDDLEWARE = ["tests.site_faults.SiteFaultMiddleware", *MIDDLEWARE]  # noqa: F405
