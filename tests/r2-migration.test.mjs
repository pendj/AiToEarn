import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { migrateObjects } from '../scripts/migrate-r2.mjs';
import { r2Target } from '../gateway/storage.mjs';
import { MediaBudget } from '../gateway/media-budget.mjs';
import { freeLimits } from '../server/r2-policy.cjs';

function fixture({ existing, sourceChanged = false, wrongScope = false } = {}) {
  const bytes = Buffer.from('source-image');
  const key = `operator/user/media/image.jpg`;
  const requests = [];
  let copied = existing;
  const source = { async send(command) {
    const action = command.constructor.name;
    requests.push(`source:${action}`);
    if (action === 'ListObjectsV2Command') return { Contents: [{ Key: wrongScope ? 'outside.jpg' : key, Size: bytes.length, ETag: 'original' }] };
    if (action === 'GetObjectCommand') return { ContentLength: bytes.length, ContentType: 'image/jpeg', ETag: 'original', Body: { transformToByteArray: async () => bytes } };
    if (action === 'HeadObjectCommand') return { ContentLength: bytes.length, ETag: sourceChanged ? 'changed' : 'original' };
    throw new Error('Unexpected source mutation');
  } };
  const destination = { async send(command) {
    const action = command.constructor.name;
    requests.push(`destination:${action}`);
    assert.equal(command.input.Bucket, r2Target.bucket);
    if (action === 'HeadObjectCommand') {
      if (!copied) throw { $metadata: { httpStatusCode: 404 } };
      return { ContentLength: copied.length };
    }
    if (action === 'PutObjectCommand') {
      assert.equal(command.input.IfNoneMatch, '*');
      assert.equal(copied, undefined);
      copied = command.input.Body;
      return {};
    }
    if (action === 'GetObjectCommand') return { ContentLength: copied.length, ContentType: 'image/jpeg', Body: { transformToByteArray: async () => copied } };
    throw new Error('Unexpected destination operation');
  } };
  const config = { operatorId: 'operator', storage: { endpoint: 'http://storage:9000', bucket: 'luxsabers-social' } };
  return { source, destination, config, requests, bytes, get copied() { return copied; } };
}

test('migration verifies exact images and preserves source objects; identical targets are reused', async () => {
  const f = fixture();
  let evidence;
  const result = await migrateObjects(f.source, f.destination, f.config, r2Target, async value => { evidence = JSON.parse(JSON.stringify(value)); });
  assert.equal(result.passed, true);
  assert.equal(evidence.objects[0].verified, true);
  assert.deepEqual(f.copied, f.bytes);
  assert.equal(f.requests.filter(x => x.includes('PutObject')).length, 1);
  const replay = fixture({ existing: f.bytes });
  assert.equal((await migrateObjects(replay.source, replay.destination, replay.config, r2Target, async () => {})).passed, true);
  assert.equal(replay.requests.filter(x => x.includes('PutObject')).length, 0);
});

test('conflicts, changed sources and out-of-scope objects stop without deletion or overwrite', async () => {
  for (const options of [{ existing: Buffer.from('wrong-data!!') }, { sourceChanged: true }, { wrongScope: true }]) {
    const f = fixture(options);
    await assert.rejects(migrateObjects(f.source, f.destination, f.config, r2Target, async () => {}));
    assert.equal(f.requests.filter(x => x.includes('Delete')).length, 0);
    if (options.existing || options.wrongScope) assert.equal(f.requests.filter(x => x.includes('PutObject')).length, 0);
  }
});

test('private media reservations survive restart and stop at byte or daily limits', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'social-media-budget-'));
  t.after(() => rm(directory, { recursive: true }));
  const path = join(directory, 'budget.sqlite');
  const policy = { initialBytes: 20, maxBytes: 100, dailyUploads: 2 };
  const first = new MediaBudget(path, policy);
  assert.equal(first.reserve(30, '2026-09-17'), true);
  first.close();
  const next = new MediaBudget(path, policy);
  t.after(() => next.close());
  assert.equal(next.reserve(20, '2026-09-17'), true);
  assert.equal(next.reserve(1, '2026-09-17'), false);
  assert.equal(next.reserve(31, '2026-09-18'), false);
  assert.equal(next.reserve(30, '2026-09-18'), true);
  assert.equal(next.reserve(1, '2026-09-19'), false);
});

test('10 GB storage never resets with the month, and request allowances span billing boundaries', () => {
  const budget = new MediaBudget(':memory:', { initialBytes: freeLimits.storageBytes - freeLimits.storageReserve - 1 });
  try {
    assert.equal(budget.reserve(1, '2026-09-30'), true);
    assert.equal(budget.reserve(1, '2026-10-01'), false);
    budget.db.prepare('INSERT INTO r2_operations VALUES (?,?,?)').run('2026-09-30', 'a', freeLimits.a - freeLimits.requestReserve - 1);
    assert.equal(budget.reserveOperation('a', new Date('2026-09-30T12:00:00Z')), true);
    assert.equal(budget.reserveOperation('a', new Date('2026-10-01T12:00:00Z')), false);
    assert.equal(budget.reserveOperation('b', new Date('2026-10-01T12:00:00Z')), true);
    assert.equal(budget.reserveOperation('unknown'), false);
    assert.equal(budget.reserveOperation('a', new Date('2026-11-01T12:00:00Z')), true);
  } finally { budget.close(); }
});
