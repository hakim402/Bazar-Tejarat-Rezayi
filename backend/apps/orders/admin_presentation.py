"""Owner-only presentation for retained orders and aftercare records."""

from django.contrib import admin
from django.contrib.admin import SimpleListFilter
from django.db.models import OuterRef, Prefetch, Subquery
from django.urls import reverse
from django.utils.html import format_html, format_html_join
from django.utils.translation import gettext_lazy as _

from apps.accounts.admin.access import is_owner
from apps.accounts.admin.display import money, quantity, state_badge
from apps.catalogue.admin.helpers import link_button, panel_note, panel_table
from apps.catalogue.admin.presentation import compact_text, identity, seller_cell
from apps.catalogue.admin.summaries import language_name, localized
from apps.catalogue.models import ProductImage
from .models import OrderLine


LISTS = {
    "sellerorder": ["order_reference", "buyer_identity", "seller_identity", "original_total", "payment_label", "accepted_at", "due_at"],
    "invoice": ["number", "buyer_identity", "seller_identity", "original_total", "issued_at", "protected_document"],
    "negotiation": ["case_reference", "buyer_identity", "seller_identity", "currency", "status_label", "revision", "created_at"],
    "cancellationrequest": ["case_reference", "buyer_identity", "seller_identity", "status_label", "requester", "reviewer", "created_at", "workspace"],
    "amendment": ["case_reference", "buyer_identity", "seller_identity", "status_label", "proposed_total", "reviewer", "created_at", "workspace"],
    "invoiceadjustment": ["case_reference", "buyer_identity", "seller_identity", "cause_label", "previous_total", "adjusted_total", "created_at"],
    "disputerequest": ["case_reference", "buyer_identity", "seller_identity", "status_label", "reviewer", "created_at", "workspace"],
    "review": ["order_reference", "buyer_identity", "seller_identity", "rating_label", "status_label", "review_excerpt", "created_at", "workspace"],
    "orderpolicy": ["policy_name", "advance_hours", "reminder_hours", "version"],
}

STAFF_SEARCH_FIELDS = {
    "sellerorder": ["id", "invoice__number"], "invoice": ["number"], "negotiation": ["id"],
    "cancellationrequest": ["id", "order__id"], "amendment": ["id", "order__id"], "invoiceadjustment": [],
    "disputerequest": ["id", "order__invoice__number"], "review": ["order__invoice__number"],
}


def account_cell(account):
    user = account.user
    image = reverse("site_media", args=[user.avatar_id]) if user.avatar_id else None
    return identity(user.display_name or user.email, user.email, image, "person")


def line_identity(line, cover=None):
    """Readable product identity for a retained order item."""
    snapshot = line.snapshot
    image = reverse("admin:catalogue_private_image", args=[cover]) if cover else None
    return identity(localized(snapshot.get("titles"), snapshot.get("sku") or _("Untitled product")),
                    snapshot.get("sku") or line.variant.sku, image)


def line_product(line):
    return line_identity(line, getattr(line, "admin_cover", None))


def line_table(order, rows=None):
    lines = list(order.lines.all())
    if rows is None:
        data = [(line, line.quantity, line.unit_price, line.goods_amount) for line in lines]
    else:
        by_id = {str(line.pk): line for line in lines}
        data = [(by_id.get(str(row.get("line"))), row.get("quantity"), row.get("unit_price"), row.get("goods_amount")) for row in rows]
    return panel_table([_("Product"), _("Sale unit"), _("Sales tier"), _("Quantity"), _("Unit price"), _("Line total")], [
        [line_product(line) if line else _("Retained order item"), localized(line.snapshot.get("unit_labels"), line.snapshot.get("unit", "—")) if line else "—",
         state_badge(line.tier) if line else "—", quantity(qty), money(decimal_value(price), order.currency), money(decimal_value(amount), order.currency)]
        for line, qty, price, amount in data
    ], _("No order items."))


class OrderStatusFilter(SimpleListFilter):
    title = _("Status")
    parameter_name = "state__exact"

    def lookups(self, request, model_admin):
        values = model_admin.get_queryset(request).order_by().values_list("state", flat=True).distinct()
        return [(value, _(value).replace("_", " ")) for value in values]

    def queryset(self, request, queryset):
        return queryset.filter(state=self.value()) if self.value() else queryset


