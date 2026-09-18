import copy
from datetime import datetime, timezone
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import stat
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, Mock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import codex_quota as quota
SPEC = importlib.util.spec_from_file_location('install_quota', ROOT / 'scripts/install-codex-quota.py')
installer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(installer)
NOW = 1790000000


def payload():
    return {'plan_type': 'pro', 'rate_limit': {'allowed': True, 'limit_reached': False,
            'primary_window': {'used_percent': 9, 'limit_window_seconds': 604800, 'reset_at': NOW + 3000},
            'secondary_window': None}, 'credits': {'has_credits': False, 'unlimited': False, 'balance': '0'},
            'private_provider_field': 'must-not-leak'}


def setup_database(root):
    database = root / 'ccload.db'
    credential = {'email': 'designated@example.invalid', 'account_id': 'private-designated-account',
                  'access_token': 'private-access-token', 'refresh_token': 'private-refresh-token',
                  'expired': datetime.fromtimestamp(NOW + 86400, timezone.utc).isoformat(), 'plan_type': 'pro'}
    with sqlite3.connect(database) as db:
        db.execute('CREATE TABLE channels(id INTEGER PRIMARY KEY, name TEXT, auth_type TEXT, enabled INTEGER, oauth_credential TEXT)')
        db.execute('INSERT INTO channels VALUES (3,?,?,1,?)', ('designated', 'codex_oauth', json.dumps(credential)))
        db.execute('INSERT INTO channels VALUES (2,?,?,1,?)', ('unrelated', 'codex_oauth', 'do-not-read-this'))
    return database, {'channelId': 3, 'uid': os.getuid(),
                      'identitySha256': quota.identity_hash('designated', credential)}, credential


