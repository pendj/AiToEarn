#!/usr/bin/env python3
"""Connect only the paused native text provider and retain exact rollback files."""
import argparse
import copy
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import secrets
import stat
from provision import private_write

NAMES = ('gateway.json', 'ai.yaml')
TARGET = {'origin': 'https://ccload.luxsabers.com', 'model': 'gpt-5.6-luna', 'channelId': 3}
FIELDS = set(TARGET) | {'apiKey', 'tokenId', 'tokenExpiresAt', 'restrictionsVerified'}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_private(path):
    mode = path.lstat().st_mode
    if not stat.S_ISREG(mode) or mode & 0o077:
        raise ValueError('Private regular configuration required')
    return path.read_bytes()


def updated_configs(original, connection, internal_key):
    if set(connection) != FIELDS or any(connection.get(key) != value for key, value in TARGET.items()):
        raise ValueError('Unexpected model target')
    if connection['restrictionsVerified'] is not True or type(connection['tokenId']) is not int or connection['tokenId'] < 1:
        raise ValueError('Verified restricted token required')
    for key in (connection['apiKey'], internal_key):
        if not isinstance(key, str) or len(key) != 64 or any(char not in '0123456789abcdef' for char in key):
            raise ValueError('Invalid model connection key')
    expires = datetime.fromisoformat(connection['tokenExpiresAt'].replace('Z', '+00:00'))
    if expires.tzinfo is None or (expires - datetime.now(timezone.utc)).total_seconds() <= 300:
        raise ValueError('Current expiring model connection required')
    if original['gateway.json'].get('automation') is not True or 'modelGateway' in original['gateway.json']:
        raise ValueError('Original automation-enabled gateway required')
    ai = original['ai.yaml']['ai']
    if ai['models']['chat'] or ai['openai'] != {'apiKey': '', 'baseUrl': 'http://127.0.0.1:9', 'timeout': 10000}:
        raise ValueError('Original disabled text provider required')
    values = copy.deepcopy(original)
    values['gateway.json']['modelGateway'] = {**connection, 'internalKey': internal_key}
    values['ai.yaml']['ai']['openai'] = {'apiKey': internal_key, 'baseUrl': 'http://gateway:8083/v1', 'timeout': 55000}
    values['ai.yaml']['ai']['models']['chat'] = [{
        'name': TARGET['model'], 'description': 'LuxSabers source-backed text drafting',
        'channel': 'openai', 'inputModalities': ['text'], 'outputModalities': ['text'],
    }]
    return values


def activate(root):
    private = root / '.private'
    directory = root / '.runtime/model-connection'
    manifest = directory / 'activation.json'
    if manifest.exists():
        raise ValueError('Activation already recorded; inspect before repeating')
    authority = json.loads(read_private(private / 'automation-authority.json'))
    if authority.get('model', {}).get('authorized') is not False:
        raise ValueError('Model generation must remain unauthorized during connection setup')
    original = {name: read_private(private / name) for name in NAMES}
    connection = json.loads(read_private(private / 'ccload-model.json'))
    values = updated_configs({name: json.loads(raw) for name, raw in original.items()}, connection, secrets.token_hex(32))
    pending = {name: (json.dumps(values[name], indent=2) + '\n').encode() for name in NAMES}
    backups = directory / 'original-config'
    backups.mkdir(parents=True, mode=0o700)
    directory.chmod(0o700)
    for name, raw in original.items():
        private_write(backups / name, raw.decode())
    record = {name: {'before': digest(original[name]), 'after': digest(pending[name])} for name in NAMES}
    private_write(manifest, json.dumps(record, indent=2) + '\n')
    for name, raw in pending.items():
        target = private / name
        if digest(read_private(target)) != record[name]['before']:
            raise ValueError('Configuration changed during activation')
        staged = target.with_name(name + '.model-pending')
        private_write(staged, raw.decode())
        staged.replace(target)
    print('Only gateway and native text-provider settings connected; authority, pause and other configuration preserved.')


def rollback(root):
    private = root / '.private'
    directory = root / '.runtime/model-connection'
    record = json.loads(read_private(directory / 'activation.json'))
    for name in NAMES:
        if digest(read_private(private / name)) not in (record[name]['before'], record[name]['after']):
            raise ValueError('Configuration has later edits; refusing rollback')
        if digest(read_private(directory / 'original-config' / name)) != record[name]['before']:
            raise ValueError('Rollback backup mismatch')
    for name in NAMES:
        if digest(read_private(private / name)) == record[name]['before']:
            continue
        staged = private / (name + '.model-rollback-pending')
        private_write(staged, read_private(directory / 'original-config' / name).decode())
        staged.replace(private / name)
    print('Original gateway and AI configuration restored; generation attempts, authorization and all media preserved.')


if __name__ == '__main__':
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--rollback', action='store_true')
    args = parser.parse_args()
    try:
        (rollback if args.rollback else activate)(args.root.resolve())
    except (OSError, ValueError, KeyError, TypeError):
        raise SystemExit('Model connection change stopped; preserve private state and backups.') from None
