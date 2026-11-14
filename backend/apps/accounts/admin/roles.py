"""Role groups; deletion disabled to preserve grant history."""
from django.contrib.auth.admin import GroupAdmin
from django.contrib.auth.models import Group
from unfold.admin import ModelAdmin

from .site import owner_site


class RoleAdmin(GroupAdmin, ModelAdmin):
    actions = []

    def has_delete_permission(self, request, obj=None):
        return False


owner_site.register(Group, RoleAdmin)