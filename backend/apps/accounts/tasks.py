def dispatch_mail():
    from .services.delivery import sweep_mail
    sweep_mail()

