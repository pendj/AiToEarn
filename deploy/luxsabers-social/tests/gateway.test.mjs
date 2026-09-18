import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, scryptSync } from 'node:crypto';
import { createServer } from 'node:http';
import { jwtVerify } from 'jose';
import { buildApp } from '../gateway/app.mjs';
import { AutomationState } from '../automation/state.mjs';
import { automationControl } from '../automation/control.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { r2Target } from '../gateway/storage.mjs';
import { MediaBudget } from '../gateway/media-budget.mjs';

const password = 'test-only-password-not-for-deployment';
const salt = randomBytes(16);
const config = {
  origins: ['http://127.0.0.1:18080'], secureCookie: false,
  username: 'luxsabers', operatorId: '0123456789abcdef01234567',
  passwordSalt: salt.toString('hex'), passwordHash: scryptSync(password, salt, 64).toString('hex'),
  sessionKey: randomBytes(32).toString('hex'), sessionEpoch: 'test-epoch', jwtSecret: randomBytes(48).toString('hex'),
  storage: { endpoint: 'http://127.0.0.1:9', accessKey: 'test', secretKey: 'test', bucket: 'test' },
};
const headers = { host: '127.0.0.1:18080', origin: 'http://127.0.0.1:18080' };

async function login(app) {
  const response = await app.inject({ method: 'POST', url: '/session/login', headers, payload: { username: 'luxsabers', password } });
  assert.equal(response.statusCode, 302);
  assert.equal(response.headers.location, '/session/ready');
  const cookie = response.headers['set-cookie'];
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Strict/i);
  assert.ok(!cookie.includes(password));
  return cookie.split(';')[0];
}

test('anonymous access cannot reach app, API, or assets; hostile Host rejected', async t => {
  const app = await buildApp(config, { enableProxy: false });
  t.after(() => app.close());
  for (const url of ['/', '/en', '/session/ready', '/session/bootstrap.js']) {
    const response = await app.inject({ url, headers });
    assert.equal(response.statusCode, 302);
    assert.equal(response.headers.location, '/session/login');
  }
  for (const url of ['/api/user/mine', '/oss/test.jpg']) assert.equal((await app.inject({ url, headers })).statusCode, 401);
  assert.equal((await app.inject({ url: '/', headers: { host: 'attacker.example' } })).statusCode, 400);
  const loginResponse = await app.inject({ url: '/session/login', headers });
  assert.equal(loginResponse.headers['referrer-policy'], 'same-origin');
  const html = loginResponse.body;
  for (const secret of [config.jwtSecret, config.sessionKey, config.passwordHash, password]) assert.ok(!html.includes(secret));
});

test('real password authentication, HttpOnly session, non-secret UI marker and logout', async t => {
  const app = await buildApp(config, { enableProxy: false });
  t.after(() => app.close());
  const failed = await app.inject({ method: 'POST', url: '/session/login', headers, payload: { username: 'luxsabers', password: 'wrong' } });
  assert.equal(failed.statusCode, 401);
  const cookie = await login(app);
  const bootstrap = await app.inject({ url: '/session/bootstrap.js', headers: { ...headers, cookie } });
  assert.equal(bootstrap.statusCode, 200);
  assert.match(bootstrap.body, /private-gateway-session-not-a-credential/);
  for (const secret of [config.jwtSecret, config.sessionKey, config.passwordHash, password]) assert.ok(!bootstrap.body.includes(secret));
  const logout = await app.inject({ method: 'POST', url: '/session/logout', headers: { ...headers, cookie } });
  assert.equal(logout.statusCode, 200);
  assert.match(logout.headers['set-cookie'], /Max-Age=0/i);
  assert.equal((await app.inject({ url: '/session/clear.js', headers })).statusCode, 200);
});