class QuotaTests(unittest.TestCase):
    def test_allowlist_strips_raw_fields_and_never_grants_spend_or_generation(self):
        result = quota.sanitize(payload(), NOW, NOW + 86400)
        self.assertEqual(quota.validate_snapshot(result, NOW + 1), result)
        self.assertNotIn('must-not-leak', json.dumps(result))
        self.assertTrue(result['zeroPurchasedCreditsObserved'])
        self.assertFalse(result['spendingCapVerified'])
        self.assertFalse(result['grantsGeneration'])
        self.assertEqual(result['rateLimit']['primary']['usedPercent'], 9)

    def test_credit_presence_unlimited_and_nonzero_balance_are_not_zero(self):
        for changes in ({'has_credits': True}, {'unlimited': True}, {'balance': '0.01'}):
            raw = payload()
            raw['credits'].update(changes)
            self.assertFalse(quota.sanitize(raw, NOW, NOW + 86400)['zeroPurchasedCreditsObserved'])

    def test_incomplete_and_malformed_provider_status_fails_closed(self):
        examples = []
        for key in ('credits', 'rate_limit'):
            raw = payload()
            del raw[key]
            examples.append(raw)
        for field, value in [('balance', 'NaN'), ('balance', '-1'), ('balance', 0), ('has_credits', 0)]:
            raw = payload()
            raw['credits'][field] = value
            examples.append(raw)
        for value in (float('nan'), float('inf'), -1, 101, True):
            raw = payload()
            raw['rate_limit']['primary_window']['used_percent'] = value
            examples.append(raw)
        examples.append({**payload(), 'additional_rate_limits': False})
        for raw in examples:
            with self.assertRaises((quota.QuotaError, KeyError, TypeError)):
                quota.sanitize(raw, NOW, NOW + 86400)

    def test_additional_limit_windows_are_preserved_without_arbitrary_fields(self):
        raw = payload()
        raw['additional_rate_limits'] = [{'limit_name': 'model-family', 'metered_feature': 'codex',
                                         'rate_limit': raw['rate_limit'], 'private': 'do-not-copy'}]
        result = quota.sanitize(raw, NOW, NOW + 86400)
        self.assertEqual(result['additionalLimits'][0]['name'], 'model-family')
        self.assertNotIn('do-not-copy', json.dumps(result))
        quota.validate_snapshot(result, NOW + 1)

    def test_expired_future_wrong_channel_or_modified_result_is_rejected(self):
        result = quota.sanitize(payload(), NOW, NOW + 86400)
        for changes in ({'channelId': 2}, {'channelId': 3.0}, {'schema': True}, {'grantsGeneration': True},
                        {'spendingCapVerified': True}, {'extra': 'private'}, {'observedAt': NOW + 100}):
            with self.assertRaises(quota.QuotaError):
                quota.validate_snapshot({**result, **changes}, NOW + 1)
        for now in (NOW + 60, NOW + 61, NOW - 20):
            with self.assertRaises(quota.QuotaError):
                quota.validate_snapshot(result, now)
        changed = copy.deepcopy(result)
        changed['credits']['balance'] = '10'
        with self.assertRaises(quota.QuotaError):
            quota.validate_snapshot(changed, NOW + 1)

    def test_only_fixed_source_and_command_are_accepted(self):
        env = {'SSH_CONNECTION': '163.192.46.78 40000 10.0.0.1 22', 'SSH_ORIGINAL_COMMAND': 'quota-v1'}
        self.assertTrue(quota.command_allowed(env))
        for command in ('', 'id', 'quota-v1 2', 'quota-v1; id', 'sftp', 'quota-v1\n'):
            self.assertFalse(quota.command_allowed({**env, 'SSH_ORIGINAL_COMMAND': command}))
        self.assertFalse(quota.command_allowed({**env, 'SSH_TTY': '/dev/pts/1'}))
        self.assertFalse(quota.command_allowed({**env, 'SSH_CONNECTION': '127.0.0.1 40000 10.0.0.1 22'}))

    def test_readonly_database_and_identity_pin(self):
        with tempfile.TemporaryDirectory() as directory:
            db, scope, credential = setup_database(Path(directory))
            before = db.read_bytes()
            actual, _ = quota.load_credential(db, scope, NOW)
            self.assertEqual(actual, credential)
            self.assertEqual(db.read_bytes(), before)
            with self.assertRaisesRegex(quota.QuotaError, 'designated_account_changed'):
                quota.load_credential(db, {**scope, 'identitySha256': '0' * 64}, NOW)
            with self.assertRaisesRegex(quota.QuotaError, 'credential_expired_no_refresh'):
                quota.load_credential(db, scope, NOW + 86400)
            with sqlite3.connect(db) as connection:
                connection.execute('UPDATE channels SET enabled=0 WHERE id=3')
            with self.assertRaisesRegex(quota.QuotaError, 'designated_channel_unavailable'):
                quota.load_credential(db, scope, NOW)

    def test_cache_is_bounded_and_failures_reserve_attempt_before_request(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            db, scope, _ = setup_database(root)
            fetch = Mock(return_value=payload())
            first = quota.snapshot(scope, db, root, fetch, lambda: NOW)
            self.assertEqual(quota.snapshot(scope, db, root, fetch, lambda: NOW + 10), first)
            self.assertEqual(fetch.call_count, 1)
            second = quota.snapshot(scope, db, root, fetch, lambda: NOW + 61)
            self.assertEqual(fetch.call_count, 2)
            self.assertEqual(second['observedAt'], NOW + 61)
            fetch.side_effect = quota.QuotaError('upstream_unavailable')
            with self.assertRaisesRegex(quota.QuotaError, 'upstream_unavailable'):
                quota.snapshot(scope, db, root, fetch, lambda: NOW + 122)
            with self.assertRaisesRegex(quota.QuotaError, 'quota_check_cooldown'):
                quota.snapshot(scope, db, root, fetch, lambda: NOW + 123)
            self.assertEqual(fetch.call_count, 3)
            state = json.loads((root / 'state.json').read_bytes())
            self.assertEqual(state, {'attemptedAt': NOW + 122})
            self.assertEqual(stat.S_IMODE((root / 'state.json').stat().st_mode), 0o600)

    def test_transport_is_get_only_no_proxy_redirect_refresh_or_other_endpoint(self):
        opener = MagicMock()
        response = opener.open.return_value.__enter__.return_value
        response.status = 200
        response.read.return_value = json.dumps(payload()).encode()
        credential = {'access_token': 'secret', 'account_id': 'private-account'}
        with patch.object(quota.urllib.request, 'build_opener', return_value=opener) as build:
            quota.fetch_usage(credential)
        request = opener.open.call_args.args[0]
        self.assertEqual(request.full_url, quota.USAGE_URL)
        self.assertEqual(request.get_method(), 'GET')
        self.assertIsNone(request.data)
        self.assertEqual(build.call_args.args[0].proxies, {})
        self.assertEqual(response.read.call_args.args, (quota.MAX_BODY + 1,))
        with self.assertRaisesRegex(quota.QuotaError, 'upstream_redirect_denied'):
            quota.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://example.invalid')
        response.read.return_value = b'x' * (quota.MAX_BODY + 1)
        with patch.object(quota.urllib.request, 'build_opener', return_value=opener):
            with self.assertRaisesRegex(quota.QuotaError, 'response_too_large'):
                quota.fetch_usage(credential)

    def test_ssh_client_uses_fixed_identity_host_and_no_shell(self):
        command = quota.client_command(Path('/example'))
        self.assertEqual(command[-2:], ['ubuntu@147.224.48.149', 'quota-v1'])
        for option in ('StrictHostKeyChecking=yes', 'IdentityAgent=none', 'ForwardAgent=no',
                       'ClearAllForwardings=yes', 'ProxyCommand=none', 'SendEnv=-*'):
            self.assertIn(option, command)
        self.assertIn('/dev/null', command)

    def test_installed_key_is_fixed_command_and_rejects_injected_options(self):
        key = 'ssh-ed25519 ' + 'A' * 68
        line = installer.key_line(key).decode()
        self.assertTrue(line.startswith('restrict,from="163.192.46.78",command="/usr/bin/python3 -I '))
        self.assertIn('codex_quota.py --serve', line)
        for bad in ('command="id" ' + key, key + '\n' + key, 'ssh-rsa ' + 'A' * 68):
            with self.assertRaises(ValueError):
                installer.key_line(bad)

    def test_revoke_preserves_later_user_keys_and_original_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            keys = root / 'authorized_keys'
            record = root / 'record'
            record.mkdir()
            before = b'original-key-without-newline'
            line = installer.key_line('ssh-ed25519 ' + 'A' * 68)
            after = before + b'\n' + line
            (record / 'installation.json').write_text(json.dumps({'beforeSha256': installer.digest(before),
                'afterSha256': installer.digest(after), 'addedLine': line.decode()}))
            (record / 'authorized_keys.before').write_bytes(before)
            with patch.object(installer, 'KEYS', keys), patch.object(installer, 'RECORD', record):
                for current, expected in ((after, before), (after + b'later-user-key\n', before + b'\nlater-user-key\n')):
                    keys.write_bytes(current)
                    keys.chmod(0o600)
                    with patch('builtins.print'):
                        installer.revoke()
                    self.assertEqual(keys.read_bytes(), expected)


if __name__ == '__main__':
    unittest.main()
