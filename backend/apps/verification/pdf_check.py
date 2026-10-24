"""Validate untrusted PDFs with CPU/time bounds and platform-specific memory isolation."""

import io
import resource
import sys
import subprocess
import time

MEMORY_LIMIT = 512 * 1024 * 1024


def bounded_macos_parser(content):
    """Darwin rejects RLIMIT_AS; supervise parser RSS from a separate process instead."""
    process = subprocess.Popen([sys.executable, "-m", "apps.verification.pdf_check", "--parse"],
                               stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    deadline = time.monotonic() + 4
    try:
        first = True
        while True:
            try:
                process.communicate(input=content if first else None, timeout=0.02)
                return process.returncode == 0
            except subprocess.TimeoutExpired:
                first = False
            if time.monotonic() >= deadline:
                return False
            memory = subprocess.run(["/bin/ps", "-o", "rss=", "-p", str(process.pid)],
                                    capture_output=True, timeout=0.2, check=False)
            if process.poll() is not None:
                return process.returncode == 0
            if memory.returncode or not memory.stdout.strip():
                return False  # No unmonitored parser fallback.
            if int(memory.stdout) * 1024 > MEMORY_LIMIT:
                return False
    finally:
        if process.poll() is None:
            process.kill()
        process.wait(timeout=1)


def validate():
    # Linux production keeps its kernel-enforced address-space cap. Darwin uses the
    # separate RSS supervisor above; CPU and the outer five-second deadline remain.
    if sys.platform != "darwin":
        resource.setrlimit(resource.RLIMIT_AS, (MEMORY_LIMIT, MEMORY_LIMIT))
    resource.setrlimit(resource.RLIMIT_CPU, (3, 3))
    from pypdf import PdfReader
    from pypdf.generic import IndirectObject, DictionaryObject, ArrayObject

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
        if sys.platform == "darwin" and "--parse" not in sys.argv:
            content = sys.stdin.buffer.read(10 * 1024 * 1024 + 1)
            if len(content) > 10 * 1024 * 1024 or not bounded_macos_parser(content):
                raise ValueError
        else:
            validate()
    except Exception:
        raise SystemExit(1) from None
