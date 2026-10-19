import os
import environ
from apps.accounts.provider_settings import provider_settings
from cryptography.fernet import Fernet
from pathlib import Path
from urllib.parse import urlsplit

from config.environment import database_config, load_environment
from config.security import owner_mfa_setting
from django.core.exceptions import ImproperlyConfigured
from django.conf.locale import LANG_INFO

BASE_DIR = Path(__file__).resolve().parent.parent.parent
env = environ.Env() if os.environ.get("DJANGO_SETTINGS_MODULE") == "config.settings.test" else load_environment(BASE_DIR)
PRODUCTION = env("DJANGO_SETTINGS_MODULE", default="config.settings.development").endswith(".production")

OWNER_MFA_REQUIRED = owner_mfa_setting(env, production=PRODUCTION)

SECRET_KEY = env("DJANGO_SECRET_KEY")
if len(SECRET_KEY) < 50 or SECRET_KEY.startswith("replace-"):
    raise ImproperlyConfigured("Set a generated DJANGO_SECRET_KEY of at least 50 characters.")


def origin_list(name, *, secure=False):
    origins = env.list(name, default=[])
    for origin in origins:
        parsed = urlsplit(origin)
        if (
            parsed.scheme not in (("https",) if secure else ("http", "https"))
            or not parsed.hostname
            or "*" in origin
            or parsed.username
            or parsed.password
            or parsed.path
            or parsed.query
            or parsed.fragment
        ):
            raise ImproperlyConfigured(f"{name} must contain explicit origins without paths.")
    return origins


INSTALLED_APPS = [
    "unfold",
    "apps.accounts.apps.AccountsConfig",
    "django_otp",
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "corsheaders",
    "rest_framework",
    "drf_spectacular",
]

