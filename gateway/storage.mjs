import { S3Client } from '@aws-sdk/client-s3';

export const r2Target = Object.freeze({
  provider: 'r2',
  region: 'auto',
  endpoint: 'https://08c44086c81cc0cea32aa0288236416f.r2.cloudflarestorage.com',
  bucket: 'luxsabers-social-media',
});

export function validateR2Storage(storage) {
  if (!storage || Object.entries(r2Target).some(([key, value]) => storage[key] !== value)
    || !/^[a-f0-9]{32}$/.test(storage.accessKey || '') || !/^[a-f0-9]{64}$/.test(storage.secretKey || '')) {
    throw new Error('Invalid R2 configuration: use the dedicated bucket and S3 credentials');
  }
  return storage;
}

export function storageOptions(storage) {
  if (storage.provider === 'r2') validateR2Storage(storage);
  return {
    region: storage.region || 'us-east-1', endpoint: storage.endpoint, forcePathStyle: true,
    credentials: { accessKeyId: storage.accessKey, secretAccessKey: storage.secretKey },
    ...(storage.provider === 'r2' ? { maxAttempts: 1, requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED' } : {}),
  };
}

export const storageClient = storage => new S3Client(storageOptions(storage));
