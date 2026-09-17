import json
from pathlib import Path
import unittest


class PinTests(unittest.TestCase):
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
        self.assertEqual(compose.count("ports:"), 2)
        self.assertIn("127.0.0.1:18080:8080", compose)
        self.assertIn("127.0.0.1:19000:9000", compose)


if __name__ == "__main__":
    unittest.main()
