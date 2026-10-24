"""cPanel Python Selector startup file; entry point: application."""

import os

from django.core.exceptions import ImproperlyConfigured
from django.core.wsgi import get_wsgi_application

if os.environ.get("DJANGO_SETTINGS_MODULE", "config.settings.production") != "config.settings.production":
    raise ImproperlyConfigured("Passenger requires DJANGO_SETTINGS_MODULE=config.settings.production.")
os.environ["DJANGO_SETTINGS_MODULE"] = "config.settings.production"
application = get_wsgi_application()
