from .base import *

DEBUG = env.bool("DJANGO_DEBUG", default=True)
ALLOWED_HOSTS = env.list("DJANGO_ALLOWED_HOSTS", default=["localhost", "127.0.0.1"])
if any("*" in host for host in ALLOWED_HOSTS):
    raise ImproperlyConfigured("Wildcard hosts are not permitted.")
CORS_ALLOWED_ORIGINS = origin_list("DJANGO_CORS_ALLOWED_ORIGINS")
CSRF_TRUSTED_ORIGINS = origin_list("DJANGO_CSRF_TRUSTED_ORIGINS")
SESSION_COOKIE_SECURE = False
CSRF_COOKIE_SECURE = False
