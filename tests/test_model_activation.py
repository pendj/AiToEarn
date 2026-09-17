import copy
from datetime import datetime, timedelta, timezone
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from provision import create_config, private_write
SPEC = importlib.util.spec_from_file_location('activate_model', ROOT / 'scripts/activate-model.py')
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)
SPEC = importlib.util.spec_from_file_location('provision_automation_model_test', ROOT / 'scripts/provision-automation.py')
automation = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(automation)


class ModelActivationTests(unittest.TestCase):
    def setup_project(self, root):
        create_config(root, check_resources=False)
        automation.create_automation_config(root)
        connection = {**module.TARGET, 'apiKey': 'a' * 64, 'tokenId': 2, 'restrictionsVerified': True,
                      'tokenExpiresAt': (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()}
        private_write(root / '.private/ccload-model.json', json.dumps(connection))
        return connection

    def test_only_owned_provider_fields_change_and_rollback_is_exact(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.setup_project(root)
            before = {path.name: path.read_bytes() for path in (root / '.private').iterdir() if path.is_file()}
            module.activate(root)
            gateway = json.loads((root / '.private/gateway.json').read_bytes())
            ai = json.loads((root / '.private/ai.yaml').read_bytes())
            expected_gateway = json.loads(before['gateway.json'])
            del gateway['modelGateway']
            self.assertEqual(gateway, expected_gateway)
            expected_ai = json.loads(before['ai.yaml'])
            self.assertEqual(ai['ai']['openai']['baseUrl'], 'http://gateway:8083/v1')
            self.assertEqual(ai['ai']['models']['chat'][0]['inputModalities'], ['text'])
            ai['ai']['openai'] = expected_ai['ai']['openai']
            ai['ai']['models']['chat'] = expected_ai['ai']['models']['chat']
            self.assertEqual(ai, expected_ai)
            for name, data in before.items():
                if name not in module.NAMES:
                    self.assertEqual((root / '.private' / name).read_bytes(), data)
            with self.assertRaises(ValueError):
                module.activate(root)
            module.rollback(root)
            for name, data in before.items():
                self.assertEqual((root / '.private' / name).read_bytes(), data)

    def test_rejects_unreviewed_scope_and_preserves_later_user_edits(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            connection = self.setup_project(root)
            original = {name: json.loads((root / '.private' / name).read_bytes()) for name in module.NAMES}
            for changed in ({'channelId': 2}, {'origin': 'https://example.com'}, {'restrictionsVerified': False}, {'tokenExpiresAt': '2000-01-01T00:00:00Z'}):
                with self.assertRaises(ValueError):
                    module.updated_configs(original, {**connection, **changed}, 'b' * 64)
            altered = copy.deepcopy(original)
            altered['ai.yaml']['ai']['models']['chat'] = [{'name': 'user-owned'}]
            with self.assertRaises(ValueError):
                module.updated_configs(altered, connection, 'b' * 64)
            module.activate(root)
            path = root / '.private/gateway.json'
            with path.open('a') as output:
                output.write('\n')
            with self.assertRaises(ValueError):
                module.rollback(root)


if __name__ == '__main__':
    unittest.main()
