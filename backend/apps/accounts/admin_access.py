"""Fresh admin admission and one effective staff permission source.

Legacy Account.permission_groups is retained for history, never OR-ed into authority.
"""
from django.contrib.auth.models import Permission
from django.core.exceptions import PermissionDenied
from rest_framework.exceptions import APIException
from .models import Account
from .services import get_grant


def is_owner(request):
    if not hasattr(request, "session"):
        return False
    try:
        get_grant(request, 'owner')
        return True
    except APIException:
        return False


def admin_actor(request):
    from apps.organizations.access import Actor
    if is_owner(request):
        return Actor(request, 'owner')
    account = get_grant(request, 'staff')
    if not request.user.is_staff or account.status != 'active':
        raise PermissionDenied
    return Actor(request, 'staff')


def permission_codes(account, app_label):
    # Query on each action; Django's user.has_perm cache cannot retain revoked roles.
    if not Account.objects.filter(pk=account.pk, context='staff', status='active',
                                  user__is_active=True, user__is_staff=True,
                                  user__email_verified=True).exists():
        return []
    return list(Permission.objects.filter(group__user=account.user,
                                          content_type__app_label=app_label)
                .values_list('codename', flat=True).distinct())


def permits(request, app_label, *codes):
    if is_owner(request):
        return True
    try:
        actor = admin_actor(request)
        return bool(set(codes) & set(permission_codes(actor.account, app_label)))
    except (APIException, PermissionDenied):
        return False


class GuardedAdminMixin:
    """Fail closed for every registered model, including lookups and bulk POSTs."""
    def has_module_permission(self, request):
        return self.has_view_permission(request)

    def has_view_permission(self, request, obj=None):
        if is_owner(request):
            return super().has_view_permission(request, obj)
        check = getattr(self, 'staff_view', None)
        return bool(check and check(request, obj))

    def has_add_permission(self, request):
        return is_owner(request) and super().has_add_permission(request)

    def has_change_permission(self, request, obj=None):
        return is_owner(request) and super().has_change_permission(request, obj)

    def has_delete_permission(self, request, obj=None):
        return is_owner(request) and super().has_delete_permission(request, obj)

    def lookup_allowed(self, lookup, value, request=None):
        if request is not None and not is_owner(request):
            filters = self.get_list_filter(request)
            roots = [item if isinstance(item, str) else getattr(item, "parameter_name", "") for item in filters]
            roots += [self.model._meta.pk.name]
            return any(root and (lookup == root or lookup.startswith(root + "__")) for root in roots)
        return super().lookup_allowed(lookup, value, request)

    def get_queryset(self, request):
        qs = super().get_queryset(request)
        if not self.has_view_permission(request):
            return qs.none()
        scope = getattr(self, 'staff_queryset', None)
        return scope(request, qs) if scope and not is_owner(request) else qs
