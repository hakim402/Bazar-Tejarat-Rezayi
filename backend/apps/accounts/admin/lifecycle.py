"""Owner-only deletion through Django's confirmation and relationship checks."""

from django.contrib import messages
from django.db import IntegrityError
from django.shortcuts import redirect
from django.utils.translation import gettext as _


class RetainedHistoryDeleteMixin:
    def get_actions(self, request):
        actions = super().get_actions(request)
        actions.pop("delete_selected", None)
        return actions

    def get_deleted_objects(self, objs, request):
        if self.has_audit_history(objs):
            return [], {}, set(), [self.retained_history_message]
        return super().get_deleted_objects(objs, request)

    def delete_view(self, request, object_id, extra_context=None):
        try:
            return super().delete_view(request, object_id, extra_context)
        except IntegrityError:
            self.message_user(
                request, _("This record is linked to other records and could not be deleted."), messages.ERROR,
            )
            return redirect(f"admin:{self.opts.app_label}_{self.opts.model_name}_change", object_id)
