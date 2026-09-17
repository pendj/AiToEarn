import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { buildUploads } from '../gateway/uploads.mjs';

test('low or unmeasurable disk stops a signed upload before storage is called', async t => {
  for (const disk of [{ path: '.', minimumFreeBytes: Number.MAX_SAFE_INTEGER }, { path: '/missing-social-disk', minimumFreeBytes: 1 }]) {
    const app = await buildUploads({ origins: ['http://127.0.0.1:18880'], disk, storage: { endpoint: 'http://127.0.0.1:9', bucket: 'luxsabers-social' } });
    t.after(() => app.close());
    const result = await app.inject({ method: 'PUT', url: `/luxsabers-social/photo.png?X-Amz-Signature=${'a'.repeat(64)}`,
      headers: { host: '127.0.0.1:19000', 'content-type': 'image/png' }, payload: 'data' });
    assert.equal(result.statusCode, 507);
  }
});

test('only bounded signed image requests reach the storage service with original signing host', async t => {
  let calls = 0;
  const upstream = createServer((req, res) => {
    calls++;
    assert.equal(req.headers.host, '127.0.0.1:19000');
    assert.equal(req.headers.cookie, undefined);
    assert.equal(req.headers.authorization, undefined);
    res.end('ok');
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => upstream.close(resolve)));
  const app = await buildUploads({ origins: ['http://127.0.0.1:18080'], storage: { endpoint: `http://127.0.0.1:${upstream.address().port}`, bucket: 'luxsabers-social' } });
  t.after(() => app.close());
  const headers = { host: '127.0.0.1:19000', origin: 'http://127.0.0.1:18080' };
  const url = `/luxsabers-social/test.png?X-Amz-Signature=${'a'.repeat(64)}`;
  for (const path of ['/', '/health', '/luxsabers-social/', '/luxsabers-social/test.png', '/other/test.png']) {
    assert.equal((await app.inject({ url: path, headers })).statusCode, 403);
  }
  assert.equal((await app.inject({ method: 'DELETE', url, headers })).statusCode, 403);
  assert.equal((await app.inject({ url, headers: { ...headers, origin: 'https://attacker.example' } })).statusCode, 403);
  assert.equal((await app.inject({ method: 'OPTIONS', url, headers })).statusCode, 204);
  assert.equal((await app.inject({ method: 'PUT', url, headers: { ...headers, 'content-type': 'video/mp4' }, payload: 'data' })).statusCode, 415);
  assert.equal((await app.inject({ method: 'PUT', url, headers: { ...headers, 'content-type': 'image/png', 'content-length': String(51 * 1024 * 1024) }, payload: 'data' })).statusCode, 413);
  assert.equal(calls, 0);
  assert.equal((await app.inject({ method: 'PUT', url, headers: { ...headers, 'content-type': 'image/png', cookie: 'private-session', authorization: 'ignored' }, payload: 'data' })).statusCode, 200);
  assert.equal(calls, 1);
});
