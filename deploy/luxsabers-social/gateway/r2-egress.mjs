import { createServer } from 'node:http';
import { connect } from 'node:net';
import { r2Target } from './storage.mjs';
import { createHmac, timingSafeEqual } from 'node:crypto';

// TLS is end-to-end from the native S3 client. This is not a general proxy.
export function buildR2Egress({ mediaBudget, secretKey } = {}) {
  const target = new URL(r2Target.endpoint);
  const sockets = new Set();
  const app = createServer(async (request, reply) => {
    if (request.method !== 'POST' || request.url !== '/quota' || !mediaBudget || !secretKey) return reply.writeHead(403).end();
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 512) { reply.writeHead(413).end(); request.destroy(); return; }
        chunks.push(chunk);
      }
      const raw = Buffer.concat(chunks);
      const mac = createHmac('sha256', secretKey).update('luxsabers-r2-quota-v1\n').update(raw).digest();
      const signature = String(request.headers['x-r2-quota-signature'] || '');
      if (!/^[a-f0-9]{64}$/.test(signature) || !timingSafeEqual(mac, Buffer.from(signature, 'hex'))) return reply.writeHead(403).end();
      const input = JSON.parse(raw.toString('utf8'));
      if (!Number.isSafeInteger(input.at) || Math.abs(Date.now() - input.at) > 30000) return reply.writeHead(403).end();
      const allowed = mediaBudget.reserveOperation(input.kind);
      reply.writeHead(allowed ? 200 : 507, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ allowed }));
    } catch { if (!reply.headersSent) reply.writeHead(503).end(); else reply.destroy(); }
  });
  app.maxConnections = 8;
  app.headersTimeout = 10000;
  app.requestTimeout = 15000;
  app.on('clientError', (_, socket) => socket.destroy());
  app.on('connect', (request, client, head) => {
    if (request.url !== `${target.hostname}:443` || head.length > 16384 || sockets.size >= 4) {
      client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    sockets.add(client);
    const upstream = connect({ host: target.hostname, port: 443 });
    const stop = () => { client.destroy(); upstream.destroy(); sockets.delete(client); };
    const deadline = setTimeout(stop, 120000);
    deadline.unref();
    client.setTimeout(30000, stop);
    upstream.setTimeout(15000, stop);
    client.on('error', stop);
    upstream.on('error', stop);
    client.on('close', () => { clearTimeout(deadline); stop(); });
    upstream.on('close', stop);
    let bytes = head.length;
    const measure = chunk => { bytes += chunk.length; if (bytes > 64 * 1024 * 1024) stop(); };
    client.on('data', measure);
    upstream.on('data', measure);
    upstream.once('connect', () => {
      upstream.setTimeout(30000, stop);
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      client.pipe(upstream);
      upstream.pipe(client);
    });
  });
  const close = app.close.bind(app);
  app.close = callback => { for (const socket of sockets) socket.destroy(); return close(callback); };
  return app;
}
