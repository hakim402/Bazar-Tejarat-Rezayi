"""Per-request Apache CGI gateway; never starts a daemon or performs setup."""
import os
import sys
from wsgiref.handlers import CGIHandler


def main():
    selected = os.environ.get("DJANGO_SETTINGS_MODULE", "config.settings.production")
    if selected != "config.settings.production":
        raise RuntimeError("CGI requires explicit production settings.")
    os.environ["DJANGO_SETTINGS_MODULE"] = selected
    os.environ["SCRIPT_NAME"] = ""
    # Apache's authenticated HTTPS variable is authoritative; do not infer scheme
    # from arbitrary client-controlled forwarded headers.
    from django.core.wsgi import get_wsgi_application
    application = get_wsgi_application()
    handler = CGIHandler()
    handler.run(application)
    sys.stdout.flush()


if __name__ == "__main__":
    main()
