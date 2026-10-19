"""Private provider configuration. Validation errors contain key names only."""

from email.utils import parseaddr
from urllib.parse import urlsplit
from django.core.exceptions import ImproperlyConfigured


def provider_settings(env, production=False):
    transport = env("ACCOUNT_EMAIL_TRANSPORT", default="capture")
    enabled = env.bool("GOOGLE_OAUTH_ENABLED", default=False)
    values = {k: env(k, default="") for k in ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI"]}
    if enabled:
        if not all(values.values()):
            raise ImproperlyConfigured(
                "Enabled Google requires GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI."
            )
        url = urlsplit(values["GOOGLE_REDIRECT_URI"])
        if (
            url.path != "/api/v1/auth/google/callback/"
            or url.query
            or url.fragment
            or url.username
            or url.password
            or not url.hostname
            or url.scheme != "https"
            and not (not production and url.scheme == "http" and url.hostname in {"127.0.0.1", "localhost"})
        ):
            raise ImproperlyConfigured("GOOGLE_REDIRECT_URI must be the exact trusted backend callback.")
    values["GOOGLE_OAUTH_ENABLED"] = enabled
    if transport not in {"capture", "smtp"}:
        raise ImproperlyConfigured("ACCOUNT_EMAIL_TRANSPORT must be capture or smtp.")
    if production and transport != "smtp":
        raise ImproperlyConfigured("Production account mail requires explicit ACCOUNT_EMAIL_TRANSPORT=smtp.")
    values.update(
        ACCOUNT_EMAIL_TRANSPORT=transport,
        EMAIL_BACKEND="django.core.mail.backends.smtp.EmailBackend"
        if transport == "smtp"
        else "apps.accounts.mail.PrivateCaptureBackend",
    )
    for key, default in [
        ("EMAIL_HOST", "smtp.gmail.com"),
        ("EMAIL_HOST_USER", ""),
        ("EMAIL_HOST_PASSWORD", ""),
        ("DEFAULT_FROM_EMAIL", ""),
        ("ACCOUNT_REPLY_TO", ""),
    ]:
        values[key] = env(key, default=default)
    for key in ["EMAIL_HOST_USER", "DEFAULT_FROM_EMAIL", "ACCOUNT_REPLY_TO"]:
        values[key] = values[key].strip()
    values.update(
        EMAIL_PORT=env.int("EMAIL_PORT", default=587),
        EMAIL_TIMEOUT=env.int("EMAIL_TIMEOUT", default=10),
        EMAIL_USE_TLS=env.bool("EMAIL_USE_TLS", default=True),
        EMAIL_USE_SSL=env.bool("EMAIL_USE_SSL", default=False),
    )
    if transport == "smtp":
        if not all(values[k] for k in ["EMAIL_HOST", "EMAIL_HOST_USER", "EMAIL_HOST_PASSWORD", "DEFAULT_FROM_EMAIL"]):
            raise ImproperlyConfigured(
                "SMTP requires EMAIL_HOST, EMAIL_HOST_USER, EMAIL_HOST_PASSWORD, DEFAULT_FROM_EMAIL."
            )
        if (
            values["EMAIL_USE_TLS"] == values["EMAIL_USE_SSL"]
            or not 1 <= values["EMAIL_TIMEOUT"] <= 30
            or values["EMAIL_PORT"] != (587 if values["EMAIL_USE_TLS"] else 465)
        ):
            raise ImproperlyConfigured("SMTP requires verified STARTTLS/587 or SSL/465 and EMAIL_TIMEOUT 1-30.")
        for key in ["EMAIL_HOST_USER", "DEFAULT_FROM_EMAIL", "ACCOUNT_REPLY_TO"]:
            if values[key] and ("@" not in parseaddr(values[key])[1] or "\n" in values[key] or "\r" in values[key]):
                raise ImproperlyConfigured(f"{key} must contain a valid address.")
    else:
        values["DEFAULT_FROM_EMAIL"] = values["DEFAULT_FROM_EMAIL"] or "Bazar Rezayi <no-reply@rezayi.example.test>"
    return values
