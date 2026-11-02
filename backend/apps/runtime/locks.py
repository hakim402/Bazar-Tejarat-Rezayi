"""Transaction-scoped serialization, including commands with no existing resource row."""
import hashlib
from django.db import connection


def lock(name):
    if not connection.in_atomic_block:
        raise RuntimeError("A durable mutex requires an enclosing transaction.")
    token = hashlib.sha256(str(name).encode()).hexdigest()
    if connection.vendor == "postgresql":
        number = name if isinstance(name, int) else int.from_bytes(bytes.fromhex(token[:16]), "big", signed=True)
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_advisory_xact_lock(%s)", [number])
    else:
        from .models import Mutex
        # get_or_create handles the unique-insert race in its own savepoint. The
        # winning row then stays locked until the OUTER transaction commits.
        Mutex.objects.get_or_create(name=token)
        Mutex.objects.select_for_update().get(pk=token)


def row_options():
    # MariaDB locks the selected joined records as well. This is stronger than
    # PostgreSQL OF self; callers retain the same parent-first lock ordering.
    return {"of": ("self",)} if connection.features.has_select_for_update_of else {}