test('CSRF, unauthorized spend, account mutation and raw configuration fail closed', async t => {
  const app = await buildApp(config, { enableProxy: false });
  t.after(() => app.close());
  const cookie = await login(app);
  const auth = { ...headers, cookie };
  for (const url of ['/api/config', '/api/config/restart', '/api/ai/config', '/api/ai/%63onfig', '/api/api-key', '/api/user/ai/config/info', '/api/v2/channels/accounts/auth/facebook']) {
    assert.equal((await app.inject({ url, headers: auth })).statusCode, 403, url);
  }
  for (const url of ['/api/ai/chat', '/api/agent/run', '/api/v2/channels/publish/tasks']) {
    assert.equal((await app.inject({ method: 'POST', url, headers: auth, payload: {} })).statusCode, 403, url);
  }
  assert.equal((await app.inject({ method: 'POST', url: '/session/logout', headers: { ...auth, origin: 'https://attacker.example' } })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: '/session/login', headers: { host: headers.host }, payload: {} })).statusCode, 403);
});

test('restarts preserve sessions but an explicit epoch change invalidates them', async () => {
  const first = await buildApp(config, { enableProxy: false });
  const cookie = await login(first);
  await first.close();
  const second = await buildApp(config, { enableProxy: false });
  assert.equal((await second.inject({ url: '/session', headers: { ...headers, cookie } })).statusCode, 200);
  await second.close();
  const rotated = await buildApp({ ...config, sessionEpoch: 'revoked' }, { enableProxy: false });
  assert.equal((await rotated.inject({ url: '/session', headers: { ...headers, cookie } })).statusCode, 302);
  await rotated.close();
});

test('failed password attempts are rate limited', async t => {
  const app = await buildApp(config, { enableProxy: false });
  t.after(() => app.close());
  for (let i = 0; i < 5; i++) assert.equal((await app.inject({ method: 'POST', url: '/session/login', headers, payload: { username: 'luxsabers', password: 'wrong' } })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/session/login', headers, payload: { username: 'luxsabers', password: 'wrong' } })).statusCode, 429);
});

test('proxy injects only a short-lived server JWT, not browser credentials', async t => {
  const backend = createServer(async (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const { payload } = await jwtVerify(token, new TextEncoder().encode(config.jwtSecret), { algorithms: ['HS256'] });
    assert.equal(payload.id, config.operatorId);
    assert.ok(payload.exp - payload.iat <= 300);
    assert.equal(req.headers.cookie, undefined);
    assert.equal(req.headers['x-api-key'], undefined);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ path: req.url, code: 0 }));
  });
  await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => backend.close(resolve)));
  const upstream = `http://127.0.0.1:${backend.address().port}`;
  const app = await buildApp({ ...config, serverOrigin: upstream, aiOrigin: upstream, webOrigin: upstream });
  t.after(() => app.close());
  const cookie = await login(app);
  const response = await app.inject({ url: '/api/user/mine', headers: { ...headers, cookie, authorization: 'Bearer forged', 'x-api-key': 'forged-key' } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { path: '/user/mine', code: 0 });
  assert.ok(!response.body.includes(config.jwtSecret));
});

test('private storage downloads honor the configured signing region without leaking credentials', async t => {
  let authorization;
  const backend = createServer((req, res) => {
    authorization = req.headers.authorization;
    res.setHeader('content-type', 'image/jpeg');
    res.end('private-image-bytes');
  });
  await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => backend.close(resolve)));
  const upstream = `http://127.0.0.1:${backend.address().port}`;
  const app = await buildApp({ ...config, serverOrigin: upstream, aiOrigin: upstream, webOrigin: upstream,
    storage: { ...config.storage, endpoint: upstream, region: 'auto' } });
  t.after(() => app.close());
  const cookie = await login(app);
  const response = await app.inject({ url: '/oss/private.jpg', headers: { ...headers, cookie } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body, 'private-image-bytes');
  assert.match(authorization, /\/auto\/s3\/aws4_request/);
  assert.ok(!JSON.stringify(response.headers).includes('AWS4-HMAC-SHA256'));
  assert.equal((await app.inject({ url: '/oss/private.jpg', headers })).statusCode, 401);
});

