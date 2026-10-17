from django.test.runner import DiscoverRunner


class FoundationTestRunner(DiscoverRunner):
    def setup_databases(self, **kwargs):
        if "aliases" in kwargs and not kwargs["aliases"]:
            return []
        raise RuntimeError("Phase 02 permits database-free tests only; migrations are prohibited.")
