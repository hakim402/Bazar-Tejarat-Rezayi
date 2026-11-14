"""Shared catalogue admin plumbing: scoped guards, service-routed forms and panels.

Every admin here renders through native Unfold templates only. Presentation is
centralised so the product, taxonomy and record screens stay DRY and consistent.
"""

from types import SimpleNamespace

from django import forms
from django.contrib import messages
from django.contrib.admin.helpers import AdminForm
from django.core.exceptions import ValidationError
from django.db import DatabaseError
from django.shortcuts import redirect
from django.utils.html import format_html, format_html_join
from django.utils.translation import gettext_lazy as _
from rest_framework.exceptions import APIException
from unfold.admin import ModelAdmin

from apps.accounts.admin.access import admin_actor, is_owner, permits
from apps.accounts.admin.locale import admin_language
from apps.organizations.admin import ReadOnlyAdmin


def chrome_locale(request):
    """Admin chrome copy follows the session language; database content languages stay separate."""
    return "fa-AF" if admin_language(request) == "fa-af" else "en"


def submit_pressed(data, name):
    """Unfold submit-line buttons POST '{app}_{model}_{action}' keys."""
    return any(key.endswith(f"_{name}") for key in data)


def independent_product(item, actor):
    """True when the actor may decide on this product; False for own/linked businesses."""
    from apps.organizations.access import independent

    try:
        independent(item.seller, actor)
        return True
    except APIException:
        return False


class ServiceFormMixin:
    """Shape a native change form for service-routed saves with resilient errors.

    Default save buttons are hidden in favour of explicit guarded action buttons.
    A concurrent version race that slips past validation retries once against the
    fresh row; storage failures redirect with a safe message instead of a 500.
    """

    def changeform_view(self, request, object_id=None, form_url="", extra_context=None):
        extra_context = {
            **(extra_context or {}),
            "show_save": False,
            "show_save_and_continue": False,
            "show_save_and_add_another": False,
        }
        try:
            return super().changeform_view(request, object_id, form_url, extra_context)
        except ValidationError as error:
            if not getattr(request, "_catalogue_form_retry", False):
                request._catalogue_form_retry = True
                return self.changeform_view(request, object_id, form_url, extra_context)
            messages.error(request, "; ".join(str(message) for message in error.messages))
            return redirect(request.get_full_path())
        except (OSError, DatabaseError):
            messages.error(request, _("Changes could not be saved. Reload the record and retry."))
            return redirect(request.get_full_path())


class CatalogueRecordAdmin(ReadOnlyAdmin):
    """Read-only inspection list scoped so staff never see their own/linked products."""

    def staff_view(self, request, obj=None):
        return permits(request, "catalogue", "view_" + self.model._meta.model_name) and permits(
            request, "catalogue", "review_source", "review_translation", "moderate_catalogue"
        )

    def staff_queryset(self, request, qs):
        path = "revision__product" if self.model.__name__ in ("Translation", "TranslationJob") else "product"
        return qs.exclude(**{path + "__seller__account__user": request.user}).exclude(
            **{path + "__seller__memberships__account__user": request.user}
        ).distinct()


def panel_table(headers, rows, empty):
    """A compact, theme-aware table used by every readonly workspace panel."""
    if not rows:
        return format_html('<p class="text-sm text-base-500 dark:text-base-400">{}</p>', empty)
    head = format_html_join("", "<th class=\"px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-base-500 dark:text-base-400\">{}</th>", ((h,) for h in headers))
    body = format_html_join(
        "",
        '<tr class="border-t border-base-200 dark:border-base-800">{}</tr>',
        (
            format_html_join("", '<td class="px-3 py-2 align-top text-sm text-base-700 dark:text-base-300">{}</td>', ((cell,) for cell in row))
            for row in rows
        ),
    )
    return format_html(
        '<div class="overflow-x-auto rounded-default border border-base-200 dark:border-base-800">'
        '<table class="w-full border-collapse"><thead class="bg-base-50 dark:bg-base-800/50"><tr>{}</tr></thead>'
        "<tbody>{}</tbody></table></div>",
        head,
        body,
    )


def panel_note(text):
    """Quiet guidance line shown above a panel or form section."""
    return format_html('<p class="text-sm text-base-500 dark:text-base-400">{}</p>', text)


def link_button(url, label, icon=None, variant="default"):
    """A compact Unfold-styled link used inside readonly panels."""
    tones = {
        "default": "border border-base-200 bg-white text-base-700 hover:bg-base-100/80 dark:border-base-700 dark:bg-transparent dark:text-base-300",
        "primary": "border border-transparent bg-primary-600 text-white hover:bg-primary-600/80",
        "danger": "border border-red-600 bg-red-600 text-white hover:bg-red-600/80",
    }
    icon_html = format_html('<span class="material-symbols-outlined text-[18px]">{}</span>', icon) if icon else ""
    return format_html(
        '<a href="{}" class="inline-flex items-center gap-1 rounded-default px-3 py-1.5 text-sm font-medium {}">{}{}</a>',
        url,
        tones[variant],
        icon_html,
        label,
    )


def changeform_context(request, admin, form, fieldsets, *, original, title,
                       readonly_fields=(), actions=(), datasets=(), extra=None):
    """Build the native Unfold change-form context for a guarded workflow view.

    The workflow keeps its own plain/ModelForm and service routing; this only
    shapes the presentation so admin/change_form.html renders it with native
    fieldsets, readonly panels and submit-line action buttons. ``datasets`` are
    rendered outside the main POST form, which is where the GET selection form
    lives. Legacy ``form``/``selection`` keys are retained for callers/tests.
    """
    adminform = AdminForm(form, fieldsets, {}, readonly_fields=list(readonly_fields), model_admin=admin)
    opts = admin.model._meta
    context = {
        **admin.admin_site.each_context(request),
        "adminform": adminform,
        "opts": opts,
        "original": original,
        "object_id": str(original.pk) if original is not None else None,
        "title": title,
        "add": False,
        "change": original is not None,
        "is_popup": False,
        "save_as": False,
        "has_add_permission": admin.has_add_permission(request),
        "has_change_permission": admin.has_change_permission(request, original),
        "has_view_permission": admin.has_view_permission(request, original),
        "has_delete_permission": admin.has_delete_permission(request, original),
        "has_editable_inline_admin_formsets": False,
        "inline_admin_formsets": [],
        "media": form.media,
        "has_file_field": any(isinstance(field, forms.FileField) for field in form.fields.values()),
        "form_classes": {},
        "form_url": "",
        "errors": form.errors,
        "show_save": False,
        "show_save_and_continue": False,
        "show_save_and_add_another": False,
        "show_delete_link": False,
        "actions_submit_line": list(actions),
        "datasets": [SimpleNamespace(contents=content) for content in datasets],
        "is_popup_var": "_popup",
        "to_field_var": "_to_field",
        "to_field": None,
        "form": form,
        **(extra or {}),
    }
    return context