class OwnerOrderPresentation:
    """Keep existing staff scoping, audit hooks and mutation services intact."""

    def owner_readonly(self, request, fields):
        return list(dict.fromkeys([*fields, *self.owner_field_names()])) if is_owner(request) and self.model._meta.model_name in LISTS else fields

    def owner_field_names(self):
        return [field for _, fields in self.owner_sections() for field in fields]

    def get_queryset(self, request):
        qs = super().get_queryset(request)
        name = self.model._meta.model_name
        if not is_owner(request) or name not in LISTS or name == "orderpolicy":
            return qs
        prefix = "" if name in {"sellerorder", "negotiation"} else "order__"
        qs = qs.select_related(prefix + "buyer__user", prefix + "seller__account__user")
        if name != "negotiation":
            qs = qs.select_related(prefix + "invoice")
        else:
            qs = qs.select_related("order__invoice")
        if name in {"cancellationrequest", "amendment", "disputerequest"}:
            qs = qs.select_related("assigned_to", "decision__actor")
        if name == "cancellationrequest":
            qs = qs.select_related("requester_account__user", "requester_user")
        if request.path.endswith("/change/") and name != "negotiation":
            images = ProductImage.objects.filter(product_id=OuterRef("variant__product_id")).order_by("created_at", "pk")
            lines = OrderLine.objects.select_related("variant").annotate(admin_cover=Subquery(images.values("pk")[:1]))
            qs = qs.prefetch_related(Prefetch(prefix + "lines", queryset=lines))
        return qs

    def get_list_display(self, request):
        name = self.model._meta.model_name
        if is_owner(request) and name in LISTS:
            if name == "sellerorder" and self.shows_dispatch_queue(request):
                return ["order_reference", "buyer_identity", "seller_identity", "accepted_at", "dispatch_status", "delivery_workflow"]
            return LISTS[name]
        return super().get_list_display(request)

    def get_list_filter(self, request):
        filters = super().get_list_filter(request)
        if is_owner(request) and self.model._meta.model_name in LISTS:
            return [OrderStatusFilter if field == "state" else field for field in filters]
        return filters

    def get_search_fields(self, request):
        name = self.model._meta.model_name
        if not is_owner(request) and name in STAFF_SEARCH_FIELDS:
            return STAFF_SEARCH_FIELDS[name]
        return super().get_search_fields(request)

    def get_readonly_fields(self, request, obj=None):
        return self.owner_readonly(request, super().get_readonly_fields(request, obj))

    def get_fieldsets(self, request, obj=None):
        if is_owner(request) and self.model._meta.model_name in LISTS:
            sections = [(title, {"fields": fields}) for title, fields in self.owner_sections()]
            if self.model._meta.model_name == "sellerorder" and "delivery_workflow" in self.get_fields(request, obj):
                sections.append((_("Delivery"), {"fields": ["delivery_workflow"]}))
            return sections
        return super().get_fieldsets(request, obj)

    def owner_sections(self):
        name = self.model._meta.model_name
        common = [(_("Identity"), ["order_reference", "buyer_identity", "seller_identity", *(["id"] if name != "review" else [])])]
        if name == "sellerorder":
            return [*common, (_("Accepted agreement"), ["original_total", "payment_label", "accepted_at", "due_at", "accepted_parties"]),
                    (_("Accepted order items"), ["order_items"]), (_("Current accepted total"), ["effective_total"]), (_("Related records"), ["related_records"])]
        if name == "invoice":
            return [(_("Identity"), ["number", "buyer_identity", "seller_identity", "id"]), (_("Invoice details"), ["issued_at", "original_total", "protected_document"]),
                    (_("Accepted order items"), ["order_items"]), (_("Related records"), ["related_records"])]
        if name == "negotiation":
            return [(_("Identity"), ["case_reference", "id", "buyer_identity", "seller_identity", "currency", "status_label", "revision", "version", "created_at"]),
                    (_("Proposal history"), ["proposal_history"]), (_("Activity"), ["negotiation_activity"]), (_("Accepted order"), ["accepted_order"])]
        if name == "orderpolicy":
            return [(_("Payment deadlines"), ["advance_hours", "reminder_hours"]), (_("Save policy changes"), ["version", "expected_version", "reason"])]
        common[0][1].insert(0, "case_reference")
        common[0][1].remove("order_reference")
        if name == "invoiceadjustment":
            return [*common, (_("Invoice adjustment"), ["cause_label", "previous_total", "adjusted_total", "reason", "actor", "created_at"]),
                    (_("Before adjustment"), ["before_items"]), (_("After adjustment"), ["after_items"]), (_("Related records"), ["related_records"])]
        if name == "review":
            return [*common, (_("Buyer review"), ["rating_label", "review_text", "review_language", "status_label", "version", "created_at", "workspace"]),
                    (_("Moderation history"), ["review_history"])]
        fields = ["status_label", "reason", "reviewer", "version", "created_at", "workspace"]
        if name == "cancellationrequest":
            fields.insert(1, "requester")
            fields.insert(2, "requester_identity")
        result = [*common, (_("Review details"), fields)]
        if name == "amendment":
            result.append((_("Proposed changes"), ["proposed_total", "proposed_items"]))
        result.append((_("Retained decision"), ["decision_details"]))
        result.append((_("Related records"), ["related_records"]))
        return result

    def ui_order(self, obj):
        return obj if self.model._meta.model_name in {"sellerorder", "negotiation"} else obj.order

    @admin.display(description=_("Order"))
    def order_reference(self, obj):
        order = self.ui_order(obj)
        invoice = getattr(order, "invoice", None)
        return invoice.number if invoice else _("Order %(reference)s") % {"reference": str(order.pk)[:8]}

    @admin.display(description=_("Reference"))
    def case_reference(self, obj):
        label = _("Negotiation") if self.model._meta.model_name == "negotiation" else self.order_reference(obj)
        return identity(label, str(obj.pk)[:8], glyph="receipt_long")

    @admin.display(description=_("Buyer account"))
    def buyer_identity(self, obj):
        return account_cell(self.ui_order(obj).buyer)

    @admin.display(description=_("Seller account"))
    def seller_identity(self, obj):
        return seller_cell(self.ui_order(obj).seller)

    @admin.display(description=_("Original goods total"))
    def original_total(self, obj):
        order = self.ui_order(obj)
        return money(order.goods_total, order.currency)

    @admin.display(description=_("Current accepted total"))
    def effective_total(self, obj):
        from .aftercare import accepted_total
        return money(accepted_total(obj), obj.currency)

    @admin.display(description=_("Payment method"))
    def payment_label(self, obj):
        return _("Cash on delivery") if obj.payment_method == "cod" else _("Advance payment")

    @admin.display(description=_("Status"))
    def status_label(self, obj):
        return state_badge(obj.state)

    @admin.display(description=_("Accepted names and destination"))
    def accepted_parties(self, obj):
        terms = obj.snapshot.get("terms", {})
        destination = terms.get("destination", {})
        return panel_table([_("Agreement detail"), _("Value")], [
            [_("Buyer name at acceptance"), obj.snapshot.get("buyer", "—")], [_("Seller name at acceptance"), obj.snapshot.get("seller", "—")],
            [_("Country"), destination.get("country", "—")], [_("City"), destination.get("city", "—")], [_("Accepted terms version"), terms.get("version", "—")],
        ], "")

    @admin.display(description=_("Order items"))
    def order_items(self, obj):
        return line_table(self.ui_order(obj))

    @admin.display(description=_("Proposed goods total"))
    def proposed_total(self, obj):
        return money(obj.after_total, obj.order.currency)

    @admin.display(description=_("Previous goods total"))
    def previous_total(self, obj):
        return money(obj.before_total, obj.order.currency)

    @admin.display(description=_("Adjusted goods total"))
    def adjusted_total(self, obj):
        return money(obj.after_total, obj.order.currency)

    @admin.display(description=_("Reason for adjustment"))
    def cause_label(self, obj):
        return state_badge(obj.cause)

    @admin.display(description=_("Before adjustment"))
    def before_items(self, obj):
        return line_table(obj.order, obj.before_lines)

    @admin.display(description=_("After adjustment"))
    def after_items(self, obj):
        return line_table(obj.order, obj.after_lines)

    @admin.display(description=_("Proposed order items"))
    def proposed_items(self, obj):
        accepted = {line.pk: line for line in obj.order.lines.all()}
        return panel_table([_("Product"), _("Original quantity"), _("Proposed quantity"), _("Original unit price"), _("Proposed unit price")], [
            [line_product(accepted.get(row.line_id, row.line)), quantity(row.line.quantity), quantity(row.proposed_quantity), money(row.line.unit_price, obj.order.currency), money(row.proposed_unit_price, obj.order.currency)]
            for row in obj.lines.select_related("line__variant").all()
        ], _("No proposed items."))

    @admin.display(description=_("Rating"), ordering="rating")
    def rating_label(self, obj):
        return format_html('<span dir="ltr">{} / 5</span>', obj.rating)

    @admin.display(description=_("Review text"))
    def review_excerpt(self, obj):
        return compact_text(obj.text)

    @admin.display(description=_("Review text"))
    def review_text(self, obj):
        return format_html('<div class="whitespace-pre-wrap break-words" dir="auto">{}</div>', obj.text)

    @admin.display(description=_("Language"))
    def review_language(self, obj):
        return language_name(obj.language)

    @admin.display(description=_("Moderation history"))
    def review_history(self, obj):
        return history_table([_("Decision"), _("Reason"), _("Recorded at")], [[state_badge(row.action), row.reason, row.created_at] for row in obj.decisions.order_by("-created_at")])

    @admin.display(description=_("Requested by"))
    def requester_identity(self, obj):
        if obj.requester_account_id:
            return account_cell(obj.requester_account)
        user = obj.requester_user
        return identity(user.display_name or user.email, user.email, glyph="person") if user else "—"

    @admin.display(description=_("Retained decision"))
    def decision_details(self, obj):
        decision = getattr(obj, "decision", None)
        if not decision:
            return panel_note(_("No decision recorded yet."))
        rows = [[_("Decision"), state_badge(decision.action)], [_("Reviewed by"), decision.actor.display_name],
                [_("Reason"), decision.reason], [_("Recorded at"), decision.created_at]]
        if getattr(decision, "amount", None) is not None:
            rows.append([_("Ordered refund amount"), money(decision.amount, obj.order.currency)])
        return panel_table([_("Decision detail"), _("Value")], rows, "")

    @admin.display(description=_("Related records"))
    def related_records(self, obj):
        order = self.ui_order(obj)
        links = []
        if self.model._meta.model_name != "sellerorder":
            links.append(link_button(reverse("admin:orders_sellerorder_change", args=[order.pk]), _("View order"), "receipt_long"))
        invoice = getattr(order, "invoice", None)
        if invoice and self.model._meta.model_name != "invoice":
            links.append(link_button(reverse("admin:orders_invoice_change", args=[invoice.pk]), _("View invoice"), "description"))
        if self.model._meta.model_name == "invoiceadjustment":
            if obj.cancellation_id:
                links.append(link_button(reverse("admin:orders_cancellationrequest_change", args=[obj.cancellation_id]), _("View cancellation"), "fact_check"))
            if obj.amendment_id:
                links.append(link_button(reverse("admin:orders_amendment_change", args=[obj.amendment_id]), _("View amendment"), "fact_check"))
        return format_html('<div class="flex flex-wrap gap-2">{}</div>', format_html_join("", "{}", ((link,) for link in links)))

    @admin.display(description=_("Order policy"))
    def policy_name(self, obj):
        return _("Payment deadlines and reminders")

    @admin.display(description=_("Proposal history"))
    def proposal_history(self, obj):
        blocks = []
        revisions = list(obj.revisions.select_related("actor__user").order_by("-number"))
        product_ids = {product.get("product") for revision in revisions for product in revision.body.get("context", {}).get("products", []) if product.get("product")}
        covers = {}
        for product_id, image_id in ProductImage.objects.filter(product_id__in=product_ids).order_by("created_at", "pk").values_list("product_id", "pk"):
            covers.setdefault(str(product_id), image_id)
        for revision in revisions:
            body = revision.body
            products = {str(row.get("variant")): row for row in body.get("context", {}).get("products", [])}
            rows = []
            for row in body.get("lines", []):
                product = products.get(str(row.get("variant")), {})
                cover = covers.get(str(product.get("product")))
                image = reverse("admin:catalogue_private_image", args=[cover]) if cover else None
                rows.append([identity(localized(product.get("titles"), product.get("sku") or _("Retained order item")), product.get("sku", "—"), image),
                             localized(product.get("unit_labels"), product.get("unit", "—")), quantity(row.get("quantity")), quantity(row.get("max_quantity")),
                             money(decimal_value(row.get("unit_price")), obj.currency), money(decimal_value(row.get("max_unit_price")), obj.currency)])
            choice = body.get("choice", {})
            details = panel_table([_("Proposal detail"), _("Value")], [
                [_("Submitted by"), revision.actor.user.display_name], [_("Recorded at"), revision.created_at],
                [_("Proposed goods total"), money(decimal_value(body.get("goods_total")), obj.currency)], [_("Country"), choice.get("country", "—")],
                [_("City"), choice.get("city", "—")], [_("Payment method"), _("Cash on delivery") if choice.get("method") == "cod" else _("Advance payment")],
                [_("Proposal note"), body.get("note") or "—"],
            ], "")
            blocks.append(format_html('<details class="rounded-default border border-base-200 p-3 dark:border-base-800"><summary class="cursor-pointer">{}</summary><div class="mt-3 flex flex-col gap-3">{}{}</div></details>',
                _("Revision %(number)s") % {"number": revision.number}, details,
                panel_table([_("Product"), _("Sale unit"), _("Proposed quantity"), _("Maximum quantity"), _("Proposed unit price"), _("Maximum unit price")], rows, _("No proposed items."))))
        return format_html_join("", '<div class="mb-3">{}</div>', ((block,) for block in blocks)) or panel_note(_("No proposals yet."))

    @admin.display(description=_("Activity"))
    def negotiation_activity(self, obj):
        return history_table([_("Action"), _("Submitted by"), _("Reason"), _("Recorded at")], [[state_badge(row.action), row.actor.user.display_name, row.reason or "—", row.created_at] for row in obj.events.select_related("actor__user").order_by("-created_at")])

    @admin.display(description=_("Accepted order"))
    def accepted_order(self, obj):
        order = getattr(obj, "order", None)
        return link_button(reverse("admin:orders_sellerorder_change", args=[order.pk]), _("View order"), "receipt_long") if order else panel_note(_("No accepted order yet."))


