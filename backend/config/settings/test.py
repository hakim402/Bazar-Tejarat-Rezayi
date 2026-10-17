import os

from config.environment import isolated_database

_test_database = isolated_database(os.environ.get("TEST_DATABASE_URL", ""))
os.environ["DATABASE_URL"] = os.environ["TEST_DATABASE_URL"]
os.environ["DATABASE_HOST"] = ""

from .base import *  # noqa: E402, F403

DATABASES = {"default": _test_database}
DEBUG = False
ALLOWED_HOSTS = ["testserver", "localhost", "127.0.0.1"]
CORS_ALLOWED_ORIGINS = ["http://127.0.0.1:3100"]
CSRF_TRUSTED_ORIGINS = CORS_ALLOWED_ORIGINS
TEST_RUNNER = "tests.runner.FoundationTestRunner"
LOGGING = {"version": 1, "disable_existing_loggers": True}
