"""Read-only cart records.

Carts are transient buyer state. These pages show the operational picture
(account, state, counts, versions and timestamps) without reproducing the
buyer's cart contents, and they never mutate a cart.
"""

from django.db.models import Count
from django.utils import timezone
from unfold.decorators import display

from apps.accounts.admin import owner_site
from apps.accounts.admin.display import quantity, record_identity, short_id
from apps.accounts.admin.presentation import label
from apps.accounts.admin.records import MetadataAdmin
from apps.catalogue.admin.presentation import ProductIdentityMixin
from .models import Cart, CartLine, CartCommand, MergeReceipt


CART_TONES = {"active": "info", "consumed": "default", "expired": "warning"}
CART_LABELS = {"active": label("Active"), "consumed": label("Consumed"), "expired": label("Expired")}
COMMAND_TONES = {"applied": "success", "rejected": "warning"}
MERGE_TONES = {"merged": "success", "not_merged": "default"}
TIER_TONES = {"retail": "info", "wholesale": "primary"}
TIER_LABELS = {"retail": label("Retail"), "wholesale": label("Wholesale")}


def cart_identity(cart):
    """Identity of the buyer behind a cart, or the guest key for an anonymous one."""
    if cart.account_id:
        user = cart.account.user
        return record_identity(user.display_name or user.email, user.email, glyph="person")
    return record_identity(label("Guest cart"), str(cart.guest_key or ""), glyph="person")


class CartAdmin(MetadataAdmin):
    restriction_reason = (
        "Read-only cart state. Carts change only through the supported cart commands; "
        "this page never creates, merges or expires a cart."
    )
    fields = ["cart_identity", "cart_state", "line_count", "version", "expires_at", "updated_at",
              "account", "guest_key", "consumed_by"]
    primary_fields = ["cart_identity", "cart_state", "line_count", "version", "expires_at", "updated_at"]
    technical_fields = ["account", "guest_key", "consumed_by"]
    list_display = ["cart_identity", "cart_state", "line_count", "version", "expires_at", "updated_at"]
    ordering = ["-updated_at"]
    search_fields = ["account__user__display_name", "account__user__email"]
    search_help_text = label("Find by name or email")

    def get_queryset(self, request):
        return super().get_queryset(request).select_related("account__user").annotate(line_total=Count("lines"))

    def get_fieldsets(self, request, obj=None):
        return [
            (label("Cart"), {"fields": list(self.primary_fields)}),
            (label("Technical record"), {"fields": list(self.technical_fields), "description": self.restriction_reason}),
        ]

    @display(description=label("Cart"), ordering="account__user__display_name")
    def cart_identity(self, obj):
        return cart_identity(obj)

    @display(description=label("State"), ordering="consumed_by_id", label=CART_TONES)
    def cart_state(self, obj):
        if obj.consumed_by_id:
            return "consumed", CART_LABELS["consumed"]
        if obj.expires_at and obj.expires_at <= timezone.now():
            return "expired", CART_LABELS["expired"]
        return "active", CART_LABELS["active"]

    @display(description=label("Items"))
    def line_count(self, obj):
        return obj.line_total


class CartLineAdmin(ProductIdentityMixin, MetadataAdmin):
    restriction_reason = (
        "Read-only cart lines. Line changes happen only through the supported cart commands."
    )
    product_path = "variant__product"
    fields = ["product_identity", "seller_identity", "cart_identity", "line_tier", "line_quantity",
              "cart", "variant", "version"]
    primary_fields = ["product_identity", "seller_identity", "cart_identity", "line_tier", "line_quantity"]
    technical_fields = ["cart", "variant", "version"]
    list_display = ["product_identity", "seller_identity", "cart_identity", "line_tier", "line_quantity"]
    list_filter = ["tier"]
    ordering = ["-pk"]
    search_fields = ["variant__sku", "variant__product__seller__display_name",
                     "variant__product__seller__account__user__email", "cart__account__user__email"]
    search_help_text = label("Find by SKU, seller or email")

    def get_fieldsets(self, request, obj=None):
        return [
            (label("Cart line"), {"fields": list(self.primary_fields)}),
            (label("Technical record"), {"fields": list(self.technical_fields), "description": self.restriction_reason}),
        ]

    @display(description=label("Cart"), ordering="cart__account__user__display_name")
    def cart_identity(self, obj):
        return cart_identity(obj.cart)

    @display(description=label("Tier"), ordering="tier", label=TIER_TONES)
    def line_tier(self, obj):
        return obj.tier, TIER_LABELS.get(obj.tier, obj.tier)

    @display(description=label("Quantity"), ordering="quantity")
    def line_quantity(self, obj):
        return quantity(obj.quantity)


