import os
from uuid import uuid4

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.development")
from config.celery import app

nonce = str(uuid4())
try:
    task = app.send_task("foundation.diagnostic", args=[nonce], argsrepr="(<diagnostic nonce>,)", expires=60)
    result = task.get(timeout=20)
    assert result == {"ok": True, "nonce": nonce}
    task.forget()
    print("Worker executed diagnostic task and returned its correlated result; result removed.")
except Exception as exc:
    print("Worker diagnostic failed:", type(exc).__name__, "(details withheld)")
    raise SystemExit(1) from None
