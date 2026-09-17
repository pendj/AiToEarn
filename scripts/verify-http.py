#!/usr/bin/env python3
"""Exercise the real private app, without printing passwords, cookies or IDs."""

import argparse
import hashlib
import http.cookiejar
import json
from pathlib import Path
import urllib.error
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument('--asset', type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
base = "http://127.0.0.1:18880"
cookiejar = http.cookiejar.CookieJar()
client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookiejar))
config = json.loads((root / ".private/gateway.json").read_text())
password = (root / ".private/operator-password.txt").read_text().strip()


def request(path, body=None, opener=client):
    headers = {"Origin": base}
    if body is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(base + path, data=json.dumps(body).encode() if body is not None else None, headers=headers)
    try:
        with opener.open(req, timeout=30) as response:
            return response.status, response.read(), response.geturl()
    except urllib.error.HTTPError as error:
        return error.code, error.read(), error.url


anonymous = urllib.request.build_opener()
assert request('/api/user/mine', opener=anonymous)[0] == 401, 'Anonymous API must fail'
assert request('/oss/not-an-asset.jpg', opener=anonymous)[0] == 401, 'Anonymous assets must fail'
assert request('/session/login', {'username': config['username'], 'password': password})[0] == 200, 'Private login failed'
assert len(list(cookiejar)) == 1, 'Expected one private session'
status, body, _ = request('/api/user/mine')
assert status == 200, 'Real upstream user API failed'
profile = json.loads(body)
assert profile.get('code') == 0, 'Real upstream rejected session'
assert profile['data'].get('id', profile['data'].get('_id')) == config['operatorId'], 'Wrong operator'
assert request('/api/config')[0] == 403, 'Raw config must be blocked'
assert request('/api/ai/config')[0] == 403, 'AI raw config must be blocked'
assert request('/api/ai/chat', {})[0] == 403, 'Unauthorized model call must fail'
assert request('/api/v2/channels/publish/tasks', {})[0] == 403, 'Unauthorized publish must fail'
status, html, _ = request('/en')
assert status == 200 and b'<html' in html.lower(), 'Real frontend failed'
for secret in [config['jwtSecret'], config['sessionKey'], password]:
    assert secret.encode() not in html, 'Secret present in frontend HTML'
if args.asset:
    asset = args.asset.resolve()
    assert asset.is_relative_to(root / '.runtime/assets'), 'Use only project-local staged assets'
    raw = asset.read_bytes()
    assert hashlib.sha256(raw).hexdigest() == '76200aea9476cd6bf08abaf425904115819737d88138becee2483cd53aec8d28', 'Unexpected product photo'
    status, body, _ = request('/api/assets/uploadSign', {'filename': asset.name, 'type': 'userMedia', 'size': len(raw)})
    assert status == 200 and json.loads(body).get('code') == 0, 'Real upload signing failed'
    signed = json.loads(body)['data']
    upload = urllib.request.Request(signed['uploadUrl'], data=raw, method='PUT', headers={'Origin': base, 'Content-Type': 'image/webp'})
    try:
        with urllib.request.urlopen(upload, timeout=30) as response:
            assert response.status == 200, 'Real signed storage upload failed'
    except urllib.error.HTTPError as error:
        raise SystemExit(f'Signed storage upload returned HTTP {error.code}; provider payload not printed') from None
    status, body, _ = request('/api/assets/' + signed['id'] + '/confirm', {})
    assert status == 200 and json.loads(body).get('code') == 0, 'Real upload confirmation failed'
    status, downloaded, _ = request('/oss/' + signed['path'].lstrip('/'))
    assert status == 200 and downloaded == raw, 'Stored product photo must match source bytes'
    assert request('/oss/' + signed['path'].lstrip('/'), opener=anonymous)[0] == 401, 'Product photo must stay private'
    print('PASS: source-matched product photo signed upload, application confirmation, exact private download and anonymous denial.')
assert request('/session/logout', {})[0] == 200, 'Logout failed'
assert request('/api/user/mine')[0] == 401, 'Logged-out API must fail'
print('PASS: real private login, correct upstream operator, frontend HTML, anonymous denial, credential boundaries, paused model/publishing, logout.')
