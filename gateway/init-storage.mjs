import { readFile } from 'node:fs/promises';
import { CreateBucketCommand, GetBucketPolicyCommand, HeadBucketCommand, PutBucketCorsCommand, PutBucketLifecycleConfigurationCommand, S3Client } from '@aws-sdk/client-s3';

const config = JSON.parse(await readFile('/run/private/gateway.json', 'utf8'));
const client = new S3Client({ region: 'us-east-1', endpoint: config.storage.endpoint, forcePathStyle: true,
  credentials: { accessKeyId: config.storage.accessKey, secretAccessKey: config.storage.secretKey } });
const Bucket = config.storage.bucket;
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
console.log('Private object bucket initialized; incomplete multipart uploads expire after seven days.');
