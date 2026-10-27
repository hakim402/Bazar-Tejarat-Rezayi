"""Only implemented marketplace contexts may enter public REST adapters."""
class MarketplaceContext:
    regex = "buyer|seller"

    def to_python(self, value):
        return value

    def to_url(self, value):
        return value


class SellerContext(MarketplaceContext):
    regex = "seller"
