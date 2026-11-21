"""Accounts admin package (split from the former monolithic admin.py).

The public surface is unchanged: ``from apps.accounts.admin import owner_site``
still resolves here, so every dependent app, ``config.urls`` and the test suite
keep working without edits. Importing the submodules registers each ModelAdmin
in the original order (User, Account, AuditEvent, Group), then the allowlisted
metadata records.
"""
from . import records as admin_records
from .site import OwnerSite, owner_site

# Registration side effects, in the original order.
from . import identities  # noqa: E402,F401  registers User
from . import accounts  # noqa: E402,F401  registers Account
from . import addresses  # noqa: E402,F401  registers Address
from . import audit  # noqa: E402,F401  registers AuditEvent
from . import roles  # noqa: E402,F401  registers Group

# Explicit allowlisted metadata; never register authentication backing fields wholesale.
admin_records.register(owner_site)

__all__ = ["OwnerSite", "owner_site"]
