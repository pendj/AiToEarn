import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('backup', Path(__file__).resolve().parents[1] / 'scripts/project-backup.py')
BACKUP = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BACKUP)


class BackupTests(unittest.TestCase):
    def test_restore_and_compare_forward_archive_input_to_container(self):
        with tempfile.TemporaryFile() as source, patch.object(BACKUP, 'run', return_value='') as execute:
            BACKUP.volume_tool('reviewed-image', 'isolated-volume', ['-xzf', '-'], readonly=False, stdin=source)
            self.assertIn('--interactive', execute.call_args.args[0])
            self.assertIs(execute.call_args.kwargs['stdin'], source)

    def test_only_exact_snapshot_identifiers_are_accepted(self):
        self.assertEqual(BACKUP.snapshot_path('20260917T101328Z-4433cc9'), Path('/srv/luxsabers-social/.runtime/backups/20260917T101328Z-4433cc9'))
        for invalid in ('', '/', '../commerce', '20260917T101328Z-4433cc9/../other', 'snapshot*'):
            with self.assertRaises(ValueError):
                BACKUP.snapshot_path(invalid)

    def test_archive_checksums_cover_real_bytes(self):
        with tempfile.TemporaryDirectory(prefix='social-backup-test-') as directory:
            path = Path(directory) / 'archive'
            path.write_bytes(b'private synthetic backup')
            self.assertEqual(BACKUP.digest(path), hashlib.sha256(path.read_bytes()).hexdigest())
            before = BACKUP.digest(path)
            path.write_bytes(b'changed backup')
            self.assertNotEqual(BACKUP.digest(path), before)

    def test_unpinned_tools_are_rejected(self):
        original = BACKUP.ROOT
        try:
            with tempfile.TemporaryDirectory(prefix='social-backup-test-') as directory:
                BACKUP.ROOT = Path(directory)
                (BACKUP.ROOT / '.env').write_text('RELEASE_ID=' + 'a' * 40 + '\nNODE_IMAGE=node:latest\n')
                with self.assertRaises(RuntimeError):
                    BACKUP.environment()
        finally:
            BACKUP.ROOT = original
