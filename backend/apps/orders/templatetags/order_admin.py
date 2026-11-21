"""Display helpers for native order review forms; no workflow decisions."""

from django import template

register = template.Library()


@register.filter
def admin_amount(value):
    from apps.accounts.admin.display import money
    from apps.orders.admin_presentation import decimal_value
    return money(decimal_value(value))


@register.filter
def admin_quantity(value):
    from apps.accounts.admin.display import quantity
    return quantity(value)


@register.filter
def admin_badge(value):
    from apps.accounts.admin.display import state_badge
    return state_badge(value)


@register.filter
def order_product(value):
    from apps.orders.admin_presentation import line_product
    return line_product(value)


@register.filter
def admin_context(value):
    from django.utils.translation import gettext
    labels = {"owner": "Super admin", "staff": "Staff", "seller": "Seller", "buyer": "Buyer", "worker": "Background worker", "system": "System"}
    return gettext(labels.get(value, value))
