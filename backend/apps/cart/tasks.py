from celery import shared_task


@shared_task(name="cart.expire_guests", ignore_result=True)
def expire_guests():
    from .services import expire_guests as expire

    expire()
