"""Actual owned loopback Apache+TLS+CGI integration; no browser or host writes."""

import datetime
import hashlib
from http.cookiejar import CookieJar
import ipaddress
import json
import os
from pathlib import Path
import re
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID, ExtendedKeyUsageOID
from apps.runtime.gateway import render


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def check(run):
    try:
        from scripts.run_tests import BACKEND, available_port
    except ModuleNotFoundError:
        from run_tests import BACKEND, available_port
    if run.marker.get("engine") != "mariadb" or not Path("/usr/sbin/httpd").is_file():
        raise RuntimeError(
            "This equivalent gateway gate requires owned MariaDB and the inspected native Apache binary."
        )
    root = run.runtime / "cgi-gateway"
    root.mkdir(mode=0o700)
    public = root / "public"
    public.mkdir(mode=0o700)
    # A no-space interpreter path is necessary for the kernel CGI shebang.
    backend = root / "backend"
    backend.symlink_to(BACKEND, target_is_directory=True)
    api = public / "api"
    render(api, backend=str(backend), uid=os.getuid(), host="api.example.test")
    stub = api / "bazar.cgi"
    code = stub.read_text().replace(
        "from config.cgi import main\nmain()",
        """from unittest.mock import patch
import environ
import config.environment
with patch.object(config.environment,"load_environment",return_value=environ.Env()):
    import django
    django.setup()
    from django.conf import settings
    settings.ROOT_URLCONF="scripts.cgi_test_urls"
    from config.cgi import main
    main()""",
    )
    stub.write_text(code)
    (public / "frontend-placeholder").write_text("Synthetic unchanged frontend")
    (public / ".htaccess").write_text(
        "RewriteEngine On\nRewriteCond %{HTTP_HOST} ^web\\.example\\.test$ [NC]\nRewriteRule ^$ frontend-placeholder [END]\n"
    )
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Owned CGI test CA")])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(minutes=1))
        .not_valid_after(now + datetime.timedelta(days=1))
        .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
        .add_extension(
            x509.SubjectAlternativeName(
                [
                    x509.DNSName("api.example.test"),
                    x509.DNSName("web.example.test"),
                    x509.IPAddress(ipaddress.ip_address("127.0.0.1")),
                ]
            ),
            critical=False,
        )
        .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
        .sign(key, hashes.SHA256())
    )
    for path, data in [
        (
            root / "tls.key",
            key.private_bytes(
                serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
            ),
        ),
        (root / "tls.pem", cert.public_bytes(serialization.Encoding.PEM)),
    ]:
        with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as f:
            f.write(data)
    secure_port, plain_port = available_port(), available_port()
    while secure_port == plain_port:
        plain_port = available_port()
    identifier = run.identifier
    password = run.generated["REZAYI_TEST_APP_DB_PASSWORD"]
    production = {
        "DJANGO_SETTINGS_MODULE": "config.settings.production",
        "DJANGO_DEBUG": "false",
        "DJANGO_SECRET_KEY": run.generated["REZAYI_TEST_SIGNING_KEY"],
        "MFA_ENCRYPTION_KEY": run.generated["REZAYI_TEST_ENCRYPTION_KEY"],
        "DATABASE_URL": f"mariadb://app_{identifier}:{password}@localhost/{run.marker['database']}?unix_socket={run.marker['socket']}",
        "DJANGO_ALLOWED_HOSTS": "api.example.test",
        "FRONTEND_ORIGIN": "https://web.example.test",
        "DJANGO_CORS_ALLOWED_ORIGINS": "https://web.example.test",
        "DJANGO_CSRF_TRUSTED_ORIGINS": "https://web.example.test",
        "OWNER_MFA_REQUIRED": "false",
        "PUBLIC_SIGNUP_ENABLED": "false",
        "GOOGLE_OAUTH_ENABLED": "false",
        "GOOGLE_CLIENT_ID": "",
        "GOOGLE_CLIENT_SECRET": "",
        "GOOGLE_REDIRECT_URI": "",
        "ACCOUNT_EMAIL_TRANSPORT": "smtp",
        "DEFAULT_FROM_EMAIL": "synthetic@example.test",
        "EMAIL_HOST": "smtp.example.test",
        "EMAIL_HOST_USER": "synthetic@example.test",
        "EMAIL_HOST_PASSWORD": "synthetic-unused-gateway-password",
        "EMAIL_PORT": "587",
        "EMAIL_USE_TLS": "true",
        "EMAIL_USE_SSL": "false",
        "EMAIL_TIMEOUT": "3",
        "CATALOGUE_TRANSLATION_ENABLED": "false",
        "CATALOGUE_S3_BUCKET": "",
        "GROQ_API_KEY": "",
        "GROQ_DAILY_CALL_LIMIT": "0",
        "GROQ_DAILY_CHARACTER_LIMIT": "0",
        "DATA_ROOT": str(run.runtime / "data"),
        "PRIVATE_MAIL_ROOT": str(run.runtime / "data/private-mail"),
        "PYTHONDONTWRITEBYTECODE": "1",
    }
    modules = ["mpm_prefork", "unixd", "authz_core", "authz_host", "mime", "dir", "env", "cgi", "rewrite", "ssl"]
    conf = [
        f'ServerRoot "{root}"',
        f'PidFile "{root}/httpd.pid"',
        f'ErrorLog "{run.evidence}/cgi-apache-error.log"',
        "ServerName api.example.test",
        f"Listen 127.0.0.1:{secure_port}",
        f"Listen 127.0.0.1:{plain_port}",
        f'User "#{os.getuid()}"',
        f'Group "#{os.getgid()}"',
        "StartServers 1",
        "MinSpareServers 1",
        "MaxSpareServers 1",
        # -X owns one foreground process; recycling it would stop this harness mid-sequence.
        "ServerLimit 2",
        "MaxRequestWorkers 2",
        "MaxConnectionsPerChild 0",
        "Timeout 30",
        "SSLSessionCache none",
        f"Mutex file:{root}",
        f'TypesConfig "{root}/mime.types"',
    ]
    conf[0:0] = [f"LoadModule {m}_module /usr/libexec/apache2/mod_{m}.so" for m in modules]
    (root / "mime.types").write_text("")
    conf.extend(
        [
            "PassEnv " + " ".join(production),
            f'<Directory "{public}">',
            "AllowOverride All",
            "Require all granted",
            "Options -Indexes",
            "</Directory>",
        ]
    )
    for host, docroot in [("api.example.test", api), ("web.example.test", public)]:
        conf.extend(
            [
                f"<VirtualHost 127.0.0.1:{secure_port}>",
                f"ServerName {host}",
                f'DocumentRoot "{docroot}"',
                "SSLEngine on",
                f'SSLCertificateFile "{root}/tls.pem"',
                f'SSLCertificateKeyFile "{root}/tls.key"',
                "</VirtualHost>",
            ]
        )
    conf.extend(
        [
            f"<VirtualHost 127.0.0.1:{plain_port}>",
            "ServerName api.example.test",
            f'DocumentRoot "{api}"',
            "</VirtualHost>",
        ]
    )
    config = root / "httpd.conf"
    config.write_text("\n".join(conf) + "\n")
    os.chmod(config, 0o600)
    env = {**run.env, **production}
    run.command(["/usr/sbin/httpd", "-t", "-f", str(config)], "cgi-apache-syntax", env=env)
    server = run.start(["/usr/sbin/httpd", "-X", "-f", str(config)], "cgi-apache", env=env)
    context = ssl.create_default_context(cafile=str(root / "tls.pem"))
    jar = CookieJar()
    client = urllib.request.build_opener(
        urllib.request.HTTPSHandler(context=context), urllib.request.HTTPCookieProcessor(jar), NoRedirect()
    )

    def request(path, *, data=None, headers=None, plain=False, host="api.example.test", method=None):
        url = f"{'http' if plain else 'https'}://127.0.0.1:{plain_port if plain else secure_port}" + path
        req = urllib.request.Request(url, data=data, headers={"Host": host, **(headers or {})}, method=method)
        try:
            response = client.open(req, timeout=20)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, response.headers, response.read()

    try:
        deadline = time.monotonic() + 20
        while True:
            try:
                status, headers, body = request("/api/v1/health/live/")
                break
            except (OSError, urllib.error.URLError):
                if server.poll() is not None or time.monotonic() >= deadline:
                    raise RuntimeError("Owned Apache/CGI failed to start; inspect sanitized evidence.") from None
                time.sleep(0.1)
        assert status == 200 and json.loads(body)["status"] == "alive"
        assert request("/api/v1/health/ready/")[0] == 200
        status, headers, _ = request("/api/v1/health/live/", plain=True)
        assert status == 308 and headers["Location"].startswith("https://api.example.test/")
        assert request("/api/v1/health/live/", host="evil.example.test")[0] in (400, 404)
        assert request("/", host="web.example.test")[2] == b"Synthetic unchanged frontend"
        assert request("/api/__gateway__/echo/", host="web.example.test")[0] == 404
        for private in ("/.env", "/data/private-evidence/", "/../config/.env", "/backups/"):
            assert request(private)[0] in (400, 403, 404)
        status, headers, body = request(
            "/__gateway__/echo/?q=%D8%AF%D8%B1%DB%8C", headers={"Authorization": "Bearer synthetic-gateway-probe"}
        )
        result = json.loads(body)
        assert (
            status == 200
            and result["secure"]
            and result["path"] == "/__gateway__/echo/"
            and result["query"]["q"] == "دری"
            and result["authorization_present"]
        )
        assert len(headers.get_all("Set-Cookie")) == 2
        status, _, body = request("/api/v1/auth/csrf/", headers={"Origin": "https://web.example.test"})
        csrf = json.loads(body)["csrf_token"]
        boundary = "OwnedCGIBoundary"
        blob = b"\x00synthetic-binary\xff"
        multipart = (
            f'--{boundary}\r\nContent-Disposition: form-data; name="label"\r\n\r\n'.encode()
            + "دری".encode()
            + f'\r\n--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="probe.bin"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode()
            + blob
            + f"\r\n--{boundary}--\r\n".encode()
        )
        status, _, body = request(
            "/__gateway__/echo/",
            data=multipart,
            headers={
                "Content-Type": "multipart/form-data; boundary=" + boundary,
                "X-CSRFToken": csrf,
                "Origin": "https://web.example.test",
            },
        )
        result = json.loads(body)
        assert (
            status == 200
            and result["post"]["label"] == "دری"
            and result["files"]["file"]["sha256"] == hashlib.sha256(blob).hexdigest()
        )
        payload = json.dumps({"email": "phase03-buyer@example.test", "password": run.password}).encode()
        status, headers, _ = request(
            "/api/v1/auth/buyer/signin/",
            data=payload,
            headers={"Content-Type": "application/json", "X-CSRFToken": csrf, "Origin": "https://web.example.test"},
        )
        assert status == 200
        assert any("Secure" in value and "HttpOnly" in value for value in headers.get_all("Set-Cookie", []))
        assert request("/api/v1/auth/buyer/session/")[0] == 200
        assert request("/api/v1/auth/seller/session/")[0] == 403
        payment_checked = False
        if run.phase == "phase-12-payments":
            import uuid
            import io
            from PIL import Image

            _, output = run.python(
                "-c",
                "import django;django.setup();from apps.orders.models import SellerOrder;print(SellerOrder.objects.filter(buyer__user__email='phase12-buyer@example.test',payment_method='cod').first().pk)",
                name="cgi-payment-owned-order",
            )
            order_id = output.strip()
            assert re.fullmatch(r"[0-9a-f-]{36}", order_id)

            def signin_payment(context, email):
                status, _, body = request("/api/v1/auth/csrf/")
                assert status == 200
                token = json.loads(body)["csrf_token"]
                status, _, _ = request(
                    f"/api/v1/auth/{context}/signin/",
                    data=json.dumps({"email": email, "password": run.password}).encode(),
                    headers={
                        "Content-Type": "application/json",
                        "X-CSRFToken": token,
                        "Origin": "https://web.example.test",
                    },
                )
                assert status == 200
                return json.loads(request("/api/v1/auth/csrf/")[2])["csrf_token"]

            csrf = signin_payment("buyer", "phase12-buyer@example.test")
            image = io.BytesIO()
            Image.new("RGB", (32, 24), (2, 112, 210)).save(image, format="PNG")
            boundary = "OwnedPaymentImage"
            key = str(uuid.uuid4())
            multipart = (
                f'--{boundary}\r\nContent-Disposition: form-data; name="command_id"\r\n\r\n{key}\r\n--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="synthetic.png"\r\nContent-Type: image/png\r\n\r\n'.encode()
                + image.getvalue()
                + f"\r\n--{boundary}--\r\n".encode()
            )
            path = f"/api/v1/payments/buyer/orders/{order_id}/uploads/"
            assert (
                request(
                    path,
                    data=multipart,
                    headers={
                        "Content-Type": "multipart/form-data; boundary=" + boundary,
                        "Origin": "https://web.example.test",
                    },
                )[0]
                == 403
            )
            status, _, body = request(
                path,
                data=multipart,
                headers={
                    "Content-Type": "multipart/form-data; boundary=" + boundary,
                    "X-CSRFToken": csrf,
                    "Origin": "https://web.example.test",
                },
            )
            assert status == 201
            image_id = json.loads(body)["id"]
            path = f"/api/v1/payments/buyer/evidence/{image_id}/"
            status, headers, body = request(path)
            assert (
                status == 200
                and headers["Content-Type"] == "image/jpeg"
                and "no-store" in headers["Cache-Control"]
                and body.startswith(b"\xff\xd8")
            )
            assert request(path, method="HEAD")[0] == 200
            claim = {
                "command_id": str(uuid.uuid4()),
                "version": 0,
                "amount": "1.00",
                "currency": "AFN",
                "paid_at": (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=1)).isoformat(),
                "description": "Synthetic CGI actual payment claim",
                "evidence": [image_id],
            }
            status, _, body = request(
                f"/api/v1/payments/buyer/orders/{order_id}/claims/",
                data=json.dumps(claim).encode(),
                headers={"Content-Type": "application/json", "X-CSRFToken": csrf, "Origin": "https://web.example.test"},
            )
            result = json.loads(body)
            assert (
                status == 201
                and result["current"]["confirmed_total"] == "0.00"
                and result["current"]["allocation"] == "unreserved"
            )
            claim_id = result["outcome"]["claim"]
            csrf = signin_payment("seller", "phase12-finance@example.test")
            confirm = {
                "command_id": str(uuid.uuid4()),
                "version": 1,
                "claim_version": 1,
                "reason": "Exact seller confirmation through owned CGI",
            }
            status, _, body = request(
                f"/api/v1/payments/seller/claims/{claim_id}/confirm/",
                data=json.dumps(confirm).encode(),
                headers={"Content-Type": "application/json", "X-CSRFToken": csrf, "Origin": "https://web.example.test"},
            )
            result = json.loads(body)
            assert (
                status == 200
                and result["current"]["confirmed_total"] == "1.00"
                and result["current"]["allocation"] == "unreserved"
            )
            csrf = signin_payment("buyer", "phase03-buyer@example.test")
            assert request(path)[0] == 404
            payment_checked = True
        status, _, html = request("/admin/login/")
        token = re.search(rb'name="csrfmiddlewaretoken" value="([A-Za-z0-9]+)"', html)[1].decode()
        form = urllib.parse.urlencode(
            {
                "stage": "password",
                "email": "phase03-owner@example.test",
                "password": run.password,
                "csrfmiddlewaretoken": token,
            }
        ).encode()
        status, _, _ = request(
            "/admin/login/",
            data=form,
            headers={"Content-Type": "application/x-www-form-urlencoded", "Origin": "https://web.example.test"},
        )
        assert status in (302, 303)
        assert request("/admin/")[0] == 200
        assert request("/__gateway__/stream/")[2] == "Synthetic private streaming bytes — دری".encode()
        status, _, body = request("/__gateway__/fail/")
        assert status == 500 and b"SYNTHETIC_NEVER_PUBLIC" not in body and b"Traceback" not in body
        (run.evidence / "cgi-gateway.json").write_text(
            json.dumps(
                {
                    "native_apache_tls_cgi": "passed",
                    "production_settings": True,
                    "dml_only_database_role": True,
                    "https_and_path_info": True,
                    "csrf_secure_cookies_and_role_scope": True,
                    "password_only_native_admin": True,
                    "multipart_and_authorization": True,
                    "payment_multipart_csrf_private_bytes_exact_confirmation": payment_checked,
                    "multiple_cookie_headers": True,
                    "streaming_and_private_path_denial": True,
                    "parent_frontend_isolation": True,
                    "real_cpanel_execution": "not verified",
                },
                indent=2,
            )
            + "\n"
        )
    finally:
        run.stop_process(server)
