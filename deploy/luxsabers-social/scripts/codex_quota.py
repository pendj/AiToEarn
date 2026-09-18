#!/usr/bin/env python3
"""Private fixed-channel usage read. This never grants generation or spending."""
import argparse
from contextlib import closing
from datetime import datetime, timezone
from decimal import Decimal
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import signal
import sqlite3
import stat
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

CHANNEL_ID = 3
SOURCE_IP = '163.192.46.78'
HOST = '147.224.48.149'
COMMAND = 'quota-v1'
SCOPE = Path('/opt/luxsabers-codex-quota/scope.json')
DATABASE = Path('/home/ubuntu/ccload/data/ccload.db')
STATE = Path('/home/ubuntu/ccload/.private/quota-readonly-state')
USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'
TTL = 60
MAX_BODY = 65536
MAX_OUTPUT = 8192


class QuotaError(Exception):
    pass


def fail(code):
    raise QuotaError(code)


def read_json(path, limit=MAX_BODY):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as source:
        if not stat.S_ISREG(os.fstat(source.fileno()).st_mode):
            fail('invalid_private_file')
        raw = source.read(limit + 1)
    if len(raw) > limit:
        fail('response_too_large')
    return json.loads(raw)


def write_state(path, value):
    fd, temporary = tempfile.mkstemp(prefix='.quota-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as target:
            json.dump(value, target, separators=(',', ':'), allow_nan=False)
            target.flush()
            os.fsync(target.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def identity_hash(name, credential):
    parts = [name, credential.get('email'), credential.get('account_id')]
    if any(not isinstance(value, str) or not value for value in parts):
        fail('account_identity_missing')
    return hashlib.sha256(json.dumps(parts, separators=(',', ':')).encode()).hexdigest()


def command_allowed(environ):
    connection = environ.get('SSH_CONNECTION', '').split()
    return (environ.get('SSH_ORIGINAL_COMMAND') == COMMAND
            and len(connection) == 4 and connection[0] == SOURCE_IP
            and not environ.get('SSH_TTY'))


def load_credential(database, scope, now):
    with closing(sqlite3.connect(database.as_uri() + '?mode=ro', uri=True, timeout=2)) as db:
        db.execute('PRAGMA query_only=ON')
        row = db.execute('SELECT name, auth_type, enabled, oauth_credential '
                         'FROM channels WHERE id = ?', (CHANNEL_ID,)).fetchone()
    if not row or row[1] != 'codex_oauth' or row[2] != 1:
        fail('designated_channel_unavailable')
    credential = json.loads(row[3])
    if identity_hash(row[0], credential) != scope['identitySha256']:
        fail('designated_account_changed')
    expires = datetime.fromisoformat(credential['expired'].replace('Z', '+00:00'))
    if expires.tzinfo is None or expires.timestamp() <= now + 30:
        fail('credential_expired_no_refresh')
    token = credential.get('access_token')
    if (not isinstance(token, str) or not token or len(token) > 16384
            or any(ord(char) < 33 or ord(char) > 126 for char in token)):
        fail('credential_invalid')
    if credential.get('plan_type') != 'pro':
        fail('designated_plan_changed')
    return credential, int(expires.timestamp())


def integer(value, minimum, maximum):
    if type(value) is not int or not minimum <= value <= maximum:
        fail('invalid_usage_schema')
    return value


def boolean(value):
    if type(value) is not bool:
        fail('invalid_usage_schema')
    return value


def window(value, now):
    if value is None:
        return None
    used = value['used_percent']
    if type(used) not in (int, float) or not math.isfinite(used) or not 0 <= used <= 100:
        fail('invalid_usage_schema')
    return {'usedPercent': used,
            'limitWindowSeconds': integer(value['limit_window_seconds'], 1, 366 * 86400),
            'resetAt': integer(value['reset_at'], now - 366 * 86400, now + 366 * 86400)}


def windows(value, now):
    result = {'primary': window(value.get('primary_window'), now),
              'secondary': window(value.get('secondary_window'), now)}
    if not any(result.values()):
        fail('usage_windows_missing')
    return result


def label(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_ .:/-]{1,80}', value):
        fail('invalid_usage_schema')
    return value


def sanitize(payload, now, expires):
    if payload.get('plan_type') != 'pro':
        fail('designated_plan_changed')
    rate = payload['rate_limit']
    credits = payload['credits']
    balance = credits['balance']
    if not isinstance(balance, str) or not re.fullmatch(r'(0|[1-9][0-9]{0,9})(\.[0-9]{1,8})?', balance):
        fail('invalid_credit_balance')
    credit_status = {'hasCredits': boolean(credits['has_credits']),
                     'unlimited': boolean(credits['unlimited']), 'balance': balance}
    additional = payload.get('additional_rate_limits', [])
    if additional is None:
        additional = []
    if not isinstance(additional, list) or len(additional) > 8:
        fail('invalid_usage_schema')
    extra = []
    for item in additional:
        extra.append({'name': label(item['limit_name']),
                      'meteredFeature': label(item['metered_feature']),
                      **windows(item.get('rate_limit') or item, now)})
    return {'schema': 1, 'channelId': CHANNEL_ID, 'observedAt': now,
            'validUntil': min(now + TTL, expires - 30), 'credentialExpiresAt': expires,
            'plan': 'pro', 'rateLimit': {'allowed': boolean(rate['allowed']),
                                       'limitReached': boolean(rate['limit_reached']),
                                       **windows(rate, now)},
            'additionalLimits': extra, 'credits': credit_status,
            'zeroPurchasedCreditsObserved': (not credit_status['hasCredits']
                                             and not credit_status['unlimited']
                                             and Decimal(balance) == 0),
            'spendingCapVerified': False, 'grantsGeneration': False}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        fail('upstream_redirect_denied')


def fetch_usage(credential):
    request = urllib.request.Request(USAGE_URL, method='GET', headers={
        'Authorization': 'Bearer ' + credential['access_token'],
        'Chatgpt-Account-Id': credential['account_id'],
        'Accept': 'application/json', 'OpenAI-Beta': 'codex-1',
        'User-Agent': 'LuxSabers-Social/1.0 (read-only-quota)',
    })
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        with opener.open(request, timeout=8) as response:
            if response.status != 200:
                fail('upstream_unavailable')
            raw = response.read(MAX_BODY + 1)
    except urllib.error.HTTPError as error:
        error.close()
        fail('upstream_auth_denied' if error.code in (401, 403) else 'upstream_unavailable')
    if len(raw) > MAX_BODY:
        fail('response_too_large')
    return json.loads(raw)


def snapshot(scope, database=DATABASE, state_dir=STATE, fetch=fetch_usage, now_fn=time.time):
    fd = os.open(state_dir / 'lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'r+') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            fail('quota_check_busy')
        now = int(now_fn())
        credential, expires = load_credential(database, scope, now)
        cache_path = state_dir / 'state.json'
        if cache_path.exists():
            cache = read_json(cache_path)
            last = integer(cache['attemptedAt'], 0, now)
            if now - last < TTL:
                result = cache.get('snapshot')
                if result and result['validUntil'] > now and result['credentialExpiresAt'] == expires:
                    validate_snapshot(result, now)
                    return result
                fail('quota_check_cooldown')
        # Persist the attempt before the GET; interrupted/failed reads are not retried immediately.
        write_state(cache_path, {'attemptedAt': now})
        result = sanitize(fetch(credential), int(now_fn()), expires)
        write_state(cache_path, {'attemptedAt': now, 'snapshot': result})
        return result


def validate_snapshot(value, now):
    keys = {'schema', 'channelId', 'observedAt', 'validUntil', 'credentialExpiresAt',
            'plan', 'rateLimit', 'additionalLimits', 'credits', 'zeroPurchasedCreditsObserved',
            'spendingCapVerified', 'grantsGeneration'}
    if (set(value) != keys or type(value['schema']) is not int or value['schema'] != 1
            or type(value['channelId']) is not int or value['channelId'] != CHANNEL_ID
            or value['spendingCapVerified'] is not False or value['grantsGeneration'] is not False):
        fail('invalid_quota_result')
    observed = integer(value['observedAt'], now - TTL, now + 5)
    integer(value['validUntil'], now + 1, observed + TTL)
    integer(value['credentialExpiresAt'], value['validUntil'] + 30, now + 366 * 86400)
    def raw_window(part):
        if part is None:
            return None
        return {'used_percent': part['usedPercent'], 'limit_window_seconds': part['limitWindowSeconds'],
                'reset_at': part['resetAt']}
    rate, credits = value['rateLimit'], value['credits']
    raw = {'plan_type': value['plan'], 'rate_limit': {'allowed': rate['allowed'],
           'limit_reached': rate['limitReached'], 'primary_window': raw_window(rate['primary']),
           'secondary_window': raw_window(rate['secondary'])},
           'credits': {'has_credits': credits['hasCredits'], 'unlimited': credits['unlimited'],
                       'balance': credits['balance']},
           'additional_rate_limits': [{'limit_name': item['name'], 'metered_feature': item['meteredFeature'],
              'primary_window': raw_window(item['primary']), 'secondary_window': raw_window(item['secondary'])}
              for item in value['additionalLimits']]}
    if sanitize(raw, observed, value['credentialExpiresAt']) != value:
        fail('invalid_quota_result')
    return value


def serve():
    if not command_allowed(os.environ):
        fail('command_denied')
    metadata = SCOPE.lstat()
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != 0 or metadata.st_mode & 0o022:
        fail('scope_not_protected')
    scope = read_json(SCOPE)
    if scope['channelId'] != CHANNEL_ID or scope['uid'] != os.getuid():
        fail('scope_mismatch')
    signal.signal(signal.SIGALRM, lambda *_: fail('quota_check_timeout'))
    signal.alarm(15)
    try:
        return snapshot(scope)
    finally:
        signal.alarm(0)


def client_command(root):
    private = root / '.private/quota-readonly'
    return ['/usr/bin/ssh', '-F', '/dev/null', '-T', '-i', str(private / 'id_ed25519'),
            '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'IdentityAgent=none',
            '-o', 'ForwardAgent=no', '-o', 'ClearAllForwardings=yes', '-o', 'PermitLocalCommand=no',
            '-o', 'ProxyCommand=none', '-o', 'StrictHostKeyChecking=yes', '-o', 'UpdateHostKeys=no',
            '-o', 'GlobalKnownHostsFile=/dev/null', '-o', 'UserKnownHostsFile=' + str(private / 'known_hosts'),
            '-o', 'ConnectTimeout=8', '-o', 'ConnectionAttempts=1', '-o', 'LogLevel=ERROR',
            '-o', 'SendEnv=-*', 'ubuntu@' + HOST, COMMAND]


def check(root):
    private = root / '.private/quota-readonly'
    for name in ('id_ed25519', 'known_hosts'):
        metadata = (private / name).lstat()
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_mode & 0o077:
            fail('client_files_not_private')
    result = subprocess.run(client_command(root), stdin=subprocess.DEVNULL,
                            capture_output=True, timeout=20, check=False)
    if result.returncode != 0:
        fail('private_quota_check_failed')
    if len(result.stdout) > MAX_OUTPUT:
        fail('response_too_large')
    return validate_snapshot(json.loads(result.stdout), int(time.time()))


def main():
    os.umask(0o077)
    try:
        if sys.argv[1:] == ['--serve']:
            result = serve()
        else:
            parser = argparse.ArgumentParser(description=__doc__)
            parser.add_argument('--root', type=Path, default=Path('/srv/luxsabers-social'))
            args = parser.parse_args()
            result = check(args.root.resolve())
        output = json.dumps(result, separators=(',', ':'), allow_nan=False)
        if len(output) > MAX_OUTPUT:
            fail('response_too_large')
        print(output)
        return 0
    except QuotaError as error:
        print(json.dumps({'schema': 1, 'error': str(error)}))
    except Exception:
        print(json.dumps({'schema': 1, 'error': 'quota_check_unavailable'}))
    return 1


if __name__ == '__main__':
    raise SystemExit(main())
