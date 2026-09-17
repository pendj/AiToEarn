import { constants } from 'node:fs';
import { lstat, open, mkdir, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { PutObjectCommand, HeadObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { r2Target, validateR2Storage, storageClient } from '../gateway/storage.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const missing = error => error.$metadata?.httpStatusCode === 404;

export async function readR2Config(root) {
  const privatePath = resolve(root, '.private');
  const directory = await lstat(privatePath);
  if (!directory.isDirectory() || (directory.mode & 0o077)) throw new Error('Private directory must be 0700');
  const file = await open(resolve(privatePath, 'r2.json'), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || (stat.mode & 0o077) || stat.size > 8192) throw new Error('R2 credential file must be a private regular file');
    let config;
    try { config = JSON.parse(await file.readFile('utf8')); }
    catch { throw new Error('Invalid private R2 configuration'); }
    return validateR2Storage(config);
  } finally { await file.close(); }
}

// One random, conditionally-created probe only. Never list or migrate media.
export async function privateRoundtrip(client, endpoint, bucket = r2Target.bucket, probe = randomUUID()) {
  if (bucket !== r2Target.bucket) throw new Error('Unexpected storage check bucket');
  if (!/^[a-f0-9-]{36}$/.test(probe)) throw new Error('Invalid storage probe identifier');
  const Key = `_checks/luxsabers-social/${probe}.txt`;
  const Body = Buffer.from(`LuxSabers private storage check ${probe}\n`);
  const input = { Bucket: bucket, Key };
  const result = { schema: 1, checkedAt: new Date().toISOString(), bucket, key: Key, bytes: Body.length,
    uploaded: false, downloaded: false, anonymousDenied: false, cleanupVerified: false, passed: false };
  const send = command => client.send(command, { abortSignal: AbortSignal.timeout(15000) });
  try {
    await send(new PutObjectCommand({ ...input, Body, ContentType: 'text/plain', IfNoneMatch: '*', Metadata: { probe } }));
    result.uploaded = true;
    const head = await send(new HeadObjectCommand(input));
    if (head.Metadata?.probe !== probe || head.ContentLength !== Body.length) throw new Error('Probe metadata mismatch');
    const read = await send(new GetObjectCommand(input));
    if (read.ContentLength !== Body.length) { read.Body?.destroy(); throw new Error('Probe size mismatch'); }
    if (hash(await read.Body.transformToByteArray()) !== hash(Body)) throw new Error('Probe bytes mismatch');
    result.downloaded = true;
    const anonymous = await fetch(`${endpoint}/${bucket}/${Key}`, { method: 'HEAD', redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(15000) });
    result.anonymousDenied = [401, 403].includes(anonymous.status);
  } catch {
    // Provider payloads and signed headers are deliberately not persisted.
  } finally {
    try {
      const head = await send(new HeadObjectCommand(input));
      if (head.Metadata?.probe !== probe || head.ContentLength !== Body.length) throw new Error('Probe ownership unknown');
      await send(new DeleteObjectCommand(input));
      try { await send(new HeadObjectCommand(input)); }
      catch (error) { if (missing(error)) result.cleanupVerified = true; }
    } catch (error) {
      if (missing(error)) result.cleanupVerified = true;
    }
  }
  result.passed = result.uploaded && result.downloaded && result.anonymousDenied && result.cleanupVerified;
  return result;
}

async function main() {
  const mode = process.argv[2];
  if (process.argv.length !== 3 || !['--check-config', '--private-roundtrip'].includes(mode)) {
    throw new Error('Use --check-config (offline) or --private-roundtrip (authorized R2 requests)');
  }
  const root = fileURLToPath(new URL('../', import.meta.url));
  const config = await readR2Config(root);
  if (mode === '--check-config') {
    console.log('PASS: dedicated R2 target and private credential-file format. No network access or permission verification.');
    return;
  }
  const client = storageClient(config);
  try {
    const runtime = resolve(root, '.runtime');
    await mkdir(runtime, { mode: 0o700, recursive: true });
    const runtimeStat = await lstat(runtime);
    if (!runtimeStat.isDirectory() || (runtimeStat.mode & 0o077)) throw new Error('Private runtime directory required');
    const directory = resolve(root, '.runtime/r2-checks');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const stat = await lstat(directory);
    if (!stat.isDirectory() || (stat.mode & 0o077)) throw new Error('Private evidence directory required');
    const probe = randomUUID();
    const intent = { startedAt: new Date().toISOString(), bucket: config.bucket, key: `_checks/luxsabers-social/${probe}.txt` };
    await writeFile(resolve(directory, `${probe}.intent.json`), JSON.stringify(intent, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    const result = await privateRoundtrip(client, config.endpoint, config.bucket, probe);
    await writeFile(resolve(directory, `${probe}.result.json`), JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    if (!result.passed) throw new Error(`R2 check failed; temporary-object cleanup ${result.cleanupVerified ? 'verified' : 'NOT verified; inspect private evidence'}`);
    console.log('PASS: real R2 upload, metadata, exact download, anonymous denial and probe removal. AiToEarn is not switched.');
  } finally { client.destroy(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.umask(0o077);
  main().catch(error => {
    const message = error.code === 'ENOENT' ? 'R2 credentials missing; run python3 scripts/configure-r2.py in a terminal' : error.message;
    console.error(message);
    process.exitCode = 1;
  });
}
