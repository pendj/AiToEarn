import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const reviewedHash = '32f0eab2e6513a2c0799d1a8324f952b07bc7154e95f830e58e0967f6a75f9fe';
const original = 'new client_s3_1.S3Client({';
export function patchR2Transport(source, expectedHash = reviewedHash) {
  if (createHash('sha256').update(source).digest('hex') !== expectedHash || source.split(original).length !== 3) {
    throw new Error('Native S3 module differs from the reviewed pinned artifact');
  }
  return source.replaceAll(original, `require('/app/luxsabers/r2-transport.cjs').createS3Client(client_s3_1.S3Client, s3Config, {`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2];
  if (path !== '/app/libs/aws-s3/src/s3.module.js') throw new Error('Unexpected S3 patch target');
  await writeFile(path, patchR2Transport(await readFile(path, 'utf8')));
  console.log('Reviewed S3 transport uses target-only R2 proxy; non-R2 storage unchanged.');
}
