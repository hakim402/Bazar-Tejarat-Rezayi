from pathlib import Path
from urllib.parse import urlsplit

from config.environment import database_config, load_environment
from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent.parent
env = load_environment(BASE_DIR)
PRODUCTION = env("DJANGO_SETTINGS_MODULE", default="config.settings.development").endswith(".production")

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
    "foundation.observability.RequestContextMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
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

LANGUAGE_CODE = "en-us"
TIME_ZONE = "Asia/Kabul"
USE_I18N = True
USE_TZ = True
STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

CORS_ALLOW_ALL_ORIGINS = False
CORS_ALLOW_CREDENTIALS = False
SESSION_COOKIE_HTTPONLY = True
EMAIL_BACKEND = "django.core.mail.backends.dummy.EmailBackend"

CELERY_BROKER_URL = env("CELERY_BROKER_URL")
CELERY_BROKER_CONNECTION_RETRY_ON_STARTUP = True
CELERY_TASK_SERIALIZER = "json"
CELERY_ACCEPT_CONTENT = ["json"]
CELERY_TASK_IGNORE_RESULT = True
CELERY_BEAT_SCHEDULE = {}

REST_FRAMEWORK = {
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "EXCEPTION_HANDLER": "foundation.errors.api_exception_handler",
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_AUTHENTICATION_CLASSES": [],
}
SPECTACULAR_SETTINGS = {
    "TITLE": "Bazar Rezayi foundation API",
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
    "ENUM_NAME_OVERRIDES": {"LocaleEnum": "foundation.contracts.LOCALES"},
    "COMPONENT_SPLIT_REQUEST": True,
}
CORS_EXPOSE_HEADERS = ["X-Request-ID"]
SESSION_COOKIE_DOMAIN = None
CSRF_COOKIE_DOMAIN = None
CSRF_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_SAMESITE = "Lax"
SECURE_PROXY_SSL_HEADER = None
USE_X_FORWARDED_HOST = False
DATA_ROOT = Path(env("DATA_ROOT", default=str(BASE_DIR / "data")))
PUBLIC_MEDIA_URL = env("PUBLIC_MEDIA_URL", default="/media/catalogue/")
STORAGES = {
    "default": {
        "BACKEND": "foundation.storage.PrivateFileStorage",
        "OPTIONS": {"location": DATA_ROOT / "private-evidence"},
    },
    "public_local": {
        "BACKEND": "django.core.files.storage.FileSystemStorage",
        "OPTIONS": {"location": DATA_ROOT / "public-catalogue", "base_url": PUBLIC_MEDIA_URL},
    },
    "private_local": {
        "BACKEND": "foundation.storage.PrivateFileStorage",
        "OPTIONS": {"location": DATA_ROOT / "private-evidence"},
    },
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}
NEW_PUBLIC_STORAGE_ALIAS = "public_local"
NEW_PRIVATE_STORAGE_ALIAS = "private_local"
CELERY_IMPORTS = ("foundation.tasks",)
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
        "safe_errors": {"class": "foundation.observability.SanitizedRequestErrorHandler"},
        "safe_security": {"class": "foundation.observability.SanitizedSecurityHandler"},
    },
    "loggers": {
        "foundation": {"handlers": ["console"], "level": "INFO", "propagate": False},
        "django.request": {"handlers": ["safe_errors"], "level": "ERROR", "propagate": False},
        "django.security": {"handlers": ["safe_security"], "level": "WARNING", "propagate": False},
    },
}
