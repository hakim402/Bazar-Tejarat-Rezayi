from celery import shared_task
from .translations import generate, dispatch


@shared_task(name="catalogue.generate_translation", ignore_result=True, soft_time_limit=45, time_limit=60)
def generate_translation(job_id):
    generate(job_id)


@shared_task(name="catalogue.dispatch_translations", ignore_result=True)
def dispatch_translations():
    dispatch()
