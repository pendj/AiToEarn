#!/usr/bin/env python3
"""Install/revoke one source-restricted quota key without changing sshd or services."""
import argparse
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import sqlite3
import stat

TARGET = Path('/opt/luxsabers-codex-quota')
RECORD = Path('/var/lib/luxsabers-codex-quota-install')
KEYS = Path('/home/ubuntu/.ssh/authorized_keys')
STATE = Path('/home/ubuntu/ccload/.private/quota-readonly-state')
DATABASE = Path('/home/ubuntu/ccload/data/ccload.db')
MARKER = 'luxsabers-social-quota-v1'


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def key_line(raw):
    fields = raw.strip().split()
    if len(fields) not in (2, 3) or fields[0] != 'ssh-ed25519' or not re.fullmatch(r'[A-Za-z0-9+/=]{68}', fields[1]):
        raise ValueError('One ed25519 public key required')
    return ('restrict,from="163.192.46.78",command="/usr/bin/python3 -I '
            '/opt/luxsabers-codex-quota/codex_quota.py --serve" '
            + fields[0] + ' ' + fields[1] + ' ' + MARKER + '\n').encode()


def write(path, raw, mode, uid=0, gid=0):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    with os.fdopen(fd, 'wb') as target:
        os.fchmod(target.fileno(), mode)
        target.write(raw)
        target.flush()
        os.fsync(target.fileno())
    os.chown(path, uid, gid)


def replace_keys(before, after):
    info = KEYS.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077 or KEYS.read_bytes() != before:
        raise ValueError('Authorized keys changed or not protected')
    pending = KEYS.with_name('authorized_keys.luxsabers-quota-pending')
    write(pending, after, 0o600, info.st_uid, info.st_gid)
    if KEYS.read_bytes() != before:
        raise ValueError('Authorized keys changed; preserving pending file')
    os.replace(pending, KEYS)


def install(helper, public_key, expected_name_sha256):
    if any(path.exists() for path in (TARGET, RECORD, STATE)):
        raise ValueError('Quota installation already exists; inspect before repeating')
    info = KEYS.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077:
        raise ValueError('Protected authorized keys required')
    before = KEYS.read_bytes()
    line = key_line(public_key.read_text())
    if MARKER.encode() in before or line.split()[-2] in before:
        raise ValueError('Quota key already present')
    with closing(sqlite3.connect(DATABASE.as_uri() + '?mode=ro', uri=True)) as db:
        row = db.execute('SELECT name, auth_type, enabled, oauth_credential FROM channels WHERE id=3').fetchone()
    if (not row or digest(row[0].encode()) != expected_name_sha256
            or row[1] != 'codex_oauth' or row[2] != 1):
        raise ValueError('Designated account mismatch')
    credential = json.loads(row[3])
    identity = [row[0], credential.get('email'), credential.get('account_id')]
    if any(not isinstance(value, str) or not value for value in identity):
        raise ValueError('Designated account identity missing')
    user = pwd.getpwnam('ubuntu')
    scope = {'channelId': 3, 'uid': user.pw_uid,
             'identitySha256': digest(json.dumps(identity, separators=(',', ':')).encode())}
    code = helper.read_bytes()
    compile(code, str(helper), 'exec')
    after = before + (b'' if before.endswith(b'\n') else b'\n') + line
    TARGET.mkdir(mode=0o755)
    TARGET.chmod(0o755)
    RECORD.mkdir(mode=0o700)
    STATE.mkdir(mode=0o700)
    os.chown(STATE, user.pw_uid, user.pw_gid)
    write(TARGET / 'codex_quota.py', code, 0o755)
    write(TARGET / 'scope.json', json.dumps(scope).encode(), 0o644)
    write(RECORD / 'authorized_keys.before', before, 0o600)
    record = {'beforeSha256': digest(before), 'afterSha256': digest(after),
              'helperSha256': digest(code), 'addedLine': line.decode()}
    write(RECORD / 'installation.json', json.dumps(record).encode(), 0o600)
    replace_keys(before, after)
    print(json.dumps({'installed': True, 'channelId': 3, 'publicListenerAdded': False,
                      'existingKeysPreserved': after.startswith(before), 'helperSha256': digest(code)}))


def revoke():
    record = json.loads((RECORD / 'installation.json').read_bytes())
    current = KEYS.read_bytes()
    line = record['addedLine'].encode()
    if current.count(line) != 1:
        raise ValueError('Expected exact quota key not found; refusing broad edits')
    if digest(current) == record['afterSha256']:
        restored = (RECORD / 'authorized_keys.before').read_bytes()
        if digest(restored) != record['beforeSha256']:
            raise ValueError('Original keys backup mismatch')
    else:
        restored = current.replace(line, b'', 1)
    replace_keys(current, restored)
    print(json.dumps({'quotaKeyRevoked': True, 'otherKeysPreserved': True,
                      'retainedHelperAndAuditFiles': True, 'servicesRestarted': False}))


if __name__ == '__main__':
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--helper', type=Path)
    parser.add_argument('--public-key', type=Path)
    parser.add_argument('--expected-name-sha256')
    parser.add_argument('--revoke', action='store_true')
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise SystemExit('Root is required only for installation or exact-key revocation.')
    try:
        if args.revoke:
            revoke()
        elif args.helper and args.public_key and re.fullmatch(r'[a-f0-9]{64}', args.expected_name_sha256 or ''):
            install(args.helper, args.public_key, args.expected_name_sha256)
        else:
            raise ValueError('Explicit reviewed helper, key and account fingerprint required')
    except Exception:
        raise SystemExit('Quota installation stopped; inspect protected installation record, do not overwrite it.') from None