class RelatedOrderMixin:
    """Resolve the accepted order behind a retained secondary record.

    Secondary records never repeat the order workspace: they show the invoice,
    buyer and seller the record belongs to and link back to that workspace.
    """

    order_source = "order"

    def related_order(self, obj):
        value = obj
        for part in self.order_source.split("__"):
            value = getattr(value, part, None)
            if value is None:
                return None
        return value

    @admin.display(description=_("Order"))
    def order_reference(self, obj):
        order = self.related_order(obj)
        if order is None:
            return "—"
        invoice = getattr(order, "invoice", None)
        return invoice.number if invoice else _("Order %(reference)s") % {"reference": str(order.pk)[:8]}

    @admin.display(description=_("Buyer account"))
    def buyer_identity(self, obj):
        order = self.related_order(obj)
        return account_cell(order.buyer) if order else "—"

    @admin.display(description=_("Seller account"))
    def seller_identity(self, obj):
        order = self.related_order(obj)
        return seller_cell(order.seller) if order else "—"

    @admin.display(description=_("Order workspace"))
    def order_workspace(self, obj):
        order = self.related_order(obj)
        if order is None:
            return panel_note(_("No accepted order is linked to this record."))
        return link_button(reverse("admin:orders_sellerorder_change", args=[order.pk]), _("View order"), "receipt_long")


def decimal_value(value):
    from decimal import Decimal
    return Decimal(str(value)) if value is not None else None


def history_table(headers, rows):
    recent = panel_table(headers, rows[:5], _("No activity yet."))
    if len(rows) <= 5:
        return recent
    return format_html('{}<details class="mt-3"><summary class="cursor-pointer text-sm font-medium">{}</summary><div class="mt-3">{}</div></details>',
                       recent, _("View more (%(count)s older activities)") % {"count": len(rows) - 5}, panel_table(headers, rows[5:], ""))
