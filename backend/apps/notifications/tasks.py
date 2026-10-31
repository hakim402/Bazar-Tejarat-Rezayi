from celery import shared_task


@shared_task(name="notifications.sweep", ignore_result=True)
def sweep_notifications():
    from .delivery import sweep
    from apps.messaging.media import sweep_unbound

    sweep()
    sweep_unbound()
    from .order_events import sweep_orders

    sweep_orders()
