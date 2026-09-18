'use strict';
exports.endpoint = 'https://08c44086c81cc0cea32aa0288236416f.r2.cloudflarestorage.com';
exports.bucket = 'luxsabers-social-media';
exports.freeLimits = Object.freeze({ storageBytes: 10_000_000_000, storageReserve: 100_000_000, a: 1_000_000, b: 10_000_000, requestReserve: 10_000 });
const classes = {
  a: new Set(['PutObjectCommand', 'CopyObjectCommand', 'CreateMultipartUploadCommand', 'CompleteMultipartUploadCommand', 'UploadPartCommand', 'UploadPartCopyCommand', 'ListObjectsV2Command', 'ListObjectsCommand', 'ListMultipartUploadsCommand', 'ListPartsCommand']),
  b: new Set(['HeadObjectCommand', 'GetObjectCommand', 'HeadBucketCommand', 'GetBucketLocationCommand']),
  free: new Set(['DeleteObjectCommand', 'AbortMultipartUploadCommand']),
};
exports.operationClass = name => {
  for (const [kind, names] of Object.entries(classes)) if (names.has(name)) return kind;
  throw new Error('Unbudgeted R2 operation is disabled');
};
