from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

import environ
from django.core.exceptions import ImproperlyConfigured


def load_environment(base_dir):
    env = environ.Env()
    path = Path(base_dir) / ".env"
    if path.is_file():
        env.read_env(path, overwrite=False)
    return env


def database_config(url, *, production=False, conn_max_age=0):
    if urlsplit(url).scheme in {"mysql", "mariadb"}:
        return mariadb_config(url, production=production, conn_max_age=conn_max_age)
    message = "DATABASE_URL must be an explicit supported database URL with database and credentials."
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
        if production and mode != "verify-full":
            raise ValueError
        timeout = int(options.get("connect_timeout", 3))
        if not 1 <= timeout <= 10:
            raise ValueError
        return {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": unquote(parsed.path[1:]),
            "USER": unquote(parsed.username),
            "PASSWORD": unquote(parsed.password),
            "HOST": parsed.hostname,
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
    if not re.fullmatch(r"test_rezayi_phase0[23]_[a-z0-9_]+", database["NAME"]):
        raise ImproperlyConfigured("Tests require a dedicated phase-specific isolated database.")
    database["TEST"] = {"NAME": database["NAME"]}
    return database


def mariadb_config(url, *, production=False, conn_max_age=0):
    """An explicit local socket or a remotely verified certificate, never TLS prefer."""
    try:
        p = urlsplit(url)
        query = parse_qs(p.query, strict_parsing=True)
        if (p.scheme not in {"mysql", "mariadb"} or not p.hostname or not p.username or not p.password
            or not p.path[1:] or "/" in p.path[1:] or p.fragment
            or any(len(v) != 1 for v in query.values())
            or set(query) - {"unix_socket", "ssl_ca", "connect_timeout"}
            or not 0 <= int(conn_max_age) <= 600):
            raise ValueError
        opts = {k: v[0] for k, v in query.items()}
        timeout = int(opts.get("connect_timeout", 3))
        if not 1 <= timeout <= 10:
            raise ValueError
        socket = opts.get("unix_socket")
        ca = opts.get("ssl_ca")
        if socket and (p.hostname != "localhost" or not Path(socket).is_absolute() or ca or p.port):
            raise ValueError
        if ca and (not Path(ca).is_absolute() or socket):
            raise ValueError
        if production and not (socket or ca):
            raise ValueError
        port = p.port or 3306
        if not 1 <= port <= 65535:
            raise ValueError
        options = {"charset": "utf8mb4", "connect_timeout": timeout, "isolation_level": "read committed",
                   "init_command": "SET sql_mode='STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ZERO_DATE,NO_ZERO_IN_DATE,NO_ENGINE_SUBSTITUTION', time_zone='+00:00', group_concat_max_len=1048576"}
        if socket:
            options["unix_socket"] = socket
        if ca:
            options.update(ssl={"ca": ca}, ssl_mode="VERIFY_IDENTITY")
        return {"ENGINE": "apps.runtime.backends.mysql", "NAME": unquote(p.path[1:]),
                "USER": unquote(p.username), "PASSWORD": unquote(p.password),
                "HOST": "localhost" if socket else p.hostname, "PORT": "" if socket else port,
                "CONN_MAX_AGE": int(conn_max_age), "CONN_HEALTH_CHECKS": True, "OPTIONS": options}
    except (ValueError, TypeError, AttributeError):
        raise ImproperlyConfigured("MariaDB requires an explicit database/user/password and a protected local socket or verified remote TLS in production.") from None
