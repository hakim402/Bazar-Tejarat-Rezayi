"""Validate untrusted PDF structure in a bounded, isolated child process (Linux backend)."""

import io
import resource
import sys

# Apply before importing the parser. The parent also enforces a five-second deadline.
resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))
resource.setrlimit(resource.RLIMIT_CPU, (3, 3))
from pypdf import PdfReader  # noqa: E402
from pypdf.generic import IndirectObject, DictionaryObject, ArrayObject  # noqa: E402


def validate():
    content = sys.stdin.buffer.read(10 * 1024 * 1024 + 1)
    if len(content) > 10 * 1024 * 1024:
        raise ValueError
    reader = PdfReader(io.BytesIO(content), strict=True)
    if reader.is_encrypted or sum(len(v) for v in reader.xref.values()) > 10000 or not 0 < len(reader.pages) <= 1000:
        raise ValueError
    forbidden = {
        "/JS",
        "/JavaScript",
        "/Launch",
        "/EmbeddedFile",
        "/EmbeddedFiles",
        "/RichMedia",
        "/OpenAction",
        "/AA",
        "/AcroForm",
        "/XFA",
        "/Annots",
    }
    pending = [reader.root_object]
    visited = set()
    while pending:
        item = pending.pop()
        if isinstance(item, IndirectObject):
            marker = (item.idnum, item.generation)
            if marker in visited:
                continue
            visited.add(marker)
            if len(visited) > 10000:
                raise ValueError
            item = item.get_object()
        if isinstance(item, DictionaryObject):
            if forbidden.intersection(item):
                raise ValueError
            pending.extend(item.values())
        elif isinstance(item, ArrayObject):
            pending.extend(item)


if __name__ == "__main__":
    try:
        validate()
    except Exception:
        raise SystemExit(1) from None
