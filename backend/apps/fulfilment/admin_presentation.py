"""Owner delivery pages: one record per page, related facts remain linked."""

from django.contrib import admin
from django.db import models
from django.db.models import Exists, OuterRef
from django.urls import NoReverseMatch, reverse
from django.utils.html import format_html, format_html_join
from django.utils.translation import gettext_lazy as _

from apps.accounts.admin.access import is_owner
from apps.accounts.admin.display import money, quantity, short_id, state_badge
from apps.catalogue.admin.helpers import link_button, panel_table
from apps.catalogue.admin.presentation import seller_cell
from apps.orders.admin_presentation import account_cell
from . import models as m


ORDER_PATHS = {"preparationline": "preparation__order", "publication": "event__order", "noticecursor": "event__order", "evidencebinding": "evidence__order"}
INTERNAL = {"id", "order", "event", "actor", "account", "creator", "storage_alias", "key", "sha256", "digest", "created_at"}
LABELS = {
    "kind": _("Review category"), "state": _("Status"), "name": _("Name"), "phone": _("Phone"), "address": _("Address"),
    "instructions": _("Instructions"), "reason": _("Reason"), "description": _("Description"), "amount": _("Amount"),
    "currency": _("Currency"), "reference": _("Reference"), "occurred_at": _("Actual time"), "paid_at": _("Paid at"),
    "sent_at": _("Refund sent at"), "dispatched_at": _("Dispatched at"), "goods_confirmed": _("Confirmed goods amount"),
    "quantity": _("Quantity"), "action": _("Decision"), "disposition": _("Hold resolution"), "arranger": _("Arranged by"),
    "code": _("Dispatch result"), "revision": _("Revision"), "version": _("Version"), "next_check_at": _("Next check"),
    "checked_at": _("Last checked"), "target_version": _("Target version"), "goods_version": _("Goods version"),
    "delivery_version": _("Delivery version"), "case_version": _("Review version"), "purpose": _("Evidence purpose"),
    "size": _("File size (bytes)"), "width": _("Image width"), "height": _("Image height"), "expires_at": _("Expires at"),
    "result": _("Recorded result"), "done": _("Completed"), "after": _("Last processed record"),
}


def describe(value):
    if value is None:
        return "—"
    if isinstance(value, dict):
        return panel_table([_("Field"), _("Value")], [[LABELS.get(key, _(key.replace("_", " ").capitalize())), describe(item)] for key, item in value.items()], _("No recorded values."))
    if isinstance(value, list):
        return format_html_join("", '<div class="mb-2">{}</div>', ((describe(item),) for item in value)) or "—"
    if isinstance(value, bool):
        return _("Yes") if value else _("No")
    return value


