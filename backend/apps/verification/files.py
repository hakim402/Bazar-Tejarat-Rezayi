"""Bounded content validation; original names never become storage keys or response metadata."""

import hashlib
import io
import re
import uuid
import warnings
import subprocess
import sys

from PIL import Image
from rest_framework.exceptions import ValidationError

MAX_BYTES = 10 * 1024 * 1024
MAX_FILES = 10


def validate_file(upload):
    if upload.size > MAX_BYTES or upload.size == 0 or re.search(r"[/\\\x00-\x1f]", upload.name):
        raise ValidationError({"file": ["Use a valid PDF, JPEG or PNG of at most 10 MiB."]})
    content = upload.read(MAX_BYTES + 1)
    if len(content) > MAX_BYTES:
        raise ValidationError({"file": ["File exceeds the size limit."]})
    extension = upload.name.rsplit(".", 1)[-1].lower()
    try:
        if extension == "pdf" and upload.content_type == "application/pdf":
            if not content.startswith(b"%PDF-") or not content.rstrip().endswith(b"%%EOF"):
                raise ValueError
            if any(
                word in content
                for word in (
                    b"/JavaScript",
                    b"/JS",
                    b"/Launch",
                    b"/EmbeddedFile",
                    b"/RichMedia",
                    b"/OpenAction",
                    b"/AA",
                )
            ):
                raise ValueError
            subprocess.run(
                [sys.executable, "-m", "apps.verification.pdf_check"],
                input=content,
                capture_output=True,
                timeout=5,
                check=True,
            )
            kind = "application/pdf"
        else:
            formats = {"png": ("PNG", "image/png"), "jpg": ("JPEG", "image/jpeg"), "jpeg": ("JPEG", "image/jpeg")}
            expected, kind = formats[extension]
            if upload.content_type != kind:
                raise ValueError
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                with Image.open(io.BytesIO(content), formats=[expected]) as image:
                    if image.width * image.height > 20_000_000:
                        raise ValueError
                    image.verify()
                with Image.open(io.BytesIO(content), formats=[expected]) as image:
                    image.load()
    except Exception:
        raise ValidationError(
            {"file": ["The file content could not be validated. Use a plain PDF, JPEG or PNG."]}
        ) from None
    return content, kind, hashlib.sha256(content).hexdigest(), "evidence/" + uuid.uuid4().hex
