import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createHmac } from 'node:crypto';
import { request } from 'node:http';
import vm from 'node:vm';
import { buildR2Egress } from '../gateway/r2-egress.mjs';
import { patchR2Transport } from '../scripts/patch-r2-transport.mjs';
import { r2Transport } from '../server/r2-transport.cjs';
import { r2Target } from '../gateway/storage.mjs';
import { MediaBudget } from '../gateway/media-budget.mjs';

test('reviewed transport patch changes both native S3 clients and refuses unknown artifacts', () => {
  const source = 'const a=new client_s3_1.S3Client({credentials: buildCredentials(s3Config),}); const b=new client_s3_1.S3Client({credentials: buildCredentials(s3Config),}); result=[a,b];';
  const expected = createHash('sha256').update(source).digest('hex');
  const context = { s3Config: {}, buildCredentials: () => 'unchanged', result: null, client_s3_1: { S3Client: class {} },
    require: name => { assert.equal(name, '/app/luxsabers/r2-transport.cjs'); return { createS3Client: (Client, config, options) => ({ ...options, maxAttempts: 1 }) }; } };
  vm.runInNewContext(patchR2Transport(source, expected), context);
  assert.equal(context.result[0].credentials, 'unchanged');
  assert.equal(context.result[0].maxAttempts, 1);
  assert.equal(context.result[1].maxAttempts, 1);
  assert.throws(() => patchR2Transport(source));
  assert.throws(() => patchR2Transport(source + 'changed', expected));
});

test('native R2 transport is explicit and leaves local storage untouched', () => {
  assert.deepEqual(r2Transport({ endpoint: 'http://storage:9000' }), {});
  assert.throws(() => r2Transport({ endpoint: 'https://other.r2.cloudflarestorage.com' }));
  const config = { endpoint: r2Target.endpoint, region: 'auto', bucketName: r2Target.bucket, publicEndpoint: r2Target.endpoint, forcePathStyle: true };
  const transport = r2Transport(config);
  assert.equal(transport.maxAttempts, 1);
  assert.equal(transport.requestHandler.httpsAgent.maxSockets, 1);
  assert.equal(transport.requestChecksumCalculation, 'WHEN_REQUIRED');
  assert.throws(() => r2Transport({ ...config, bucketName: 'other' }));
  assert.throws(() => r2Transport({ ...config, publicEndpoint: 'http://127.0.0.1:19000' }));
});

test('storage egress is not a general HTTP or CONNECT proxy', async t => {
  const proxy = buildR2Egress();
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => proxy.close(resolve)));
  const port = proxy.address().port;
  for (const path of ['example.com:443', '127.0.0.1:443', `${new URL(r2Target.endpoint).hostname}:80`, `${new URL(r2Target.endpoint).hostname}:443/extra`]) {
    const status = await new Promise((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port, method: 'CONNECT', path });
      req.on('connect', (res, socket) => { socket.destroy(); resolve(res.statusCode); });
      req.on('error', reject);
      req.end();
    });
    assert.equal(status, 403);
  }
  const result = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(result.status, 403);
});

test('native request budget requires authenticated fresh authorization and enforces the shared limit', async t => {
  const budget = new MediaBudget(':memory:');
  const secretKey = 'test-only-secret';
  const proxy = buildR2Egress({ mediaBudget: budget, secretKey });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => proxy.close(resolve)); budget.close(); });
  const url = `http://127.0.0.1:${proxy.address().port}/quota`;
  const call = async (input, secret = secretKey) => {
    const body = JSON.stringify(input);
    return fetch(url, { method: 'POST', body, headers: { 'x-r2-quota-signature': createHmac('sha256', secret).update('luxsabers-r2-quota-v1\n').update(body).digest('hex') } });
  };
  assert.equal((await call({ kind: 'b', at: Date.now() }, 'wrong')).status, 403);
  assert.equal((await call({ kind: 'b', at: 0 })).status, 403);
  assert.equal((await call({ kind: 'b', at: Date.now() })).status, 200);
  budget.db.prepare('UPDATE r2_operations SET count=10000000').run();
  assert.equal((await call({ kind: 'b', at: Date.now() })).status, 507);
});
