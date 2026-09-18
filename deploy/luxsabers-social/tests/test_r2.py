import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location("configure_r2", Path(__file__).resolve().parents[1] / "scripts/configure-r2.py")
R2 = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(R2)


class R2CredentialsTests(unittest.TestCase):
    def test_credentials_are_private_and_existing_files_are_preserved(self):
        with tempfile.TemporaryDirectory(prefix="social-r2-") as directory:
            root = Path(directory)
            R2.save_credentials(root, "a" * 32, "b" * 64)
            path = root / ".private/r2.json"
            first = path.read_bytes()
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(path.parent.stat().st_mode & 0o777, 0o700)
            self.assertEqual(json.loads(first)["bucket"], "luxsabers-social-media")
            with self.assertRaises(FileExistsError):
                R2.save_credentials(root, "c" * 32, "d" * 64)
            self.assertEqual(path.read_bytes(), first)

    def test_invalid_keys_and_symlink_directory_are_rejected(self):
        with tempfile.TemporaryDirectory(prefix="social-r2-") as directory:
            root = Path(directory)
            with self.assertRaises(ValueError):
                R2.save_credentials(root, "token", "secret")
            self.assertFalse((root / ".private").exists())
            destination = root / "untouched"
            destination.mkdir()
            (root / ".private").symlink_to(destination, target_is_directory=True)
            with self.assertRaises(ValueError):
                R2.save_credentials(root, "a" * 32, "b" * 64)
            self.assertEqual(list(destination.iterdir()), [])

    def test_existing_app_configuration_is_not_modified(self):
        with tempfile.TemporaryDirectory(prefix="social-r2-") as directory:
            root = Path(directory)
            private = root / ".private"
            private.mkdir(mode=0o700)
            existing = {"gateway.json": "keep-gateway", "server.yaml": "keep-server", "ai.yaml": "keep-ai"}
            for name, content in existing.items():
                (private / name).write_text(content)
            R2.save_credentials(root, "a" * 32, "b" * 64)
            for name, content in existing.items():
                self.assertEqual((private / name).read_text(), content)


if __name__ == "__main__":
    unittest.main()
