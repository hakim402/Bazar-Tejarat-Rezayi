import os
import secrets
from pathlib import Path

from django.conf import settings
from django.core.mail.backends.base import BaseEmailBackend


class PrivateCaptureBackend(BaseEmailBackend):
    def send_messages(self, email_messages):
        folder = Path(settings.PRIVATE_MAIL_ROOT)
        folder.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(folder, 0o700)
        count = 0
        for message in email_messages:
            target = folder / (secrets.token_hex(16) + ".eml")
            descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, "wb") as output:
                output.write(message.message().as_bytes())
            count += 1
        return count
