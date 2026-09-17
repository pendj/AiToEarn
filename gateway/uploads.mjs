import Fastify from 'fastify';
import proxy from '@fastify/http-proxy';

// S3 validates the short-lived signed URL. No storage credentials are returned.
export async function buildUploads(config) {
  const app = Fastify({ logger: false, trustProxy: false });
  const origins = new Set(config.origins);
  const uploadHost = new URL(config.uploadOrigin || 'http://127.0.0.1:19000').host;
  const bucketPrefix = `/${config.storage.bucket}/`;
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    const url = new URL(request.raw.url, 'http://localhost');
    if (request.headers.host !== uploadHost || !url.pathname.startsWith(bucketPrefix) || url.pathname.length <= bucketPrefix.length) {
      return reply.code(403).send({ error: 'Invalid asset request' });
    }
    if (request.headers.origin && !origins.has(request.headers.origin)) return reply.code(403).send({ error: 'Origin not allowed' });
    if (request.method === 'OPTIONS') {
      if (!origins.has(request.headers.origin)) return reply.code(403).send();
      reply.header('Access-Control-Allow-Origin', request.headers.origin);
      reply.header('Access-Control-Allow-Methods', 'PUT,GET,HEAD');
      reply.header('Access-Control-Allow-Headers', 'content-type,x-amz-checksum-crc32,x-amz-sdk-checksum-algorithm');
      reply.header('Access-Control-Max-Age', '300');
      return reply.code(204).send();
    }
    if (!['PUT', 'GET', 'HEAD'].includes(request.method) || !/^[a-f0-9]{64}$/.test(url.searchParams.get('X-Amz-Signature') || '')) {
      return reply.code(403).send({ error: 'Signed asset request required' });
    }
    if (request.method === 'PUT') {
      const length = Number(request.headers['content-length']);
      if (!Number.isSafeInteger(length) || length <= 0 || length > 50 * 1024 * 1024) return reply.code(413).send({ error: 'Invalid asset size' });
      if (!/^image\/(jpeg|png|webp)$/.test(request.headers['content-type'] || '')) return reply.code(415).send({ error: 'Only product images are enabled' });
    }
  });
  await app.register(proxy, { upstream: config.storage.endpoint, prefix: '/', http2: false,
    replyOptions: { rewriteRequestHeaders(request, headers) {
      const clean = { ...headers, host: request.headers.host };
      for (const name of ['authorization', 'cookie', 'x-api-key', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto']) delete clean[name];
      return clean;
    } },
  });
  app.setErrorHandler((_, request, reply) => reply.code(502).send({ error: 'Asset service unavailable' }));
  return app;
}
