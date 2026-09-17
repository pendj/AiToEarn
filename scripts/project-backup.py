#!/usr/bin/env python3
"""Cold backup this deployment; verify only in newly created isolated copies."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import time

ROOT = Path('/srv/luxsabers-social')
PROJECT = 'luxsabers-social'
VOLUMES = ('mongo-data', 'mongo-config', 'redis-data', 'storage-data')
CODE = ('compose.yaml', '.env', 'images.lock.json', 'package.json', 'package-lock.json',
        'gateway', 'server', 'automation', 'scripts', '.private', '.runtime/automation')


def run(args, *, stdout=subprocess.PIPE, stdin=None, timeout=180):
    result = subprocess.run(args, cwd=ROOT, stdin=stdin, stdout=stdout,
                            stderr=subprocess.PIPE, timeout=timeout)
    if result.returncode:
        raise RuntimeError(f'{args[0]} {args[1]} failed with exit {result.returncode}; output suppressed')
    return result.stdout.decode() if result.stdout is not None else ''


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def environment():
    values = dict(line.split('=', 1) for line in (ROOT / '.env').read_text().splitlines() if '=' in line)
    if not re.fullmatch('[a-f0-9]{40}', values.get('RELEASE_ID', '')):
        raise RuntimeError('Expected an exact deployed release')
    for key in ('NODE_IMAGE', 'MONGO_IMAGE', 'REDIS_IMAGE', 'STORAGE_IMAGE'):
        if not re.fullmatch(r'[a-z0-9/._-]+@sha256:[a-f0-9]{64}', values.get(key, '')):
            raise RuntimeError('Expected pinned backup tools and stores')
    return values


def snapshot_path(name):
    if not re.fullmatch(r'\d{8}T\d{6}Z-[a-f0-9]{7}', name):
        raise ValueError('Use the exact snapshot identifier printed by snapshot')
    return ROOT / '.runtime/backups' / name


def volume_tool(image, volume, args, *, readonly=True, stdout=subprocess.PIPE, stdin=None):
    mount = f'type=volume,source={volume},target=/volume' + (',readonly' if readonly else '')
    return run(['docker', 'run', '--rm', '--network', 'none', '--read-only', '--cpus', '0.25',
                '--memory', '192m', '--security-opt', 'no-new-privileges:true',
                '--mount', mount, '--entrypoint', 'tar', image, *args], stdout=stdout, stdin=stdin)


def snapshot():
    env = environment()
    if shutil.disk_usage(ROOT).free < 12 * 1024**3:
        raise RuntimeError('Less than 12 GiB free; backup refused')
    names = run(['docker', 'volume', 'ls', '--filter', f'label=com.docker.compose.project={PROJECT}', '--format', '{{.Name}}']).splitlines()
    expected = {f'{PROJECT}_{suffix}' for suffix in VOLUMES}
    if set(names) != expected:
        raise RuntimeError('Project volume set differs; no services stopped')
    ids = run(['docker', 'ps', '-q', '--filter', f'label=com.docker.compose.project={PROJECT}']).splitlines()
    if not ids:
        raise RuntimeError('No running target services; review state before backup')
    containers = json.loads(run(['docker', 'inspect', *ids]))
    services = [item['Config']['Labels']['com.docker.compose.service'] for item in containers]
    name = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + env['RELEASE_ID'][:7]
    target = snapshot_path(name)
    target.mkdir(parents=True, mode=0o700)
    manifest = {'schemaVersion': 1, 'release': env['RELEASE_ID'], 'services': services,
                'images': {item['Config']['Labels']['com.docker.compose.service']: item['Image'] for item in containers},
                'environment': {key: env[key] for key in ('NODE_IMAGE', 'MONGO_IMAGE', 'REDIS_IMAGE', 'STORAGE_IMAGE')},
                'archives': {}}
    stopped = False
    try:
        stopped = True
        print('Stopping only the social project for a consistent snapshot.', flush=True)
        run(['docker', 'compose', 'stop', '--timeout', '20', *services])
        if run(['docker', 'ps', '-q', '--filter', f'label=com.docker.compose.project={PROJECT}']).strip():
            raise RuntimeError('Project writers are still running; backup refused')
        config_archive = target / 'configuration.tar.gz'
        with tarfile.open(config_archive, 'x:gz') as archive:
            for name_in_archive in CODE:
                path = ROOT / name_in_archive
                if not path.exists():
                    continue
                if path.is_symlink() or path.is_dir() and any(p.is_symlink() for p in path.rglob('*')):
                    raise RuntimeError('Unexpected symlink in project configuration')
                archive.add(path, arcname=name_in_archive)
        manifest['archives'][config_archive.name] = digest(config_archive)
        for suffix in VOLUMES:
            print(f'Backing up project volume: {suffix}', flush=True)
            archive = target / f'{suffix}.tar.gz'
            with archive.open('xb') as output:
                volume_tool(env['NODE_IMAGE'], f'{PROJECT}_{suffix}', ['-czf', '-', '-C', '/volume', '.'], stdout=output)
            manifest['archives'][archive.name] = digest(archive)
        (target / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
        print(f'Backup complete: {target.name}; configuration and four project volumes preserved.')
    finally:
        if stopped:
            run(['docker', 'compose', 'start', *services])


def wait_ready(name, command):
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        try:
            return run(['docker', 'exec', name, *command], timeout=10)
        except RuntimeError:
            time.sleep(2)
    raise RuntimeError('Isolated restored service did not become ready')


def verify(snapshot_id):
    target = snapshot_path(snapshot_id)
    manifest = json.loads((target / 'manifest.json').read_text())
    expected_archives = {'configuration.tar.gz', *(f'{suffix}.tar.gz' for suffix in VOLUMES)}
    if manifest.get('schemaVersion') != 1 or set(manifest['archives']) != expected_archives:
        raise RuntimeError('Unexpected backup manifest')
    for name, expected in manifest['archives'].items():
        if digest(target / name) != expected:
            raise RuntimeError('Backup checksum mismatch; no restore started')
    if shutil.disk_usage(ROOT).free < 12 * 1024**3:
        raise RuntimeError('Less than 12 GiB free; restore verification refused')
    env = manifest['environment']
    prefix = f'{PROJECT}-restore-{snapshot_id.lower()}'
    volumes = []
    containers = []
    try:
        for suffix in VOLUMES:
            name = f'{prefix}-{suffix}'
            existing = run(['docker', 'volume', 'ls', '--format', '{{.Name}}', '--filter', f'name=^{name}$']).splitlines()
            if existing:
                raise RuntimeError('Restore target already exists; no overwrite permitted')
            run(['docker', 'volume', 'create', '--label', f'luxsabers.social.restore={snapshot_id}', name])
            volumes.append(name)
            with (target / f'{suffix}.tar.gz').open('rb') as source:
                volume_tool(env['NODE_IMAGE'], name, ['-xzf', '-', '-C', '/volume'], readonly=False, stdin=source)
            with (target / f'{suffix}.tar.gz').open('rb') as source:
                volume_tool(env['NODE_IMAGE'], name, ['-dzf', '-', '-C', '/volume'], stdin=source)
        for kind, image, options in [
            ('mongodb', env['MONGO_IMAGE'], ['--entrypoint', 'mongod', '--mount', f'type=volume,source={prefix}-mongo-data,target=/data/db']),
            ('redis', env['REDIS_IMAGE'], ['--entrypoint', 'redis-server', '--mount', f'type=volume,source={prefix}-redis-data,target=/data']),
        ]:
            name = f'{prefix}-{kind}'
            args = ['--bind_ip', '127.0.0.1', '--dbpath', '/data/db', '--noauth'] if kind == 'mongodb' else ['--bind', '127.0.0.1', '--appendonly', 'yes', '--dir', '/data']
            run(['docker', 'run', '-d', '--name', name, '--label', f'luxsabers.social.restore={snapshot_id}',
                 '--network', 'none', '--cpus', '0.3', '--memory', '768m', '--security-opt', 'no-new-privileges:true', *options, image, *args])
            containers.append(name)
            if kind == 'mongodb':
                result = wait_ready(name, ['mongosh', '--quiet', '--eval', "const d=db.getSiblingDB('aitoearn'); if(d.getCollection('user').countDocuments({mail:'operator@luxsabers.local'})!==1) quit(2); print('restored-operator-ok');"])
                if 'restored-operator-ok' not in result:
                    raise RuntimeError('Restored operator check failed')
            else:
                if wait_ready(name, ['redis-cli', 'ping']).strip() != 'PONG':
                    raise RuntimeError('Restored Redis check failed')
        (target / 'verification.json').write_text(json.dumps({'schemaVersion': 1, 'verifiedAt': datetime.now(timezone.utc).isoformat(),
            'checks': ['all_archive_hashes', 'four_restored_volume_byte_comparisons', 'restored_mongodb_operator', 'restored_redis_startup'],
            'limits': 'No restored AI/provider calls or real posts; storage files compared byte-for-byte, not a public-media acceptance.'}, indent=2) + '\n')
        print('PASS: snapshot checksums, four isolated volume restores, MongoDB operator and Redis startup.')
    finally:
        for name in reversed(containers):
            run(['docker', 'rm', '-f', name])
        for name in reversed(volumes):
            run(['docker', 'volume', 'rm', name])
        print('Removed only restore-test containers/volumes created by this run; original services and backup retained.')


if __name__ == '__main__':
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['snapshot', 'verify'])
    parser.add_argument('--snapshot')
    args = parser.parse_args()
    if Path.cwd().resolve() != ROOT or not (ROOT / 'compose.yaml').is_file():
        raise SystemExit('Run only in /srv/luxsabers-social')
    try:
        if args.action == 'snapshot':
            snapshot()
        else:
            verify(args.snapshot or '')
    except (RuntimeError, ValueError, OSError, subprocess.TimeoutExpired) as error:
        detail = str(error) if isinstance(error, (RuntimeError, ValueError)) else type(error).__name__
        raise SystemExit(f'Scoped backup/restore stopped: {detail}. Preserve partial files; sensitive command output suppressed.') from None