test('R2 upload signing stays authenticated and rewrites only the correct private object URL', async t => {
  const storage = { ...r2Target, accessKey: 'a'.repeat(32), secretKey: 'b'.repeat(64) };
  const path = `${config.operatorId}/user/media/202609/image.jpg`;
  const signed = new URL(`${storage.endpoint}/${storage.bucket}/${path}`);
  signed.searchParams.set('X-Amz-Signature', 'c'.repeat(64));
  signed.searchParams.set('X-Amz-Expires', '300');
  let returnedUrl = signed.href;
  let calls = 0;
  const backend = createServer(async (req, res) => {
    calls++;
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/assets/uploadSign');
    assert.equal(req.headers.cookie, undefined);
    assert.ok(req.headers.authorization.startsWith('Bearer '));
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ code: 0, data: { id: '1'.repeat(24), path, url: `${config.origins[0]}/oss/${path}`, uploadUrl: returnedUrl } }));
  });
  await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => backend.close(resolve)));
  const upstream = `http://127.0.0.1:${backend.address().port}`;
  const mediaBudget = new MediaBudget(':memory:');
  t.after(() => mediaBudget.close());
  const app = await buildApp({ ...config, storage, serverOrigin: upstream, aiOrigin: upstream, webOrigin: upstream }, { mediaBudget });
  t.after(() => app.close());
  const payload = { filename: 'image.jpg', type: 'userMedia', size: 10 };
  assert.equal((await app.inject({ method: 'POST', url: '/api/assets/uploadSign', headers, payload })).statusCode, 401);
  assert.equal(calls, 0);
  const cookie = await login(app);
  const request = () => app.inject({ method: 'POST', url: '/api/assets/uploadSign', headers: { ...headers, cookie }, payload });
  const result = await request();
  assert.equal(result.statusCode, 200);
  const rewritten = new URL(result.json().data.uploadUrl);
  assert.equal(rewritten.origin, 'http://127.0.0.1:19000');
  assert.equal(rewritten.pathname, signed.pathname);
  assert.equal(rewritten.search, signed.search);
  returnedUrl = signed.href.replace(storage.endpoint, 'https://other.example');
  assert.equal((await request()).statusCode, 502);
  returnedUrl = signed.href.replace('/user/media/', '/user/files/');
  assert.equal((await request()).statusCode, 502);
});

test('private automation controls keep zero-budget resume blocked and persist a real pause', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'social-controls-'));
  const state = new AutomationState(join(directory, 'state.sqlite'));
  const control = automationControl(state, { pause: async () => {} }, async () => ({ model: { authorized: false }, publishing: { authorized: false } }));
  const app = await buildApp(config, { enableProxy: false, automation: control });
  t.after(async () => { await app.close(); state.close(); await rm(directory, { recursive: true }); });
  assert.equal((await app.inject({ url: '/session/automation.json', headers })).statusCode, 302);
  const cookie = await login(app);
  const auth = { ...headers, cookie };
  const status = await app.inject({ url: '/session/automation.json', headers: auth });
  assert.equal(status.json().control.paused, 1);
  assert.equal(status.json().dailyBudgetMicrousd, 0);
  assert.equal((await app.inject({ method: 'POST', url: '/session/automation/resume', headers: auth })).statusCode, 409);
  assert.equal(state.control().paused, 1);
  const paused = await app.inject({ method: 'POST', url: '/session/automation/pause', headers: auth });
  assert.equal(paused.statusCode, 302);
  assert.equal(state.control().reason, 'operator_paused');
  assert.equal((await app.inject({ method: 'POST', url: '/session/automation/pause', headers: { ...auth, origin: 'https://attacker.example' } })).statusCode, 403);
  const page = await app.inject({ url: '/session', headers: auth });
  assert.match(page.body, /13:00 America\/New_York/);
  assert.match(page.body, /disabled[^>]*>Resume automation/);
  for (const secret of [config.jwtSecret, config.sessionKey, password]) assert.ok(!page.body.includes(secret));
});
