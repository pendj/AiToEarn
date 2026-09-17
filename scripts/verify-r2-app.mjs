import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { readR2Config } from './verify-r2.mjs';
import { storageClient } from '../gateway/storage.mjs';

// Explicit real-service check: one private image upload, no generation or post.
assert.equal(process.argv[2], '--private-image', 'Use --private-image to authorize the bounded check');
process.umask(0o077);
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = new URL('../.runtime/r2-app/', import.meta.url);
await mkdir(directory, { recursive: true, mode: 0o700 });
const recordFile = new URL('upload.json', directory);
const ssh = command => execFileSync('ssh', ['-i', '/root/.ssh/163.192.46.78.key', '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'ForwardAgent=no', '-o', 'StrictHostKeyChecking=yes', '-o', 'UpdateHostKeys=no', '-o', `ControlPath=${root}.runtime/ssh-control`, 'ubuntu@163.192.46.78', command], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const password = ssh('cat /srv/luxsabers-social/.private/operator-password.txt').trim();
const migration = JSON.parse(ssh('cat /srv/luxsabers-social/.runtime/r2-migration/copy.json'));
assert.equal(migration.passed, true);
const imageFile = new URL('../.runtime/prepared-media/model-003-exterior-66d112cc6e005aa1.jpg', import.meta.url);
const imageBytes = await readFile(imageFile);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceHash = hash(imageBytes);
const provenance = JSON.parse(await readFile(new URL('../.runtime/prepared-media/model-003-exterior-66d112cc6e005aa1.jpg.json', import.meta.url), 'utf8'));
assert.equal(imageBytes.length, 56898, 'Unexpected prepared product image');
assert.equal(provenance.sourceId, 'model-003-exterior');
assert.equal(provenance.sourceSha256, '76200aea9476cd6bf08abaf425904115819737d88138becee2483cd53aec8d28');
assert.equal(sourceHash, provenance.sha256, 'Prepared product source changed');
let record;
try { record = JSON.parse(await readFile(recordFile, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (record) {
  assert.equal(record.sha256, sourceHash);
  assert.ok(record.path && record.id, 'Previous unknown upload must be reconciled, not retried');
}
const base = 'http://127.0.0.1:18880';
const browser = await chromium.launch();
const statuses = [];
let step = 'login';
try {
  for (const [name, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }]]) {
    const context = await browser.newContext({ viewport, locale: 'en-US', reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.on('response', response => {
      const url = new URL(response.url());
      const category = url.pathname.endsWith('/uploadSign') ? 'sign' : url.port === '19000' ? 'storage' : /\/assets\/[a-f0-9]{24}\/confirm$/.test(url.pathname) ? 'confirm' : url.pathname === '/session/login' ? 'login' : null;
      if (category) statuses.push({ category, status: response.status(), method: response.request().method() });
    });
    step = name + '-login-page';
    await page.goto(base + '/session/login', { waitUntil: 'domcontentloaded' });
    await page.getByLabel('Username').fill('luxsabers');
    await page.getByLabel('Password').fill(password);
    step = name + '-login-submit';
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    step = name + '-workspace-navigation';
    await page.waitForURL(url => url.pathname.startsWith('/en'), { waitUntil: 'domcontentloaded' });
    if (name === 'desktop') {
      step = 'original-image-continuity';
      for (const original of migration.objects) {
        const response = await context.request.get(base + '/oss/' + original.key);
        assert.equal(response.status(), 200);
        assert.equal(hash(await response.body()), original.sha256);
      }
      if (!record) {
        step = 'native-ui-upload';
        await page.goto(base + '/en/draft-box', { waitUntil: 'domcontentloaded' });
        await page.locator('input[type=file]').first().waitFor({ state: 'attached', timeout: 30000 });
        record = { at: new Date().toISOString(), sha256: sourceHash, bytes: imageBytes.length, passed: false };
        await writeFile(recordFile, JSON.stringify(record, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
        const signedPromise = page.waitForResponse(response => new URL(response.url()).pathname === '/api/assets/uploadSign', { timeout: 45000 }).catch(() => null);
        const confirmedPromise = page.waitForResponse(response => /\/api\/assets\/[a-f0-9]{24}\/confirm$/.test(new URL(response.url()).pathname), { timeout: 60000 }).catch(() => null);
        await page.locator('input[type=file]').first().setInputFiles(fileURLToPath(imageFile));
        const signedResponse = await signedPromise;
        assert.equal(signedResponse?.status(), 200, 'Native signing failed');
        const signed = (await signedResponse.json()).data;
        assert.equal(new URL(signed.uploadUrl).origin, 'http://127.0.0.1:19000');
        assert.ok(new URL(signed.uploadUrl).searchParams.get('X-Amz-SignedHeaders').split(';').includes('content-length'), 'Signature must bind reserved size');
        record.path = signed.path;
        record.id = signed.id;
        await writeFile(recordFile, JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
        const confirmed = await confirmedPromise;
        assert.equal(confirmed?.status(), 200, 'Native confirmation failed');
        assert.equal((await confirmed.json()).code, 0);
        assert.ok(statuses.some(item => item.category === 'storage' && item.method === 'PUT' && item.status === 200));
        await page.screenshot({ path: fileURLToPath(new URL('desktop-upload.png', directory)), fullPage: true });
      }
      step = 'native-confirmation-readback';
      const confirmation = await context.request.post(base + '/api/assets/' + record.id + '/confirm', {
        headers: { Origin: base }, data: {},
      });
      assert.equal(confirmation.status(), 200);
      assert.equal((await confirmation.json()).code, 0);
      step = 'direct-r2-byte-check';
      const config = await readR2Config(root);
      const client = storageClient(config);
      try {
        const object = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: record.path }), { abortSignal: AbortSignal.timeout(20000) });
        assert.equal(object.ContentLength, imageBytes.length);
        assert.equal(hash(await object.Body.transformToByteArray()), sourceHash);
      } finally { client.destroy(); }
    }
    step = name + '-private-image';
    const imagePath = '/oss/' + record.path;
    const response = await context.request.get(base + imagePath);
    assert.equal(response.status(), 200);
    assert.equal(hash(await response.body()), sourceHash);
    const anonymous = await browser.newContext();
    assert.equal((await anonymous.request.get(base + imagePath)).status(), 401);
    await anonymous.close();
    await page.goto(base + imagePath);
    await page.waitForFunction(() => document.images.length === 1 && document.images[0].naturalWidth === 1080);
    await page.screenshot({ path: fileURLToPath(new URL(name + '-image.png', directory)), fullPage: true });
    await context.close();
    console.log(JSON.stringify({ viewport: name, privateImage: true, exactBytes: true, anonymousDenied: true }));
  }
  record.passed = true;
  record.verifiedAt = new Date().toISOString();
  await writeFile(recordFile, JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ realAppR2: true, originalsVerified: migration.objects.length, statuses, publicPublishing: false }));
} catch (error) {
  console.error(JSON.stringify({ passed: false, step, errorName: error.name, statuses, note: 'Private evidence retained; no automatic repeated upload.' }));
  process.exitCode = 1;
} finally { await browser.close(); }
