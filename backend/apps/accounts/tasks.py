def dispatch_mail():
    from .delivery import sweep_mail
    sweep_mail()

