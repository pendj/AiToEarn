#!/usr/bin/env python3
"""Add only this project's paused automation configuration; preserve all secrets."""
import argparse
import json
from pathlib import Path
from provision import private_write

def create_automation_config(root):
    root = root.resolve()
    private = root / '.private'
    gateway_path = private / 'gateway.json'
    gateway = json.loads(gateway_path.read_text())
    server = json.loads((private / 'server.yaml').read_text())
    expected_disk = {'path': '/data', 'minimumFreeBytes': 10 * 1024**3}
    if gateway.get('disk') not in (None, expected_disk):
        raise SystemExit('Existing disk policy differs; preserve it and review before changing')
    expected_worker = {
        'operatorId': gateway['operatorId'], 'jwtSecret': gateway['jwtSecret'],
        'serverOrigin': gateway['serverOrigin'], 'aiOrigin': gateway['aiOrigin'],
        'redis': server['redis'], 'disk': expected_disk,
    }
    worker_path = private / 'automation.json'
    if worker_path.exists():
        worker = json.loads(worker_path.read_text())
        if any(worker.get(key) != value for key, value in expected_worker.items()):
            raise SystemExit('Existing automation connection differs; no files changed')
    authority_path = private / 'automation-authority.json'
    if authority_path.exists() and json.loads(authority_path.read_text()).get('schemaVersion') != 1:
        raise SystemExit('Unsupported authorization schema; no files changed')
    runtime = root / '.runtime/automation'
    runtime.mkdir(parents=True, exist_ok=True, mode=0o700)
    runtime.chmod(0o700)
    if not worker_path.exists():
        private_write(worker_path, json.dumps(expected_worker, indent=2) + '\n')
    if not authority_path.exists():
        private_write(authority_path, json.dumps({
        'schemaVersion': 1,
        'model': {'authorized': False, 'name': '', 'connectionVerified': False, 'hardProviderLimitVerified': False,
                  'approvalRef': '', 'expiresAt': None, 'maxTokens': 600, 'maxCallMicrousd': 0,
                  'dailyBudgetMicrousd': 0, 'monthlyBudgetMicrousd': 0},
        'publishing': {'authorized': False, 'approvalRef': '', 'expiresAt': None, 'accounts': [], 'media': {},
                       'timezone': 'America/New_York', 'hour': 13, 'maxPostsPerAccountPerDay': 1,
                       'contentRule': 'source-backed-product-preview-v1', 'nativeNoBlindRetryVerified': False},
        }, indent=2) + '\n')
    if gateway.get('disk') != expected_disk or gateway.get('automation') is not True:
        backup = root / '.runtime/pre-automation-gateway.json'
        if not backup.exists():
            private_write(backup, gateway_path.read_text())
        gateway['disk'] = expected_disk
        gateway['automation'] = True
        pending = private / 'gateway.json.automation-pending'
        private_write(pending, json.dumps(gateway, indent=2) + '\n')
        pending.replace(gateway_path)
    print('Paused automation configuration ready; no authorization granted or credentials rotated.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    create_automation_config(parser.parse_args().root)
