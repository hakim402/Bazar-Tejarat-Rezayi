import os

bind = "0.0.0.0:8000"
workers = int(os.environ.get("WEB_CONCURRENCY", "2"))
timeout = 30
graceful_timeout = 30
accesslog = None
errorlog = "-"
forwarded_allow_ips = ""