class CartCommandAdmin(MetadataAdmin):
    restriction_reason = (
        "Read-only command history. Replayed commands are deduplicated by their key; "
        "this page never issues or replays a cart command."
    )
    fields = ["cart_identity", "command_key", "command_state", "created_at", "digest"]
    primary_fields = ["cart_identity", "command_key", "command_state", "created_at"]
    technical_fields = ["digest"]
    list_display = ["cart_identity", "command_key", "command_state", "created_at"]
    ordering = ["-created_at"]

    def get_queryset(self, request):
        return super().get_queryset(request).select_related("cart__account__user")

    def get_fieldsets(self, request, obj=None):
        return [
            (label("Command"), {"fields": list(self.primary_fields)}),
            (label("Technical record"), {"fields": list(self.technical_fields), "description": self.restriction_reason}),
        ]

    @display(description=label("Cart"), ordering="cart__account__user__display_name")
    def cart_identity(self, obj):
        return cart_identity(obj.cart)

    @display(description=label("Command"), ordering="key")
    def command_key(self, obj):
        return short_id(obj.key)

    @display(description=label("State"), ordering="created_at", label=COMMAND_TONES)
    def command_state(self, obj):
        outcome = obj.outcome if isinstance(obj.outcome, dict) else {}
        if outcome.get("rejected"):
            return "rejected", label("Rejected")
        return "applied", label("Applied")


class MergeReceiptAdmin(MetadataAdmin):
    restriction_reason = (
        "Read-only merge receipt. A guest cart merges once into its buyer cart; "
        "this page never merges or reverses a cart."
    )
    fields = ["guest_identity", "buyer_identity", "merge_state", "merged_lines", "created_at", "key"]
    primary_fields = ["guest_identity", "buyer_identity", "merge_state", "merged_lines", "created_at"]
    technical_fields = ["key"]
    list_display = ["guest_identity", "buyer_identity", "merge_state", "merged_lines", "created_at"]
    ordering = ["-created_at"]

    def get_queryset(self, request):
        return super().get_queryset(request).select_related("guest__account__user", "buyer__account__user")

    def get_fieldsets(self, request, obj=None):
        return [
            (label("Merge receipt"), {"fields": list(self.primary_fields)}),
            (label("Technical record"), {"fields": list(self.technical_fields), "description": self.restriction_reason}),
        ]

    @display(description=label("Guest cart"), ordering="guest__updated_at")
    def guest_identity(self, obj):
        return cart_identity(obj.guest)

    @display(description=label("Buyer cart"), ordering="buyer__updated_at")
    def buyer_identity(self, obj):
        return cart_identity(obj.buyer)

    @display(description=label("State"), ordering="created_at", label=MERGE_TONES)
    def merge_state(self, obj):
        outcome = obj.outcome if isinstance(obj.outcome, dict) else {}
        if outcome.get("merged"):
            return "merged", label("Merged")
        return "not_merged", label("Not merged")

    @display(description=label("Items"))
    def merged_lines(self, obj):
        outcome = obj.outcome if isinstance(obj.outcome, dict) else {}
        return quantity(outcome.get("lines"))


owner_site.register(Cart, CartAdmin)
owner_site.register(CartLine, CartLineAdmin)
owner_site.register(CartCommand, CartCommandAdmin)
owner_site.register(MergeReceipt, MergeReceiptAdmin)
