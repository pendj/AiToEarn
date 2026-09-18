import json
from pathlib import Path
import unittest
import os
import shutil
import subprocess
import tempfile
import importlib.util


class PinTests(unittest.TestCase):
    def test_compose_renders_with_isolated_generated_configuration(self):
        root = Path(__file__).resolve().parents[1]
        spec = importlib.util.spec_from_file_location('compose_provision', root / 'scripts/provision.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory(prefix='social-compose-') as directory:
            target = Path(directory)
            shutil.copy2(root / 'compose.yaml', target / 'compose.yaml')
            module.create_config(target, check_resources=False)
            pins = json.loads((root / 'images.lock.json').read_text())['images']
            environment = {**os.environ, **pins, 'RELEASE_ID': '0' * 40, 'DEPLOY_UID': str(os.getuid()), 'DEPLOY_GID': str(os.getgid())}
            result = subprocess.run(['docker', 'compose', 'config', '--quiet'], cwd=target, env=environment, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_all_runtime_base_images_are_arm64_digest_pinned(self):
        root = Path(__file__).resolve().parents[1]
        lock = json.loads((root / "images.lock.json").read_text())
        self.assertEqual(lock["architecture"], "linux/arm64")
        self.assertEqual(len(lock["images"]), 7)
        for image in lock["images"].values():
            self.assertRegex(image, r"^[a-z0-9/._-]+@sha256:[a-f0-9]{64}$")
        compose = (root / "compose.yaml").read_text()
        self.assertNotIn("AUTO_LOGIN_TOKEN", compose)
        self.assertNotIn("docker.sock", compose)
        self.assertIn("internal: {internal: true}", compose)
        self.assertEqual(compose.count("ports:"), 1)
        self.assertIn("127.0.0.1:18880:8080", compose)
        self.assertIn("127.0.0.1:19000:8081", compose)
        self.assertIn("command: [node, apps/aitoearn-ai/src/main.js, -c, config.yaml]", compose)
        self.assertIn("command: [node, apps/aitoearn-server/src/main.js, -c, config.yaml]", compose)


if __name__ == "__main__":
    unittest.main()
