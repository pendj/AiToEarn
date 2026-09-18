#!/usr/bin/env python3
"""Guarded, recoverable changes to only the three application storage configs."""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import stat
from provision import private_write

NAMES = ('gateway.json', 'server.yaml', 'ai.yaml')
ENDPOINT = 'https://08c44086c81cc0cea32aa0288236416f.r2.cloudflarestorage.com'
BUCKET = 'luxsabers-social-media'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_private(path):
    mode = path.lstat().st_mode
    if not stat.S_ISREG(mode) or mode & 0o077:
        raise ValueError('Private regular configuration required')
    return path.read_bytes()


def updated_configs(original, r2):
    if any(r2.get(k) != v for k, v in {'provider': 'r2', 'endpoint': ENDPOINT, 'bucket': BUCKET, 'region': 'auto'}.items()):
        raise ValueError('Unexpected R2 target')
    values = copy.deepcopy(original)
    source = original['gateway.json']['storage']
    if source['endpoint'] != 'http://storage:9000' or source['bucket'] != 'luxsabers-social':
        raise ValueError('Original local store required')
    for name in ('server.yaml', 'ai.yaml'):
        assets = values[name]['assets']
        if any(assets.get(k) != v for k, v in {'endpoint': source['endpoint'], 'bucketName': source['bucket'],
                  'accessKeyId': source['accessKey'], 'secretAccessKey': source['secretKey'], 'signExpires': 300}.items()):
            raise ValueError('Native storage configuration differs from gateway')
        assets.update(region='auto', endpoint=ENDPOINT, publicEndpoint=ENDPOINT, bucketName=BUCKET,
                      accessKeyId=r2['accessKey'], secretAccessKey=r2['secretKey'], forcePathStyle=True)
    values['gateway.json']['storage'] = r2
    return values


def activate(root):
    private = root / '.private'
    directory = root / '.runtime/r2-migration'
    manifest = directory / 'activation.json'
    if manifest.exists():
        raise ValueError('Activation already recorded; inspect before changing it')
    original_bytes = {name: read_private(private / name) for name in NAMES}
    r2_bytes = read_private(private / 'r2.json')
    evidence = json.loads(read_private(directory / 'copy.json'))
    if not evidence.get('passed') or evidence['sourceConfigSha256'] != digest(original_bytes['gateway.json']) or evidence['r2ConfigSha256'] != digest(r2_bytes):
        raise ValueError('Fresh successful migration evidence required')
    values = updated_configs({name: json.loads(raw) for name, raw in original_bytes.items()}, json.loads(r2_bytes))
    values['gateway.json']['mediaAllowance'] = {'initialBytes': sum(o['bytes'] for o in evidence['objects']),
                                                'maxBytes': 9_900_000_000, 'dailyUploads': 32}
    pending = {name: (json.dumps(values[name], indent=2) + '\n').encode() for name in NAMES}
    backups = directory / 'original-config'
    backups.mkdir(mode=0o700)
    for name, data in original_bytes.items():
        private_write(backups / name, data.decode())
    record = {name: {'before': digest(original_bytes[name]), 'after': digest(pending[name])} for name in NAMES}
    private_write(manifest, json.dumps(record, indent=2) + '\n')
    for name, data in pending.items():
        target = private / name
        if digest(read_private(target)) != record[name]['before']:
            raise ValueError('Configuration changed during activation; preserve backup')
        staged = target.with_name(name + '.r2-pending')
        private_write(staged, data.decode())
        staged.replace(target)
    print('R2 storage configuration activated; original files preserved. Restart only affected project services.')


def rollback(root):
    private = root / '.private'
    directory = root / '.runtime/r2-migration'
    record = json.loads(read_private(directory / 'activation.json'))
    for name in NAMES:
        if digest(read_private(private / name)) not in (record[name]['before'], record[name]['after']):
            raise ValueError('Configuration has later edits; refusing to overwrite')
        if digest(read_private(directory / 'original-config' / name)) != record[name]['before']:
            raise ValueError('Rollback backup mismatch')
    for name in NAMES:
        if digest(read_private(private / name)) == record[name]['before']:
            continue
        staged = private / (name + '.rollback-pending')
        private_write(staged, read_private(directory / 'original-config' / name).decode())
        staged.replace(private / name)
    print('Original three storage configurations restored; R2 objects and local data preserved.')


if __name__ == '__main__':
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--rollback', action='store_true')
    args = parser.parse_args()
    try:
        (rollback if args.rollback else activate)(args.root.resolve())
    except (OSError, ValueError, KeyError):
        raise SystemExit('Storage configuration change stopped; preserve private migration evidence and backups.') from None
