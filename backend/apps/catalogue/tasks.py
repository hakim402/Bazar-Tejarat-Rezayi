def generate_translation(job_id):
    from .translations import generate
    generate(job_id)


def dispatch_translations():
    from .translations import dispatch
    dispatch()

