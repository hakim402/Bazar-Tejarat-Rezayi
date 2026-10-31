"""Strict operator-controlled account entry policies."""

from django.core.exceptions import ImproperlyConfigured


def owner_mfa_setting(env, *, production):
    value = env("OWNER_MFA_REQUIRED", default="true").strip().lower()
    if value not in {"true", "false"}:
        raise ImproperlyConfigured("OWNER_MFA_REQUIRED must be true or false.")
    required = value == "true"
    return required


def public_signup_setting(env):
    value = env("PUBLIC_SIGNUP_ENABLED", default="false").strip().lower()
    if value not in {"true", "false"}:
        raise ImproperlyConfigured("PUBLIC_SIGNUP_ENABLED must be true or false.")
    return value == "true"
