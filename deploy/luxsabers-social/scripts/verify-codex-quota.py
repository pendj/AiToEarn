#!/usr/bin/env python3
"""Exercise the actual private SSH quota boundary from the social host."""
import argparse
import json
from pathlib import Path
import subprocess
import codex_quota as quota


def verify(root):
    first = quota.check(root)
    second = quota.check(root)
    assert first == second, 'Repeated check did not reuse the fresh sanitized result'
    command = quota.client_command(root)
    for rejected in ('id', 'quota-v1 2', 'quota-v1; id', ''):
        result = subprocess.run(command[:-1] + [rejected], stdin=subprocess.DEVNULL,
                                capture_output=True, timeout=20, check=False)
        assert result.returncode != 0, 'An arbitrary command was accepted'
        assert json.loads(result.stdout) == {'schema': 1, 'error': 'command_denied'}
    # ERROR hides the server's denial reason; capture VERBOSE privately, never print it.
    forward_options = ['LogLevel=VERBOSE' if part == 'LogLevel=ERROR' else part for part in command[:-2]]
    forwarded = forward_options + ['-W', '127.0.0.1:18080', command[-2]]
    result = subprocess.run(forwarded, stdin=subprocess.DEVNULL, capture_output=True, timeout=20, check=False)
    assert result.returncode != 0 and b'administratively prohibited' in result.stderr
    assert b'Authenticated to ' in result.stderr, 'Forwarding check did not reach the authorized SSH session'
    assert not result.stdout, 'Port forwarding unexpectedly returned application data'
    print(json.dumps({'realReadOnlyQuota': True, 'sameFreshSnapshotReused': True,
                      'arbitraryCommandsDenied': 4, 'portForwardingDenied': True,
                      'channelId': 3, 'quota': first}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path('/srv/luxsabers-social'))
    args = parser.parse_args()
    try:
        verify(args.root.resolve())
    except Exception:
        raise SystemExit('Private quota verification failed; no provider response or credentials printed.') from None