MIDDLEWARE = [
    "apps.foundation.observability.RequestContextMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django_otp.middleware.OTPMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

DATABASES = {
    "default": database_config(
        env("DATABASE_URL", default=""),
        production=PRODUCTION,
        host_override=env("DATABASE_HOST", default=""),
        conn_max_age=env("DB_CONN_MAX_AGE", default="0"),
    )
}

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "fa-af"
LANG_INFO["fa-af"] = {"bidi": True, "code": "fa-af", "name": "Dari", "name_local": "دری", "fallback": ["fa"]}
LANG_INFO["ps"] = {"bidi": True, "code": "ps", "name": "Pashto", "name_local": "پښتو"}
LANGUAGES = [("fa-af", "دری"), ("en", "English"), ("ps", "پښتو"), ("ar", "العربية")]
TIME_ZONE = "Asia/Kabul"
USE_I18N = True
USE_TZ = True
STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

CORS_ALLOW_ALL_ORIGINS = False
CORS_ALLOW_CREDENTIALS = True
SESSION_COOKIE_HTTPONLY = True
EMAIL_BACKEND = "apps.accounts.mail.PrivateCaptureBackend"
DEFAULT_FROM_EMAIL = "no-reply@rezayi.example.test"
PRIVATE_MAIL_ROOT = env("PRIVATE_MAIL_ROOT", default=str(BASE_DIR / "data" / "private-mail"))
FRONTEND_ORIGIN = env(
    "FRONTEND_ORIGIN", default="https://bazartejaratrezayi.com" if PRODUCTION else "http://127.0.0.1:3100"
)
_frontend = urlsplit(FRONTEND_ORIGIN)
if (
    _frontend.scheme not in (("https",) if PRODUCTION else ("http", "https"))
    or not _frontend.hostname
    or _frontend.username
    or _frontend.password
    or _frontend.path
    or _frontend.query
    or _frontend.fragment
):
    raise ImproperlyConfigured("FRONTEND_ORIGIN must be an explicit trusted origin without a path.")
DEVELOPMENT_SIGNUP_ENABLED = not PRODUCTION and env.bool("DEVELOPMENT_SIGNUP_ENABLED", default=True)
MFA_ENCRYPTION_KEY = env("MFA_ENCRYPTION_KEY", default="")
if not MFA_ENCRYPTION_KEY:
    raise ImproperlyConfigured("A separate private MFA_ENCRYPTION_KEY is required.")
try:
    Fernet(MFA_ENCRYPTION_KEY.encode())
except (ValueError, TypeError):
    raise ImproperlyConfigured("MFA_ENCRYPTION_KEY must be a valid private Fernet key.") from None
AUTH_USER_MODEL = "accounts.User"
AUTH_PASSWORD_VALIDATORS[1]["OPTIONS"] = {"min_length": 12}
UNFOLD = {
    "SITE_TITLE": "Bazar Rezayi",
    "SITE_HEADER": "بازار رضایی",
    "SITE_SUBHEADER": "Owner administration",
    "COLORS": {
        "primary": {
            "50": "#eaf4ff",
            "100": "#d9ecff",
            "200": "#b7daff",
            "300": "#84c4ff",
            "400": "#4ca7f4",
            "500": "#0270d2",
            "600": "#005bab",
            "700": "#00478b",
            "800": "#00366d",
            "900": "#00254f",
            "950": "#00152e",
        }
    },
    "SITE_URL": FRONTEND_ORIGIN,
    "STYLES": [lambda request: "/static/accounts/admin.css"],
    "SITE_LOGO": {
        "light": lambda request: "/static/accounts/brand.svg",
        "dark": lambda request: "/static/accounts/brand-white.svg",
    },
}

CELERY_BROKER_URL = env("CELERY_BROKER_URL")
CELERY_BROKER_CONNECTION_RETRY_ON_STARTUP = True
CELERY_TASK_SERIALIZER = "json"
CELERY_ACCEPT_CONTENT = ["json"]
CELERY_TASK_IGNORE_RESULT = True
CELERY_BEAT_SCHEDULE = {}

REST_FRAMEWORK = {
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "EXCEPTION_HANDLER": "apps.foundation.errors.api_exception_handler",
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_AUTHENTICATION_CLASSES": [],
}
SPECTACULAR_SETTINGS = {
    "TITLE": "Bazar Rezayi foundation API",
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
    "ENUM_NAME_OVERRIDES": {
        "LocaleEnum": "apps.foundation.contracts.LOCALES",
        "PublicAccountContextEnum": ["buyer", "seller"],
    },
    "COMPONENT_SPLIT_REQUEST": True,
}
CORS_EXPOSE_HEADERS = ["X-Request-ID"]
SESSION_COOKIE_DOMAIN = None
CSRF_COOKIE_DOMAIN = None
CSRF_COOKIE_HTTPONLY = True
CSRF_FAILURE_VIEW = "apps.accounts.views.csrf_failure"
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_SAMESITE = "Lax"
SECURE_PROXY_SSL_HEADER = None
USE_X_FORWARDED_HOST = False
DATA_ROOT = Path(env("DATA_ROOT", default=str(BASE_DIR / "data")))
PUBLIC_MEDIA_URL = env("PUBLIC_MEDIA_URL", default="/media/catalogue/")
STORAGES = {
    "default": {
        "BACKEND": "apps.foundation.storage.PrivateFileStorage",
        "OPTIONS": {"location": DATA_ROOT / "private-evidence"},
    },
    "public_local": {
        "BACKEND": "django.core.files.storage.FileSystemStorage",
        "OPTIONS": {"location": DATA_ROOT / "public-catalogue", "base_url": PUBLIC_MEDIA_URL},
    },
    "private_local": {
        "BACKEND": "apps.foundation.storage.PrivateFileStorage",
        "OPTIONS": {"location": DATA_ROOT / "private-evidence"},
    },
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}
NEW_PUBLIC_STORAGE_ALIAS = "public_local"
NEW_PRIVATE_STORAGE_ALIAS = "private_local"
CELERY_IMPORTS = ("apps.foundation.tasks",)
CELERY_RESULT_BACKEND = env("CELERY_RESULT_BACKEND", default=CELERY_BROKER_URL)
CELERY_RESULT_EXPIRES = 60
CELERY_TASK_SEND_SENT_EVENT = False
CELERY_WORKER_HIJACK_ROOT_LOGGER = False
CELERY_WORKER_REDIRECT_STDOUTS = False
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {
        "console": {"class": "logging.StreamHandler"},
        "safe_errors": {"class": "apps.foundation.observability.SanitizedRequestErrorHandler"},
        "safe_security": {"class": "apps.foundation.observability.SanitizedSecurityHandler"},
    },
    "loggers": {
        "foundation": {"handlers": ["console"], "level": "INFO", "propagate": False},
        "django.request": {"handlers": ["safe_errors"], "level": "ERROR", "propagate": False},
        "django.security": {"handlers": ["safe_security"], "level": "WARNING", "propagate": False},
    },
}


globals().update(provider_settings(env, PRODUCTION))
ACCOUNT_MAIL_TTL_MINUTES = {"verify": 1440, "reset": 30}
CELERY_IMPORTS = (*CELERY_IMPORTS, "apps.accounts.tasks")
CELERY_BEAT_SCHEDULE["account-mail-dispatch"] = {
    "task": "accounts.dispatch_mail",
    "schedule": 60.0,
}
# Provider libraries must never write request URLs, codes or token responses to application logs.
for _logger in ("authlib", "requests", "urllib3"):
    LOGGING["loggers"][_logger] = {"handlers": [], "level": "CRITICAL", "propagate": False}
