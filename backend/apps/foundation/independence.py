"""Shared eligible-reviewer chooser for independent native decisions."""

from django.db.models import Q
from apps.accounts.models import User
from rest_framework.exceptions import APIException

SCAN_LIMIT = 200


def eligible_reviewers(app_label, read_code, decide_code, independence, *, user_id=None, active_staff_account=False):
    """Active verified staff holding both permissions and passing the caller's
    independence check. One bounded scan shared by every reviewer chooser."""
    decide = Q(groups__permissions__content_type__app_label=app_label, groups__permissions__codename=decide_code)
    if active_staff_account:
        decide &= Q(accounts__context="staff", accounts__status="active")
    read = Q(groups__permissions__content_type__app_label=app_label, groups__permissions__codename=read_code)
    qs = (
        User.objects.filter(is_active=True, email_verified=True, is_staff=True)
        .filter(Q(is_superuser=True) | decide)
        .filter(Q(is_superuser=True) | read)
        .distinct()
        .order_by("pk")
    )
    if user_id is not None:
        qs = qs.filter(pk=user_id)
    result = []
    for user in qs[:SCAN_LIMIT]:
        try:
            independence(user)
        except APIException:
            continue
        result.append(user)
    return result
