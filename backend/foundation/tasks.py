from uuid import UUID

from celery import shared_task


@shared_task(name="foundation.diagnostic", ignore_result=False, expires=60, soft_time_limit=5, time_limit=10)
def diagnostic(nonce):
    return {"ok": True, "nonce": str(UUID(nonce))}
