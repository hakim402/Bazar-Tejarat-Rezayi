from celery import shared_task
from .delivery import sweep_mail


@shared_task(name="accounts.dispatch_mail", ignore_result=True)
def dispatch_mail():
    sweep_mail()
