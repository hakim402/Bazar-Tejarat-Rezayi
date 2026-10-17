import os

from django.conf import settings
from django.core.wsgi import get_wsgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.development")
application = get_wsgi_application()

if settings.DEBUG:
    from django.contrib.staticfiles.handlers import StaticFilesHandler

    application = StaticFilesHandler(application)
