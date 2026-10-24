import os

bind = os.environ.get("GUNICORN_BIND", "127.0.0.1:8100")
workers = int(os.environ.get("WEB_CONCURRENCY", "1"))
timeout = 30
graceful_timeout = 30
accesslog = None
errorlog = "-"
forwarded_allow_ips = ""
# Native local/test serving needs no administration socket in the owner's home.
control_socket_disable = True
