"""Actual narrow-role guard audit; only the maintained owned-run settings are accepted."""
import os
from urllib.parse import quote
from unittest.mock import patch
import environ
import config.environment


def main():
    from config.testing import ownership_manifest
    marker = ownership_manifest()
    if marker.get("engine") != "mariadb":
        raise RuntimeError("This verification requires an owned MariaDB run.")
    identifier = marker["run_id"]
    password = os.environ["REZAYI_TEST_APP_DB_PASSWORD"]
    os.environ.update(DJANGO_SETTINGS_MODULE="config.settings.production",
        DATABASE_URL=f"mariadb://app_{identifier}:{quote(password, safe='')}@localhost/{marker['database']}?unix_socket={marker['socket']}",
        DJANGO_DEBUG="false", DJANGO_ALLOWED_HOSTS="api.example.test",
        DJANGO_CORS_ALLOWED_ORIGINS="https://web.example.test", DJANGO_CSRF_TRUSTED_ORIGINS="https://web.example.test",
        FRONTEND_ORIGIN="https://web.example.test", OWNER_MFA_REQUIRED="false", PUBLIC_SIGNUP_ENABLED="false",
        GOOGLE_OAUTH_ENABLED="false", GOOGLE_CLIENT_ID="", GOOGLE_CLIENT_SECRET="", GOOGLE_REDIRECT_URI="",
        ACCOUNT_EMAIL_TRANSPORT="smtp", DEFAULT_FROM_EMAIL="sender@example.test", EMAIL_HOST="smtp.example.test",
        EMAIL_HOST_USER="sender@example.test", EMAIL_HOST_PASSWORD="synthetic-unused-smtp-password",
        EMAIL_PORT="587", EMAIL_USE_TLS="true", EMAIL_USE_SSL="false", EMAIL_TIMEOUT="3",
        CATALOGUE_TRANSLATION_ENABLED="false", CATALOGUE_S3_BUCKET="", GROQ_API_KEY="",
        GROQ_DAILY_CALL_LIMIT="0", GROQ_DAILY_CHARACTER_LIMIT="0")
    import django
    with patch.object(config.environment, "load_environment", return_value=environ.Env()):
        django.setup()
    from django.db import connection, DatabaseError
    from apps.runtime.mariadb.schema import verify
    with connection.cursor() as cursor:
        cursor.execute("SELECT CURRENT_USER(),@@socket,@@datadir")
        user, socket, datadir = cursor.fetchone()
        if user.split("@")[0] != "app_" + identifier or socket != marker["socket"] or datadir.rstrip("/") != marker["datadir"]:
            raise RuntimeError("Narrow-role verification refused a foreign target.")
    verify()
    try:
        with connection.cursor() as cursor:
            cursor.execute("DROP TRIGGER inventory_batch_update_guard")
    except DatabaseError as error:
        if error.args[0] not in {1142, 1227}:
            raise RuntimeError("Unexpected DDL result; integrity permission proof failed.") from None
    else:
        raise RuntimeError("The application role unexpectedly has DDL authority.")
    verify()
    connection.close()
    print("DML-only runtime role verified native guards; trigger removal denied; no provider calls.")


if __name__ == "__main__":
    main()
