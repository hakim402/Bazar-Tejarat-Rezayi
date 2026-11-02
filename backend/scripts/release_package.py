"""Manifested immutable source/native bundles; never reads env/data or activates hosts."""
import argparse
import gzip
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import stat
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[2]
BLOCKED = {'.git', '.ssh', '.venv', 'node_modules', 'data', 'uploads', 'backups', 'logs', 'secrets', 'credentials', '__pycache__'}


class PackageError(ValueError):
    pass


def checksum(data):
    return hashlib.sha256(data).hexdigest()


def encoded(value):
    return (json.dumps(value, sort_keys=True, indent=2) + '\n').encode()


def safe_name(name):
    path = PurePosixPath(name)
    if (not name or str(path) != name or path.is_absolute() or '..' in path.parts or '\\' in name
        or any(part in BLOCKED for part in path.parts)
        or path.name == '.env' or path.name.startswith('.env.') and path.name != '.env.example'
        or path.suffix.lower() in {'.key', '.pem', '.p12', '.pfx', '.sqlite', '.dump'}):
        raise PackageError('Unsafe/private package path refused.')
    if name != '.gitignore' and path.parts[0] not in {'backend', 'frontend', 'native'}:
        raise PackageError('Package paths must remain in the implemented source/native allowlist.')
    return name


def regular(path):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or path.is_symlink():
        raise PackageError('Only regular source/native files may be packaged.')
    return info


def source_paths():
    result = subprocess.check_output(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], cwd=ROOT)
    return sorted(set(name for name in result.decode().split('\0') if name))


