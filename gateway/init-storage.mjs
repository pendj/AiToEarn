import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CreateBucketCommand, GetBucketPolicyCommand, HeadBucketCommand, PutBucketCorsCommand, PutBucketLifecycleConfigurationCommand } from '@aws-sdk/client-s3';
import { storageClient } from './storage.mjs';

export async function initializeStorage(config, client) {
  const Bucket = config.storage.bucket;
  if (config.storage.provider === 'r2') {
    await client.send(new HeadBucketCommand({ Bucket }), { abortSignal: AbortSignal.timeout(15000) });
    return 'R2 endpoint reached; bucket configuration left unchanged. Object access is a separate check.';
  }
  try { await client.send(new HeadBucketCommand({ Bucket })); }
  catch (error) {
    if (error.$metadata?.httpStatusCode !== 404) throw new Error('Storage readiness failed');
    await client.send(new CreateBucketCommand({ Bucket }));
  }
  try {
    const policy = await client.send(new GetBucketPolicyCommand({ Bucket }));
    if (policy.Policy) throw new Error('Unexpected bucket policy; manual review required');
  } catch (error) {
    if (!['NoSuchBucketPolicy', 'NoSuchPolicy'].includes(error.name) && error.$metadata?.httpStatusCode !== 404) throw error;
  }
  await client.send(new PutBucketCorsCommand({ Bucket, CORSConfiguration: { CORSRules: [{
    AllowedOrigins: config.origins, AllowedMethods: ['GET', 'PUT', 'POST', 'HEAD'],
    AllowedHeaders: ['*'], ExposeHeaders: ['ETag'], MaxAgeSeconds: 600,
  }] } }));
  await client.send(new PutBucketLifecycleConfigurationCommand({ Bucket, LifecycleConfiguration: { Rules: [{
    ID: 'abandon-incomplete-uploads', Status: 'Enabled', Filter: { Prefix: '' },
    AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 },
  }] } }));
  return 'Private object bucket initialized; incomplete multipart uploads expire after seven days.';
}

async function main() {
  const config = JSON.parse(await readFile(process.env.GATEWAY_CONFIG || '/run/private/gateway.json', 'utf8'));
  const client = storageClient(config.storage);
  try { console.log(await initializeStorage(config, client)); }
  finally { client.destroy(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.error('Storage initialization failed; provider details withheld'); process.exitCode = 1; });
}
