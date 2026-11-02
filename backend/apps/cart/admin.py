from apps.accounts.admin import owner_site
from apps.orders.admin import MetadataAdmin
from .models import Cart, CartLine, CartCommand, MergeReceipt

for model in [Cart, CartLine, CartCommand, MergeReceipt]:
    owner_site.register(model, MetadataAdmin)
