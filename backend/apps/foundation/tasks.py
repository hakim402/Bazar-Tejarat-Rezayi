"""Side-effect-free diagnostic used by the bounded durable runner checks."""
from uuid import UUID


def diagnostic(nonce):
    return {"ok": True, "nonce": str(UUID(nonce))}
