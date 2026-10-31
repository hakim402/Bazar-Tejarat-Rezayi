"""Admin MFA policy; the historical OWNER_MFA_REQUIRED key covers owner and staff."""

from django.core.exceptions import ImproperlyConfigured


def owner_mfa_setting(env, *, production):
    value = env("OWNER_MFA_REQUIRED", default="true").strip().lower()
    if value not in {"true", "false"}:
        raise ImproperlyConfigured("OWNER_MFA_REQUIRED must be true or false.")
    required = value == "true"
    return required