class OwnerDeliveryPresentation:
    def order_relation(self):
        return ORDER_PATHS.get(self.model._meta.model_name, "order")

    def delivery_order(self, obj):
        for part in self.order_relation().split("__"):
            obj = getattr(obj, part)
        return obj

    def get_queryset(self, request):
        qs = super().get_queryset(request)
        if not is_owner(request):
            return qs
        if hasattr(self.model, "construction"):
            qs = self.model.construction.all()
        path = self.order_relation()
        relations = [field.name for field in self.model._meta.fields if field.is_relation]
        qs = qs.select_related(*relations, path + "__invoice", path + "__buyer__user", path + "__seller__account__user")
        order_id = path + "__pk"
        if self.model is m.State:
            qs = qs.annotate(
                ui_dispatched=Exists(m.Shipment.objects.filter(order_id=OuterRef(order_id))),
                ui_delivered=Exists(m.Delivery.objects.filter(order_id=OuterRef(order_id))),
                ui_completed=Exists(m.Completion.objects.filter(order_id=OuterRef(order_id))),
                ui_review=Exists(m.ReviewCase.objects.filter(order_id=OuterRef(order_id), state="open")),
            )
        if self.model is m.Blocker:
            qs = qs.annotate(ui_closed=Exists(m.BlockerClosure.objects.filter(blocker_id=OuterRef("pk"))))
        if any(field.name == "event" for field in self.model._meta.fields):
            qs = qs.annotate(ui_published=Exists(m.Publication.objects.filter(event_id=OuterRef("event_id"))))
        return qs

    def get_list_display(self, request):
        if not is_owner(request):
            return super().get_list_display(request)
        if self.model is m.State:
            return ["order_reference", "buyer_identity", "seller_identity", "delivery_stage", "review_status", "next_check_at", "workflow_link"]
        if self.model is m.ReviewCase:
            return self.badge_columns(["record_reference", "order_reference", "kind", "state", "reviewer", "created_at", "workflow_link"])
        if self.model is m.Blocker:
            return self.badge_columns(["record_reference", "order_reference", "kind", "hold_status", "created_at", "workflow_link"])
        fields = {field.name for field in self.model._meta.fields}
        columns = ["record_reference", "order_reference"]
        columns += [name for name in ("name", "reference", "action", "disposition", "code", "amount_display", "quantity_display", "dispatched_at", "occurred_at", "paid_at", "sent_at")
                    if name in fields or name == "amount_display" and "amount" in fields or name == "quantity_display" and "quantity" in fields]
        if "event" in fields:
            columns.append("publication_status")
        if "created_at" in fields:
            columns.append("created_at")
        return self.badge_columns(columns)

    def badge_columns(self, columns):
        result = []
        for name in columns:
            if name in {"kind", "state", "action", "disposition", "code"}:
                def render(obj, field=name):
                    display = getattr(obj, f"get_{field}_display", None)
                    return state_badge(display() if display else getattr(obj, field))
                render.short_description = LABELS.get(name, name)
                render.admin_order_field = name
                result.append(render)
            else:
                result.append(name)
        return result

    def get_search_fields(self, request):
        if not is_owner(request):
            return super().get_search_fields(request)
        path = self.order_relation()
        fields = {field.name for field in self.model._meta.fields}
        return [path + "__invoice__number", path + "__seller__display_name", path + "__buyer__user__email",
                *[name for name in ("name", "reference", "reason", "description") if name in fields]]

    def owner_readonly(self, request, fields):
        return list(dict.fromkeys([*fields, "record_reference", "order_reference", "record_details", "related_records", "recorded_at", "owner_workflow"])) if is_owner(request) else fields

    def get_fieldsets(self, request, obj=None):
        if not is_owner(request):
            return super().get_fieldsets(request, obj)
        identity_fields = ["record_reference", "order_reference"]
        if any(field.name == "created_at" for field in self.model._meta.fields):
            identity_fields.append("recorded_at")
        return [
            (_("Identity"), {"fields": identity_fields}),
            (_("Record details"), {"fields": ["record_details"]}),
            (_("Related records and actions"), {"fields": ["owner_workflow", "related_records"],
             "description": _("Open the related record for its full details. Operational changes use the delivery workflow; retained facts cannot be edited or deleted here.")}),
        ]

    @admin.display(description=_("Reference"))
    def record_reference(self, obj):
        return short_id(obj.pk)

    @admin.display(description=_("Order"))
    def order_reference(self, obj):
        order = self.delivery_order(obj)
        invoice = getattr(order, "invoice", None)
        return link_button(reverse("admin:orders_sellerorder_change", args=[order.pk]), invoice.number if invoice else str(order.pk)[:8], "receipt_long")

    @admin.display(description=_("Buyer account"))
    def buyer_identity(self, obj):
        return account_cell(self.delivery_order(obj).buyer)

    @admin.display(description=_("Seller account"))
    def seller_identity(self, obj):
        return seller_cell(self.delivery_order(obj).seller)

    @admin.display(description=_("Delivery stage"))
    def delivery_stage(self, obj):
        return state_badge("completed" if obj.ui_completed else "delivered" if obj.ui_delivered else "dispatched" if obj.ui_dispatched else "not_dispatched")

    @admin.display(description=_("Open reviews"), boolean=True)
    def review_status(self, obj):
        return obj.ui_review

    @admin.display(description=_("Hold status"))
    def hold_status(self, obj):
        return state_badge("closed" if obj.ui_closed else "open")

    @admin.display(description=_("History status"))
    def publication_status(self, obj):
        return state_badge("published" if obj.ui_published else "unpublished")

    @admin.display(description=_("Amount"), ordering="amount")
    def amount_display(self, obj):
        return money(obj.amount, getattr(obj, "currency", None) or self.delivery_order(obj).currency)

    @admin.display(description=_("Quantity"), ordering="quantity")
    def quantity_display(self, obj):
        return quantity(obj.quantity)

    @admin.display(description=_("Recorded at"))
    def recorded_at(self, obj):
        return getattr(obj, "created_at", None)

    @admin.display(description=_("Record details"))
    def record_details(self, obj):
        rows = []
        for field in self.model._meta.fields:
            if field.is_relation or field.name in INTERNAL:
                continue
            if field.name == "currency" and hasattr(obj, "amount"):
                continue
            value = getattr(obj, field.name)
            if isinstance(field, models.DecimalField):
                value = quantity(value) if field.name == "quantity" else money(value, getattr(obj, "currency", None) or self.delivery_order(obj).currency)
            elif field.name in {"state", "kind", "action", "disposition", "arranger", "code"}:
                display = getattr(obj, f"get_{field.name}_display", None)
                value = state_badge(display() if display else value)
            else:
                value = describe(value)
            rows.append([LABELS.get(field.name, field.verbose_name), value])
        if self.model is m.State:
            rows.extend([[_("Delivery stage"), self.delivery_stage(obj)], [_("Open reviews"), _("Yes") if obj.ui_review else _("No")]])
        elif self.model is m.Blocker:
            rows.append([_("Hold status"), self.hold_status(obj)])
        if hasattr(obj, "ui_published"):
            rows.append([_("History status"), self.publication_status(obj)])
        return panel_table([_("Field"), _("Value")], rows, _("This record only links related facts."))

    @admin.display(description=_("Delivery workflow"))
    def owner_workflow(self, obj):
        if hasattr(self, "workflow_link"):
            return self.workflow_link(obj)
        if self.model is m.Evidence:
            binding = getattr(obj, "binding", None)
            if binding:
                target = binding.claim or binding.correction or binding.refund
                case = getattr(target, "case", None)
                if case:
                    return link_button(reverse("admin:fulfilment_reviewcase_review", args=[case.pk]), _("Review delivery case"), "fact_check")
        case = getattr(obj, "case", None)
        if case:
            return link_button(reverse("admin:fulfilment_reviewcase_review", args=[case.pk]), _("Review delivery case"), "fact_check")
        return link_button(reverse("admin:fulfilment_state_workflow", args=[self.delivery_order(obj).pk]), _("Open delivery workflow"), "local_shipping")

    @admin.display(description=_("Related records"))
    def related_records(self, obj):
        links = []
        for field in self.model._meta.fields:
            history_relation = field.name == "event" or field.name == "actor" and self.model in {m.Event, m.Command} or field.name == "creator" and self.model is m.Evidence
            if not field.is_relation or field.name in INTERNAL and not history_relation or not getattr(obj, field.attname):
                continue
            related = getattr(obj, field.name)
            label = next((getattr(related, name) for name in ("name", "number", "sku", "reference", "display_name") if getattr(related, name, None)), None)
            title = format_html('{} · {}', field.verbose_name, label or str(related.pk)[:8])
            try:
                url = reverse(f"admin:{related._meta.app_label}_{related._meta.model_name}_change", args=[related.pk])
            except NoReverseMatch:
                continue
            links.append(link_button(url, title))
        return format_html('<div class="flex flex-wrap gap-2">{}</div>', format_html_join("", "{}", ((link,) for link in links))) or "—"
