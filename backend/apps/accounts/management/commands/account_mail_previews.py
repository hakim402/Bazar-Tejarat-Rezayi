import base64
from pathlib import Path
from django.core.management.base import BaseCommand
from apps.accounts.delivery import render_account_mail


class Command(BaseCommand):
    help = "Render inert multilingual email previews. Never reads identities or issues tokens."

    def add_arguments(self, parser):
        parser.add_argument("--output", required=True)

    def handle(self, *args, **options):
        folder = Path(options["output"])
        folder.mkdir(parents=True, exist_ok=True)
        assets = Path(__file__).resolve().parents[2] / "email_assets"
        for locale in ["fa-AF", "en", "ps", "ar"]:
            logo = "data:image/png;base64," + base64.b64encode((assets / f"{locale}.png").read_bytes()).decode()
            for purpose in ["verify", "reset"]:
                subject, text, html = render_account_mail(
                    purpose,
                    locale,
                    "Example" if locale == "en" else "نمونه",
                    f"https://example.invalid/{locale}/auth/{'verify-email' if purpose == 'verify' else 'reset-password'}",
                )
                (folder / f"{locale}-{purpose}.html").write_text(html.replace("cid:rezayi-brand", logo))
                (folder / f"{locale}-{purpose}.txt").write_text(subject + "\n\n" + text)
        self.stdout.write("Eight inert HTML/plain-text previews rendered; no mail sent.")
