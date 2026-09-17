import { readFile, mkdir, lstat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { ListObjectsV2Command, HeadObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { readR2Config } from './verify-r2.mjs';
import { storageClient } from '../gateway/storage.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const call = (client, command) => client.send(command, { abortSignal: AbortSignal.timeout(30000) });
const missing = error => error.$metadata?.httpStatusCode === 404;
async function objectBytes(client, input, expectedSize) {
  const object = await call(client, new GetObjectCommand(input));
  if (object.ContentLength !== expectedSize || expectedSize > 50 * 1024 * 1024) {
    object.Body?.destroy();
    throw new Error('Migration object size changed');
  }
  const bytes = Buffer.from(await object.Body.transformToByteArray());
  if (bytes.length !== expectedSize) throw new Error('Migration download size mismatch');
  return { object, bytes };
}

export async function migrateObjects(source, destination, config, r2, persist) {
  if (config.storage.endpoint !== 'http://storage:9000' || config.storage.bucket !== 'luxsabers-social') {
    throw new Error('Migration must start from the original project store');
  }
  const inventory = await call(source, new ListObjectsV2Command({ Bucket: config.storage.bucket, MaxKeys: 101 }));
  const objects = inventory.Contents || [];
  if (inventory.IsTruncated || objects.length > 100 || objects.reduce((sum, o) => sum + o.Size, 0) > 50 * 1024 * 1024
    || objects.some(o => !o.Key.startsWith(`${config.operatorId}/user/media/`) || !/\.(?:jpe?g|png|webp)$/i.test(o.Key)
      || !Number.isSafeInteger(o.Size) || o.Size <= 0)) throw new Error('Migration exceeds reviewed image scope');
  const result = { schema: 1, startedAt: new Date().toISOString(), passed: false, objects: [] };
  for (const entry of objects) {
    const input = { Bucket: config.storage.bucket, Key: entry.Key };
    const { object, bytes } = await objectBytes(source, input, entry.Size);
    if (!/^image\/(?:jpeg|png|webp)$/.test(object.ContentType || '') || object.ETag !== entry.ETag) {
      throw new Error('Migration source metadata changed');
    }
    const record = { key: entry.Key, bytes: bytes.length, sha256: hash(bytes), copied: false, verified: false };
    result.objects.push(record);
    await persist(result);
    const target = { Bucket: r2.bucket, Key: entry.Key };
    let exists = false;
    try { await call(destination, new HeadObjectCommand(target)); exists = true; }
    catch (error) { if (!missing(error)) throw error; }
    if (!exists) {
      await call(destination, new PutObjectCommand({ ...target, Body: bytes, IfNoneMatch: '*',
        ContentType: object.ContentType, ContentDisposition: object.ContentDisposition, Metadata: object.Metadata }));
      record.copied = true;
    }
    const copied = await objectBytes(destination, target, bytes.length);
    if (hash(copied.bytes) !== record.sha256 || copied.object.ContentType !== object.ContentType) {
      throw new Error('R2 object conflicts with original; nothing overwritten or removed');
    }
    const finalSource = await call(source, new HeadObjectCommand(input));
    if (finalSource.ETag !== object.ETag || finalSource.ContentLength !== bytes.length) throw new Error('Source changed during copy');
    record.verified = true;
    await persist(result);
  }
  result.passed = true;
  result.finishedAt = new Date().toISOString();
  await persist(result);
  return result;
}

async function main() {
  if (process.argv.length !== 4 || process.argv[2] !== '--copy') throw new Error('Use --copy <private-project-root>');
  const root = resolve(process.argv[3]);
  const r2 = await readR2Config(root);
  const gatewayFile = await readFile(resolve(root, '.private/gateway.json'));
  const r2File = await readFile(resolve(root, '.private/r2.json'));
  const config = JSON.parse(gatewayFile);
  const directory = resolve(root, '.runtime/r2-migration');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await lstat(directory);
  if (!stat.isDirectory() || (stat.mode & 0o077)) throw new Error('Private migration directory required');
  const path = resolve(directory, 'copy.json');
  const source = storageClient(config.storage);
  const destination = storageClient(r2);
  try {
    const result = await migrateObjects(source, destination, config, r2, async record => {
      const current = { ...record, sourceConfigSha256: hash(gatewayFile), r2ConfigSha256: hash(r2File) };
      await writeFile(path, JSON.stringify(current, null, 2) + '\n', { mode: 0o600, flag: 'w' });
    });
    console.log(JSON.stringify({ passed: result.passed, objects: result.objects.length, bytes: result.objects.reduce((n, o) => n + o.bytes, 0), originalsPreserved: true }));
  } finally { source.destroy(); destination.destroy(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.umask(0o077);
  main().catch(() => { console.error('R2 migration stopped; inspect private state. No source object was deleted and no destination object overwritten.'); process.exitCode = 1; });
}
