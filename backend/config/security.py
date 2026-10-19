"""Environment policy for owner authentication; production always requires MFA."""

from django.core.exceptions import ImproperlyConfigured


def owner_mfa_setting(env, *, production):
    value = env("OWNER_MFA_REQUIRED", default="true").strip().lower()
    if value not in {"true", "false"}:
        raise ImproperlyConfigured("OWNER_MFA_REQUIRED must be true or false.")
    required = value == "true"
    if production and not required:
        raise ImproperlyConfigured("OWNER_MFA_REQUIRED must be true in production.")
    return required
