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


@register.filter
def admin_buyer(order):
    from apps.orders.admin_presentation import account_cell
    return account_cell(order.buyer)


@register.filter
def admin_seller(order):
    from apps.catalogue.admin.presentation import seller_cell
    return seller_cell(order.seller)


@register.filter
def admin_account(account):
    from apps.orders.admin_presentation import account_cell
    return account_cell(account)


@register.filter
def admin_business(profile):
    from apps.catalogue.admin.presentation import seller_cell
    return seller_cell(profile)
