"""Upgrade a populated historical Phase10 schema in the run-owned browser DB."""

import os
import uuid
import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.test")
django.setup()
from django.db import connection, transaction, DatabaseError  # noqa: E402
from django.db.migrations.executor import MigrationExecutor  # noqa: E402
from django.utils import timezone  # noqa: E402
from config.testing import assert_owned_database  # noqa: E402

assert_owned_database(connection)
executor = MigrationExecutor(connection)
targets = [("orders", "0002_agreement_guards"), ("notifications", "0006_order_cursor_guards")]
executor.migrate(targets)
apps = executor.loader.project_state(targets).apps
User = apps.get_model("accounts", "User")
Account = apps.get_model("accounts", "Account")
Profile = apps.get_model("organizations", "BusinessProfile")
Unit = apps.get_model("catalogue", "SaleUnit")
Product = apps.get_model("catalogue", "Product")
Variant = apps.get_model("catalogue", "Variant")
Cart = apps.get_model("cart", "Cart")
Submission = apps.get_model("orders", "CheckoutSubmission")
Outcome = apps.get_model("orders", "CheckoutOutcome")
Order = apps.get_model("orders", "SellerOrder")
Line = apps.get_model("orders", "OrderLine")
Invoice = apps.get_model("orders", "Invoice")
Event = apps.get_model("orders", "OrderEvent")
buyer_user = User.objects.create(
    email="upgrade-buyer@example.test", display_name="Synthetic upgrade buyer", password="!", email_verified=True
)
seller_user = User.objects.create(
    email="upgrade-seller@example.test", display_name="Synthetic upgrade seller", password="!", email_verified=True
)
buyer = Account.objects.create(user=buyer_user, context="buyer")
seller = Account.objects.create(user=seller_user, context="seller")
profile = Profile.objects.create(account=seller, kind="individual", display_name="Synthetic upgrade seller")
unit = Unit.objects.create(code="upgrade-piece", labels={"en": "Piece"}, fractional=False)
product = Product.objects.create(seller=profile, currency="AFN", pricing_mode="fixed")
variant = Variant.objects.create(
    product=product,
    sku="UPGRADE-ONE",
    definition={},
    unit=unit,
    quantity_increment="1.000",
    minimum_wholesale="1.000",
    retail="10.00",
    wholesale="9.00",
)
cart = Cart.objects.create(account=buyer)
with transaction.atomic():
    sub = Submission.objects.create(
        buyer=buyer, cart=cart, key=uuid.uuid4(), digest="a" * 64, payload={"currency": "AFN"}, selections=[]
    )
    outcome = Outcome.objects.create(submission=sub, seller=profile)
    order = Order.objects.create(
        outcome=outcome,
        buyer=buyer,
        seller=profile,
        currency="AFN",
        goods_total="20.00",
        payment_method="cod",
        accepted_at=timezone.now(),
        snapshot={
            "buyer": "Synthetic upgrade buyer",
            "seller": "Synthetic upgrade seller",
            "terms": {},
            "advance_hours": None,
        },
    )
    Line.objects.create(
        order=order,
        variant=variant,
        tier="retail",
        quantity="2.000",
        unit_price="10.00",
        goods_amount="20.00",
        snapshot={"synthetic_upgrade": True},
    )
    invoice = Invoice.objects.create(order=order, number="SYNTHETIC-UPGRADE-ONE")
    Event.objects.create(
        order=order, seller=profile, actor=buyer_user, account=buyer, context="buyer", action="fixed_order_accepted"
    )
    outcome.state = "accepted"
    outcome.version += 1
    outcome.save()
before = {
    "order": list(Order.objects.filter(pk=order.pk).values()),
    "lines": list(Line.objects.filter(order=order).values()),
    "invoice": list(Invoice.objects.filter(pk=invoice.pk).values()),
}
executor = MigrationExecutor(connection)
executor.migrate(executor.loader.graph.leaf_nodes())
from apps.orders.models import SellerOrder, OrderLine, Invoice as CurrentInvoice  # noqa: E402

current = SellerOrder.objects.get(pk=order.pk)
after_order = {
    k: v for k, v in dict(SellerOrder.objects.filter(pk=order.pk).values().get()).items() if k != "negotiation_id"
}
assert after_order == before["order"][0] and current.negotiation_id is None
assert list(OrderLine.objects.filter(order_id=order.pk).values()) == before["lines"]
assert list(CurrentInvoice.objects.filter(pk=invoice.pk).values()) == before["invoice"]
try:
    with transaction.atomic():
        SellerOrder.objects.filter(pk=order.pk).update(goods_total="1.00")
except DatabaseError:
    pass
else:
    raise AssertionError("Accepted history guard lost during upgrade")
with connection.cursor() as cursor:
    cursor.execute("SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgrelid='orders_sellerorder'::regclass")
    assert {"orders_order_retained", "orders_agreement_scope", "orders_complete_agreement"} <= {
        r[0] for r in cursor.fetchall()
    }
print("Populated Phase10 order/line/invoice preserved exactly; additive upgrade and fixed immutable guards passed.")
