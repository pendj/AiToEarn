import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, chmod, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { S3Client } from '@aws-sdk/client-s3';
import { r2Target, validateR2Storage, storageOptions } from '../gateway/storage.mjs';
import { readR2Config, privateRoundtrip } from '../scripts/verify-r2.mjs';
import { initializeStorage } from '../gateway/init-storage.mjs';

const fixture = { ...r2Target, accessKey: 'a'.repeat(32), secretKey: 'b'.repeat(64) };

test('R2 runtime configuration is restricted to the dedicated bucket and disables SDK retries', async () => {
  assert.equal(validateR2Storage(fixture), fixture);
  const options = storageOptions(fixture);
  assert.equal(options.region, 'auto');
  assert.equal(options.maxAttempts, 1);
  assert.equal(options.requestChecksumCalculation, 'WHEN_REQUIRED');
  for (const changes of [{ bucket: 'other' }, { endpoint: 'https://attacker.example' }, { region: 'us-east-1' }, { accessKey: 'an-api-token' }]) {
    assert.throws(() => validateR2Storage({ ...fixture, ...changes }), /Invalid R2 configuration/);
  }
  assert.equal(storageOptions({ endpoint: 'http://storage:9000', accessKey: 'local', secretKey: 'local' }).region, 'us-east-1');
});

test('R2 initializer never creates buckets or changes policies with object-only credentials', async () => {
  for (const status of [200, 403, 404]) {
    const requests = [];
    const client = { async send(command) {
      requests.push(command.constructor.name);
      assert.equal(command.input.Bucket, r2Target.bucket);
      if (status !== 200) throw Object.assign(new Error('Synthetic service rejection'), { $metadata: { httpStatusCode: status } });
      return {};
    } };
    const operation = initializeStorage({ storage: fixture }, client);
    if (status === 200) assert.match(await operation, /left unchanged/);
    else await assert.rejects(operation, /Synthetic service rejection/);
    assert.deepEqual(requests, ['HeadBucketCommand']);
  }
});

test('local initializer retains its existing private-bucket setup', async () => {
  const requests = [];
  const client = { async send(command) {
    requests.push(command.constructor.name);
    if (command.constructor.name === 'HeadBucketCommand') throw { $metadata: { httpStatusCode: 404 } };
    if (command.constructor.name === 'GetBucketPolicyCommand') throw { name: 'NoSuchBucketPolicy' };
    return {};
  } };
  await initializeStorage({ storage: { bucket: 'local' }, origins: ['http://127.0.0.1:18880'] }, client);
  assert.deepEqual(requests, ['HeadBucketCommand', 'CreateBucketCommand', 'GetBucketPolicyCommand', 'PutBucketCorsCommand', 'PutBucketLifecycleConfigurationCommand']);
});

test('credential reader rejects exposed permissions and symlinks without disclosing values', async t => {
  const root = await mkdtemp(join(tmpdir(), 'social-r2-test-'));
  t.after(() => rm(root, { recursive: true }));
  const privatePath = join(root, '.private');
  const path = join(privatePath, 'r2.json');
  await mkdir(privatePath, { mode: 0o700 });
  await writeFile(path, JSON.stringify(fixture), { mode: 0o600 });
  assert.deepEqual(await readR2Config(root), fixture);
  await chmod(path, 0o644);
  await assert.rejects(readR2Config(root), /private regular file/);
  await chmod(path, 0o600);
  await chmod(privatePath, 0o755);
  await assert.rejects(readR2Config(root), /0700/);
  await chmod(privatePath, 0o700);
  await rm(path);
  const target = join(root, 'test-credentials.json');
  await writeFile(target, JSON.stringify(fixture), { mode: 0o600 });
  await symlink(target, path);
  await assert.rejects(readR2Config(root), { code: 'ELOOP' });
});