def pack(output, native=None):
    output = Path(output).absolute()
    if output.exists() or output.is_symlink():
        raise PackageError('Choose a new private output directory; nothing is overwritten.')
    if output.is_relative_to(ROOT) and not output.is_relative_to(ROOT / 'backend/data'):
        raise PackageError('In-project artifacts must stay under ignored backend/data.')
    paths = source_paths()
    files, sources, deleted = {}, {}, []
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    for name in paths:
        safe_name(name)
        path = ROOT / name
        if not path.exists():
            deleted.append(name)
            continue
        info = regular(path)
        data = path.read_bytes()
        files[name] = {'sha256': checksum(data), 'bytes': len(data), 'mode': 0o755 if info.st_mode & 0o111 else 0o644}
        sources[name] = path
    if native:
        native = Path(native).absolute()
        if native.is_symlink() or not native.is_dir():
            raise PackageError('Native artifacts require an explicit reviewed regular directory.')
        for path in sorted(native.rglob('*')):
            if path.is_symlink():
                raise PackageError('Native artifact symlinks are refused.')
            if path.is_dir():
                continue
            regular(path)
            relative = path.relative_to(native).as_posix()
            name = safe_name('native/' + relative)
            if PurePosixPath(relative).parts[0] not in {'bin', 'wheels', 'licenses', 'build-receipts'}:
                raise PackageError('Unexpected native artifact category.')
            data = path.read_bytes()
            mode = 0o700 if relative.startswith('bin/') else 0o600
            files[name] = {'sha256': checksum(data), 'bytes': len(data), 'mode': mode}
            sources[name] = path
    manifest = {'format': 1, 'base_sha': head, 'files': files, 'deleted_from_base': deleted}
    payload = encoded(manifest)
    identity = checksum(payload)
    output.mkdir(mode=0o700)
    archive = output / 'release.tar.gz'
    with os.fdopen(os.open(archive, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as raw:
        with gzip.GzipFile(filename='', mode='wb', fileobj=raw, mtime=0) as zipped:
            with tarfile.open(fileobj=zipped, mode='w') as tar:
                for name in sorted(files):
                    value = sources[name].read_bytes()
                    if checksum(value) != files[name]['sha256']:
                        raise PackageError('Source changed while packaging; retain evidence and create a new bundle.')
                    item = tarfile.TarInfo(name)
                    item.size, item.mode, item.mtime = len(value), files[name]['mode'], 0
                    tar.addfile(item, io.BytesIO(value))
                item = tarfile.TarInfo('release-manifest.json')
                item.size, item.mode = len(payload), 0o600
                tar.addfile(item, io.BytesIO(payload))
    if paths != source_paths() or head != subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip():
        raise PackageError('Source/Git identity changed while packaging; bundle not accepted.')
    if any(checksum(sources[name].read_bytes()) != value['sha256'] for name, value in files.items()):
        raise PackageError('Source/native files changed while packaging; bundle not accepted.')
    verify(archive, identity)
    (output / 'release-manifest.json').write_bytes(payload)
    (output / 'release-manifest.json').chmod(0o600)
    result = {'release_id': identity, 'source_identifier': 'manifest:' + identity, 'base_sha': head,
              'files': len(files), 'archive_sha256': checksum(archive.read_bytes())}
    (output / 'receipt.json').write_bytes(encoded(result))
    (output / 'receipt.json').chmod(0o600)
    return result


def verify(archive, expected):
    if len(expected) != 64 or any(c not in '0123456789abcdef' for c in expected):
        raise PackageError('A separately verified complete manifest SHA256 is required.')
    regular(Path(archive))
    with tarfile.open(archive, 'r:gz') as tar:
        members = tar.getmembers()
        names = [member.name for member in members]
        if len(names) != len(set(names)) or names.count('release-manifest.json') != 1:
            raise PackageError('Duplicate or missing package members.')
        item = tar.getmember('release-manifest.json')
        if not item.isfile() or item.size > 4 * 1024 * 1024:
            raise PackageError('Invalid package manifest member.')
        data = tar.extractfile(item).read()
        if checksum(data) != expected:
            raise PackageError('Manifest differs from the independent release receipt.')
        manifest = json.loads(data)
        if manifest.get('format') != 1 or not isinstance(manifest.get('files'), dict):
            raise PackageError('Unsupported package contract.')
        if set(names) != {*manifest['files'], 'release-manifest.json'}:
            raise PackageError('Unexpected package member.')
        for name, value in manifest['files'].items():
            safe_name(name)
            item = tar.getmember(name)
            if (not item.isfile() or item.size != value['bytes'] or item.mode != value['mode']
                or item.mode not in {0o600, 0o644, 0o700, 0o755}):
                raise PackageError('Invalid package type/size/mode.')
            if checksum(tar.extractfile(item).read()) != value['sha256']:
                raise PackageError('Package content checksum differs.')
        for name in manifest.get('deleted_from_base', []):
            safe_name(name)
        return manifest


def unpack(archive, expected, target):
    manifest = verify(archive, expected)
    target = Path(target).absolute()
    if target.exists() or target.is_symlink():
        raise PackageError('Immutable extraction requires a new directory; existing data is never replaced.')
    target.mkdir(mode=0o700)
    with tarfile.open(archive, 'r:gz') as tar:
        for name, record in manifest['files'].items():
            path = target / name
            path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, record['mode']), 'wb') as stream:
                stream.write(tar.extractfile(name).read())
    with os.fdopen(os.open(target / 'release-manifest.json', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as stream:
        stream.write(encoded(manifest))
    return {'release_id': expected, 'files': len(manifest['files']), 'activated': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_subparsers(dest='action', required=True)
    create = actions.add_parser('pack')
    create.add_argument('--output', type=Path, required=True)
    create.add_argument('--native', type=Path)
    for name in ['verify', 'unpack']:
        command = actions.add_parser(name)
        command.add_argument('--archive', type=Path, required=True)
        command.add_argument('--expected-manifest', required=True)
        if name == 'unpack':
            command.add_argument('--target', type=Path, required=True)
    options = parser.parse_args()
    try:
        if options.action == 'pack':
            result = pack(options.output, options.native)
        elif options.action == 'unpack':
            result = unpack(options.archive, options.expected_manifest, options.target)
        else:
            value = verify(options.archive, options.expected_manifest)
            result = {'release_id': options.expected_manifest, 'files': len(value['files']), 'verified': True}
    except (PackageError, OSError, ValueError, tarfile.TarError):
        raise SystemExit('Release package refused; no host was activated and no existing target was overwritten.') from None
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    main()
