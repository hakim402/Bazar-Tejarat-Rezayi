"""Compile project locale .po catalogues to .mo without host gettext binaries.

Usage: python backend/scripts/compile_messages.py [--check]
Parses msgid/msgid_plural/msgstr entries (skipping comments, fuzzy and obsolete
entries) and writes GNU MO files Django can load. --check verifies freshness.
"""
import argparse
import re
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCALE = ROOT / "locale"


def unquote(line):
    match = re.match(r'^\s*"((?:[^"\\]|\\.)*)"\s*$', line)
    if not match:
        raise ValueError(f"Invalid .po string line: {line!r}")
    escapes = {"n": "\n", "t": "\t", '"': '"', "\\": "\\"}
    return re.sub(r"\\(.)", lambda m: escapes.get(m.group(1), m.group(1)), match.group(1))


def parse_po(text):
    entries = {}
    current = None
    field = None
    fuzzy = False

    def flush():
        nonlocal current, fuzzy
        if current and not fuzzy and current.get("msgstr") and any(current["msgstr"].values()):
            msgid = current["msgid"]
            if current.get("msgid_plural") is not None:
                msgid = msgid + "\x00" + current["msgid_plural"]
                msgstr = "\x00".join(current["msgstr"][i] for i in sorted(current["msgstr"]))
            else:
                msgstr = current["msgstr"][0]
            entries[msgid] = msgstr
        current = None
        fuzzy = False

    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith("#"):
            if line.startswith("#,") and "fuzzy" in line:
                fuzzy = True
            if line.startswith("#~"):
                flush()
            continue
        if line.startswith("msgid_plural "):
            current["msgid_plural"] = unquote(line[len("msgid_plural "):])
            field = "msgid_plural"
        elif line.startswith("msgid "):
            flush()
            current = {"msgid": unquote(line[len("msgid "):]), "msgstr": {}}
            field = "msgid"
        elif line.startswith("msgstr["):
            index = int(line[len("msgstr["):line.index("]")])
            current["msgstr"][index] = unquote(line[line.index("]") + 1:].strip())
            field = ("msgstr", index)
        elif line.startswith("msgstr "):
            current["msgstr"][0] = unquote(line[len("msgstr "):])
            field = ("msgstr", 0)
        elif line.startswith('"'):
            value = unquote(line)
            if field == "msgid":
                current["msgid"] += value
            elif field == "msgid_plural":
                current["msgid_plural"] += value
            elif isinstance(field, tuple):
                current["msgstr"][field[1]] += value
        else:
            raise ValueError(f"Unsupported .po line: {line!r}")
    flush()
    return entries


def compile_mo(entries):
    items = sorted(entries.items())
    offsets = []
    ids = strs = b""
    for key, value in items:
        kid, kval = key.encode("utf-8"), value.encode("utf-8")
        offsets.append((len(ids), len(kid), len(strs), len(kval)))
        ids += kid + b"\x00"
        strs += kval + b"\x00"
    count = len(items)
    keystart = 7 * 4 + 16 * count
    valuestart = keystart + len(ids)
    koffsets = []
    voffsets = []
    for o1, l1, o2, l2 in offsets:
        koffsets += [l1, o1 + keystart]
        voffsets += [l2, o2 + valuestart]
    output = struct.pack("Iiiiiii", 0x950412DE, 0, count, 7 * 4, 7 * 4 + count * 8, 0, 0)
    output += struct.pack("i" * len(koffsets), *koffsets)
    output += struct.pack("i" * len(voffsets), *voffsets)
    output += ids + strs
    return output


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    catalogues = sorted(LOCALE.glob("*/LC_MESSAGES/*.po"))
    if not catalogues:
        print("No .po catalogues found under backend/locale.")
        return 1
    stale = []
    for po in catalogues:
        mo = po.with_suffix(".mo")
        entries = parse_po(po.read_text("utf-8"))
        data = compile_mo(entries)
        if args.check:
            if not mo.exists() or mo.read_bytes() != data:
                stale.append(str(po))
        else:
            mo.write_bytes(data)
            print(f"Compiled {po.relative_to(ROOT)} ({len(entries)} messages)")
    if stale:
        print("Stale catalogues: " + ", ".join(stale) + ". Run python backend/scripts/compile_messages.py")
        return 1
    if args.check:
        print("Locale catalogues match their .po sources.")
    return 0


if __name__ == "__main__":
    sys.exit(main())