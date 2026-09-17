import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const reviewedSha256 = '83d1273d0d0403e18dbef4e8212e56547cdd278bf4d55083cc7d49f9880eb68d';
const original = 'if (failure.retryable && attempts + 1 < 3) {';
const replacement = 'if (false /* LuxSabers: reconcile ambiguous publication; never auto-resubmit. */) {';

export function patchReviewedRetry(source, expectedHash = reviewedSha256) {
  if (createHash('sha256').update(source).digest('hex') !== expectedHash || source.split(original).length !== 2) throw new Error('Native publisher differs from the reviewed pinned artifact');
  return source.replace(original, replacement);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2];
  if (path !== '/app/apps/aitoearn-server/src/core/channels/publish/tasks/publish-task.service.js') throw new Error('Unexpected patch target');
  await writeFile(path, patchReviewedRetry(await readFile(path, 'utf8')));
  console.log('Reviewed native publish resubmission disabled; read-only finalization polling preserved.');
}
