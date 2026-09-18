import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const reviewedHash = 'dc19fd10528e903f76d94dc7479062b10d84cad1f4127d4bd6a4e799e7572583';
export function patchModelRetries(source, expectedHash = reviewedHash) {
  const base = 'baseURL: this.config.baseUrl,';
  if (createHash('sha256').update(source).digest('hex') !== expectedHash || source.split(base).length !== 3 || source.split('maxRetries: 1,').length !== 2) {
    throw new Error('Native model service differs from the reviewed pinned artifact');
  }
  return source.replaceAll(base, `${base}\n                maxRetries: 0,`).replace('maxRetries: 1,', 'maxRetries: 0,');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2];
  if (path !== '/app/apps/aitoearn-ai/src/core/ai/libs/openai/openai.service.js') throw new Error('Unexpected model patch target');
  await writeFile(path, patchModelRetries(await readFile(path, 'utf8')));
  console.log('Reviewed native OpenAI SDK and LangChain retries disabled.');
}
