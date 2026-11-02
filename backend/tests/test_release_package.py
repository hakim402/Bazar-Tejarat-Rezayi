"""Deployment archive boundaries using tiny synthetic files, never a project/data copy."""
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from scripts.release_package import PackageError, checksum, encoded, unpack, verify


class ReleasePackageTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='bazar-package-test-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)

    def archive(self, name='backend/synthetic.py', *, duplicate=False, symlink=False):
        data = b'print("synthetic only")\n'
        manifest = {'format': 1, 'base_sha': 'a' * 40, 'files': {name: {'sha256': checksum(data), 'bytes': len(data), 'mode': 0o644}}, 'deleted_from_base': []}
        payload = encoded(manifest)
        archive = self.root / 'sample.tar.gz'
        with tarfile.open(archive, 'w:gz') as tar:
            for _ in range(2 if duplicate else 1):
                item = tarfile.TarInfo(name)
                item.mode, item.size = 0o644, len(data)
                if symlink:
                    item.type, item.linkname, item.size = tarfile.SYMTYPE, '/outside', 0
                tar.addfile(item, None if symlink else io.BytesIO(data))
            item = tarfile.TarInfo('release-manifest.json')
            item.size = len(payload)
            tar.addfile(item, io.BytesIO(payload))
        return archive, checksum(payload), data

    def test_exact_bundle_extracts_only_into_a_new_private_directory(self):
        archive, identity, data = self.archive()
        target = self.root / 'new'
        self.assertEqual(verify(archive, identity)['files']['backend/synthetic.py']['bytes'], len(data))
        self.assertFalse(unpack(archive, identity, target)['activated'])
        self.assertEqual((target / 'backend/synthetic.py').read_bytes(), data)
        self.assertEqual(target.stat().st_mode & 0o777, 0o700)
        self.assertEqual(json.loads((target / 'release-manifest.json').read_text())['format'], 1)

    def test_existing_target_is_never_overwritten(self):
        archive, identity, _ = self.archive()
        target = self.root / 'existing'
        target.mkdir()
        (target / 'keep').write_text('retained')
        with self.assertRaises(PackageError):
            unpack(archive, identity, target)
        self.assertEqual((target / 'keep').read_text(), 'retained')

    def test_traversal_is_rejected_before_extraction(self):
        archive, identity, _ = self.archive('../escape')
        with self.assertRaises(PackageError):
            unpack(archive, identity, self.root / 'target')
        self.assertFalse((self.root / 'target').exists())

    def test_private_environment_is_refused_even_in_a_consistent_manifest(self):
        archive, identity, _ = self.archive('backend/.env')
        with self.assertRaises(PackageError):
            verify(archive, identity)

    def test_symlink_and_duplicate_members_are_refused(self):
        archive, identity, _ = self.archive(symlink=True)
        with self.assertRaises(PackageError):
            verify(archive, identity)
        archive.unlink()
        archive, identity, _ = self.archive(duplicate=True)
        with self.assertRaises(PackageError):
            verify(archive, identity)

    def test_independent_receipt_mismatch_is_refused(self):
        archive, _, _ = self.archive()
        with self.assertRaises(PackageError):
            verify(archive, '0' * 64)
