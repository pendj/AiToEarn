import importlib.util
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('provision', ROOT / 'scripts/provision.py')
PROVISION = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PROVISION)


class R2ActivationTests(unittest.TestCase):
    def prepare(self, root):
        PROVISION.create_config(root, check_resources=False)
        private = root / '.private'
        r2 = {'provider': 'r2', 'region': 'auto', 'bucket': 'luxsabers-social-media',
              'endpoint': 'https://08c44086c81cc0cea32aa0288236416f.r2.cloudflarestorage.com',
              'accessKey': 'a' * 32, 'secretKey': 'b' * 64}
        PROVISION.private_write(private / 'r2.json', json.dumps(r2))
        directory = root / '.runtime/r2-migration'
        directory.mkdir(parents=True, mode=0o700)
        evidence = {'passed': True, 'objects': [{'bytes': 100}],
                    'sourceConfigSha256': hashlib.sha256((private / 'gateway.json').read_bytes()).hexdigest(),
                    'r2ConfigSha256': hashlib.sha256((private / 'r2.json').read_bytes()).hexdigest()}
        PROVISION.private_write(directory / 'copy.json', json.dumps(evidence))
        return {p.name: p.read_bytes() for p in private.iterdir()}

    def run_script(self, root, *args):
        return subprocess.run([sys.executable, str(ROOT / 'scripts/activate-r2.py'), '--root', str(root), *args], capture_output=True, text=True)

    def test_activation_preserves_unrelated_fields_and_has_exact_guarded_rollback(self):
        with tempfile.TemporaryDirectory(prefix='r2-activation-') as directory:
            root = Path(directory)
            before = self.prepare(root)
            result = self.run_script(root)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertNotEqual(self.run_script(root).returncode, 0)
            for name, content in before.items():
                current = (root / '.private' / name).read_bytes()
                if name not in ('gateway.json', 'ai.yaml', 'server.yaml'):
                    self.assertEqual(current, content)
                    continue
                old, new = json.loads(content), json.loads(current)
                if name == 'gateway.json':
                    self.assertEqual(new['storage']['provider'], 'r2')
                    self.assertEqual(new.pop('mediaAllowance')['initialBytes'], 100)
                    new['storage'] = old['storage']
                else:
                    self.assertEqual(new['assets']['publicEndpoint'], new['assets']['endpoint'])
                    for key in ['region', 'endpoint', 'publicEndpoint', 'bucketName', 'accessKeyId', 'secretAccessKey', 'forcePathStyle']:
                        new['assets'][key] = old['assets'][key]
                self.assertEqual(old, new)
                self.assertEqual((root / '.private' / name).stat().st_mode & 0o777, 0o600)
            self.assertEqual(self.run_script(root, '--rollback').returncode, 0)
            for name, content in before.items():
                self.assertEqual((root / '.private' / name).read_bytes(), content)

    def test_stale_evidence_and_later_edits_are_preserved(self):
        with tempfile.TemporaryDirectory(prefix='r2-stale-') as directory:
            root = Path(directory)
            self.prepare(root)
            path = root / '.private/gateway.json'
            original = path.read_bytes()
            path.write_bytes(original + b' ')
            self.assertNotEqual(self.run_script(root).returncode, 0)
            self.assertEqual(path.read_bytes(), original + b' ')
            path.write_bytes(original)
            self.assertEqual(self.run_script(root).returncode, 0)
            changed = path.read_bytes() + b' '
            path.write_bytes(changed)
            self.assertNotEqual(self.run_script(root, '--rollback').returncode, 0)
            self.assertEqual(path.read_bytes(), changed)


if __name__ == '__main__':
    unittest.main()
