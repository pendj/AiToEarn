import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, scryptSync } from 'node:crypto';
import { createServer } from 'node:http';
import { jwtVerify } from 'jose';
import { buildApp } from '../gateway/app.mjs';

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
  const html = (await app.inject({ url: '/session/login', headers })).body;
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
