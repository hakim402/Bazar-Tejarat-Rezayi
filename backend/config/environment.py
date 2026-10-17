import os
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

import environ
from django.core.exceptions import ImproperlyConfigured


def load_environment(base_dir):
    env = environ.Env()
    path = Path(os.environ.get("DJANGO_ENV_FILE", str(base_dir / ".env")))
    if not path.is_absolute():
        raise ImproperlyConfigured("DJANGO_ENV_FILE must be an absolute path.")
    if "DJANGO_ENV_FILE" in os.environ and not path.is_file():
        raise ImproperlyConfigured("The selected environment file does not exist.")
    if path.is_file():
        env.read_env(path, overwrite=False)
    return env


def database_config(url, *, production=False, host_override="", conn_max_age=0):
    message = "DATABASE_URL must be an explicit PostgreSQL URL with database and credentials."
    try:
        parsed = urlsplit(url)
        if parsed.scheme not in {"postgres", "postgresql"}:
            raise ValueError
        if not all((parsed.hostname, parsed.username, parsed.password, parsed.path.strip("/"))):
            raise ValueError
        if parsed.fragment or "/" in parsed.path.strip("/"):
            raise ValueError
        port = parsed.port or 5432
        if not 1 <= port <= 65535 or not 0 <= int(conn_max_age) <= 600:
            raise ValueError
        query = parse_qs(parsed.query, strict_parsing=True)
        if set(query) - {"sslmode", "sslrootcert", "connect_timeout"}:
            raise ValueError
        if any(len(v) != 1 for v in query.values()):
            raise ValueError
        options = {k: v[0] for k, v in query.items()}
        mode = options.get("sslmode", "verify-full" if production else "disable")
        if mode not in {"disable", "allow", "prefer", "require", "verify-ca", "verify-full"}:
            raise ValueError
        if production and (mode != "verify-full" or host_override):
            raise ValueError
        timeout = int(options.get("connect_timeout", 3))
        if not 1 <= timeout <= 10:
            raise ValueError
        if host_override and parsed.hostname not in {"localhost", "127.0.0.1", "::1"}:
            raise ValueError
        if host_override and not all(c.isalnum() or c in ".-" for c in host_override):
            raise ValueError
        return {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": unquote(parsed.path[1:]),
            "USER": unquote(parsed.username),
            "PASSWORD": unquote(parsed.password),
            "HOST": host_override or parsed.hostname,
            "PORT": port,
            "CONN_MAX_AGE": int(conn_max_age),
            "CONN_HEALTH_CHECKS": True,
            "OPTIONS": {**options, "sslmode": mode, "connect_timeout": timeout},
        }
    except (ValueError, TypeError, AttributeError):
        raise ImproperlyConfigured(message) from None


def isolated_database(url):
    import re

    database = database_config(url)
    if not re.fullmatch(r"test_rezayi_phase02_[a-z0-9_]+", database["NAME"]):
        raise ImproperlyConfigured("Tests require a dedicated test_rezayi_phase02_ database.")
    database["TEST"] = {"NAME": database["NAME"]}
    return database
