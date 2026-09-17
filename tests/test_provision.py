import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location("provision", Path(__file__).resolve().parents[1] / "scripts/provision.py")
PROVISION = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PROVISION)


class ProvisionTests(unittest.TestCase):
    def test_secrets_are_unique_private_and_preserved(self):
        with tempfile.TemporaryDirectory(prefix="social-test-") as directory:
            root = Path(directory)
            PROVISION.create_config(root, check_resources=False)
            private = root / ".private"
            before = {p.name: p.read_bytes() for p in private.iterdir()}
            self.assertEqual(private.stat().st_mode & 0o777, 0o700)
            for path in private.iterdir():
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            values = json.loads(before["secrets.json"])
            secrets = [values[k] for k in values if k.endswith(("Password", "Secret", "Token", "Key"))]
            self.assertEqual(len(secrets), len(set(secrets)))
            PROVISION.create_config(root, check_resources=False)
            self.assertEqual(before, {p.name: p.read_bytes() for p in private.iterdir()})
            server = json.loads(before["server.yaml"])
            ai = json.loads(before["ai.yaml"])
            self.assertNotIn(values["mongoRootPassword"], before["server.yaml"].decode())
            self.assertEqual(ai["ai"]["models"]["chat"], [])
            self.assertEqual(ai["ai"]["draftGeneration"]["queue"]["lowPriorityConcurrency"], 1)
            self.assertFalse(server["enableConfigLogging"])
            self.assertFalse(server["enableBadRequestDetails"])
            self.assertEqual(set(server["channel"]), {"channelDb", "shortLink"})

    def test_existing_partial_state_is_not_overwritten(self):
        with tempfile.TemporaryDirectory(prefix="social-test-") as directory:
            root = Path(directory)
            (root / ".private").mkdir()
            (root / ".private/user-file").write_text("keep")
            with self.assertRaises(SystemExit):
                PROVISION.create_config(root, check_resources=False)
            self.assertEqual((root / ".private/user-file").read_text(), "keep")


if __name__ == "__main__":
    unittest.main()
