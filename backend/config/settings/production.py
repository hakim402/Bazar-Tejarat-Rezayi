from .base import *

DEBUG = False
if env.bool("DJANGO_DEBUG", default=False):
    raise ImproperlyConfigured("DJANGO_DEBUG must be false in production.")
ALLOWED_HOSTS = env.list("DJANGO_ALLOWED_HOSTS")
if not ALLOWED_HOSTS or any("*" in host for host in ALLOWED_HOSTS):
    raise ImproperlyConfigured("Production requires explicit allowed hosts.")
CORS_ALLOWED_ORIGINS = origin_list("DJANGO_CORS_ALLOWED_ORIGINS", secure=True)
CSRF_TRUSTED_ORIGINS = origin_list("DJANGO_CSRF_TRUSTED_ORIGINS", secure=True)
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_SSL_REDIRECT = True
SECURE_HSTS_SECONDS = env.int("DJANGO_SECURE_HSTS_SECONDS", default=0)
SECURE_HSTS_INCLUDE_SUBDOMAINS = False
SECURE_HSTS_PRELOAD = False
