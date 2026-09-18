import importlib.util
import base64
import json
import os
from pathlib import Path
import tempfile
import subprocess
import sys
import unittest

SPEC = importlib.util.spec_from_file_location("provision", Path(__file__).resolve().parents[1] / "scripts/provision.py")
PROVISION = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PROVISION)


class ProvisionTests(unittest.TestCase):
    def automation(self, root):
        return subprocess.run([sys.executable, str(Path(__file__).resolve().parents[1] / 'scripts/provision-automation.py'), '--root', str(root)], capture_output=True, text=True)

    def test_automation_is_paused_and_preserves_existing_configuration(self):
        with tempfile.TemporaryDirectory(prefix='social-test-') as directory:
            root = Path(directory)
            PROVISION.create_config(root, check_resources=False)
            private = root / '.private'
            before = {p.name: p.read_bytes() for p in private.iterdir()}
            self.assertEqual(self.automation(root).returncode, 0)
            authority = json.loads((private / 'automation-authority.json').read_text())
            self.assertFalse(authority['model']['authorized'])
            self.assertFalse(authority['publishing']['authorized'])
            self.assertEqual(authority['model']['monthlyBudgetMicrousd'], 0)
            self.assertEqual((root / '.runtime/pre-automation-gateway.json').read_bytes(), before['gateway.json'])
            for name, data in before.items():
                if name != 'gateway.json':
                    self.assertEqual((private / name).read_bytes(), data)
            first = {p.name: p.read_bytes() for p in private.iterdir()}
            self.assertEqual(self.automation(root).returncode, 0)
            self.assertEqual(first, {p.name: p.read_bytes() for p in private.iterdir()})
            for name in ['automation.json', 'automation-authority.json', 'gateway.json']:
                self.assertEqual((private / name).stat().st_mode & 0o777, 0o600)

    def test_conflicting_disk_policy_fails_before_creating_automation_files(self):
        with tempfile.TemporaryDirectory(prefix='social-test-') as directory:
            root = Path(directory)
            PROVISION.create_config(root, check_resources=False)
            path = root / '.private/gateway.json'
            gateway = json.loads(path.read_text())
            gateway['disk'] = {'path': '/custom', 'minimumFreeBytes': 1}
            path.write_text(json.dumps(gateway))
            before = path.read_bytes()
            self.assertNotEqual(self.automation(root).returncode, 0)
            self.assertEqual(path.read_bytes(), before)
            self.assertFalse((root / '.private/automation.json').exists())

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
            self.assertEqual(len(base64.b64decode(before["replica.key"], validate=True)), 512)
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

    def test_initial_replica_repair_rotates_only_invalid_key(self):
        with tempfile.TemporaryDirectory(prefix="social-test-") as directory:
            root = Path(directory)
            private = root / ".private"
            private.mkdir(mode=0o700)
            path = private / "replica.key"
            path.write_text("invalid_url-safe_value")
            PROVISION.repair_initial_key(root)
            key = path.read_bytes()
            self.assertEqual(len(base64.b64decode(key, validate=True)), 512)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            PROVISION.repair_initial_key(root)
            self.assertEqual(key, path.read_bytes())


if __name__ == "__main__":
    unittest.main()
