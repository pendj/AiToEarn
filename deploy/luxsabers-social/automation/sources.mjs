import { fingerprint } from './state.mjs';
import { createHash } from 'node:crypto';

export async function boundedFetch(url, { maxBytes = 2 * 1024 * 1024, expectedType } = {}) {
  const parsed = new URL(url);
  if (parsed.origin !== 'https://luxsabers.com' || parsed.username || parsed.password || parsed.hash) throw new Error('source_origin_invalid');
  const response = await fetch(parsed, { redirect: 'error', signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'LuxSabers-Social-SourceCheck/1.0' } });
  if (!response.ok || expectedType && !response.headers.get('content-type')?.startsWith(expectedType)) throw new Error('source_unavailable');
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > maxBytes) throw new Error('source_size_limit');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function verifySource(manifest, source, now) {
  const catalog = await boundedFetch(manifest.catalog.url);
  if (fingerprint(catalog.toString('utf8')) !== manifest.catalog.sha256) throw new Error('source_catalog_changed');
  const bytes = await boundedFetch(source.image.url, { expectedType: source.image.type });
  if (createHash('sha256').update(bytes).digest('hex') !== source.image.sha256) throw new Error('source_image_changed');
  const page = (await boundedFetch(source.targetUrl, { maxBytes: 4 * 1024 * 1024, expectedType: 'text/html' })).toString('utf8');
  if (!page.includes(source.name) || !/test checkout|test mode|test shopping/i.test(page)) throw new Error('source_checkout_or_product_unconfirmed');
  return { ...source, catalogSha256: manifest.catalog.sha256, manifestSha256: fingerprint(manifest), verifiedAt: new Date(now).toISOString(), expiresAt: new Date(now + 24 * 60 * 60 * 1000).toISOString() };
}