// Synthetic S3 boundary tests; these do not prove Cloudflare connectivity.
async function probeFixture(t, { publicRead = false, lostWriteResponse = false, foreignObject = false, anonymousError } = {}) {
  let object;
  const requests = [];
  const backend = createServer(async (req, res) => {
    requests.push({ method: req.method, url: req.url, authenticated: Boolean(req.headers.authorization) });
    assert.ok(req.url.startsWith(`/${r2Target.bucket}/_checks/luxsabers-social/`));
    const authenticated = Boolean(req.headers.authorization);
    if (!authenticated) {
      if (anonymousError) res.writeHead(400, { 'content-type': 'application/xml' }).end(`<Error><Code>InvalidArgument</Code><Message>${anonymousError}</Message></Error>`);
      else res.writeHead(publicRead ? 200 : 403).end();
      return;
    }
    if (req.method === 'PUT') {
      assert.equal(req.headers['if-none-match'], '*');
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      object = { bytes: Buffer.concat(chunks), probe: foreignObject ? 'another-writer' : req.headers['x-amz-meta-probe'] };
      assert.ok(object.bytes.length < 1024);
      if (lostWriteResponse) req.socket.destroy();
      else res.writeHead(200, { etag: '"test-etag"' }).end();
      return;
    }
    if (!object) { res.writeHead(404).end(); return; }
    if (req.method === 'HEAD') {
      res.writeHead(200, { 'content-length': String(object.bytes.length), 'x-amz-meta-probe': object.probe, etag: '"test-etag"' }).end();
    } else if (req.method === 'GET') {
      res.writeHead(200, { 'content-length': String(object.bytes.length) }).end(object.bytes);
    } else if (req.method === 'DELETE') {
      object = undefined;
      res.writeHead(204).end();
    } else {
      res.writeHead(405).end();
    }
  });
  await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => backend.close(resolve)));
  const endpoint = `http://127.0.0.1:${backend.address().port}`;
  const client = new S3Client({ ...storageOptions(fixture), endpoint });
  t.after(() => client.destroy());
  return { result: await privateRoundtrip(client, endpoint), requests, object };
}

test('private roundtrip checks exact bytes, anonymous denial and removes only its probe', async t => {
  const { result, requests, object } = await probeFixture(t);
  assert.equal(result.passed, true);
  assert.equal(object, undefined);
  assert.equal(requests.length, 7);
  assert.equal(requests.filter(x => x.method === 'PUT').length, 1);
  assert.ok(!JSON.stringify(result).includes(fixture.secretKey));
});

test('public object access fails verification and still cleans up the private probe', async t => {
  const { result, object } = await probeFixture(t, { publicRead: true });
  assert.equal(result.passed, false);
  assert.equal(result.anonymousDenied, false);
  assert.equal(result.cleanupVerified, true);
  assert.equal(object, undefined);
});

test('R2 missing-Authorization rejection passes without accepting unrelated 400 errors', async t => {
  const rejected = await probeFixture(t, { anonymousError: 'Authorization' });
  assert.equal(rejected.result.passed, true);
  assert.equal(rejected.result.anonymousDenied, true);
  assert.equal(rejected.requests.length, 7);
  const malformed = await probeFixture(t, { anonymousError: 'MalformedRequest' });
  assert.equal(malformed.result.passed, false);
  assert.equal(malformed.result.cleanupVerified, true);
});

test('ambiguous upload is reconciled for cleanup without repeating the write', async t => {
  const { result, requests, object } = await probeFixture(t, { lostWriteResponse: true });
  assert.equal(result.passed, false);
  assert.equal(result.cleanupVerified, true);
  assert.equal(requests.filter(x => x.method === 'PUT').length, 1);
  assert.equal(object, undefined);
});

test('unknown probe ownership blocks deletion and reports incomplete cleanup', async t => {
  const { result, requests, object } = await probeFixture(t, { foreignObject: true });
  assert.equal(result.passed, false);
  assert.equal(result.cleanupVerified, false);
  assert.equal(requests.filter(x => x.method === 'DELETE').length, 0);
  assert.ok(object);
});
