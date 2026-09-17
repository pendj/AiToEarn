import Fastify from 'fastify';
import secureSession from '@fastify/secure-session';
import formbody from '@fastify/formbody';
import rateLimit from '@fastify/rate-limit';
import proxy from '@fastify/http-proxy';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { SignJWT } from 'jose';
import { scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { diskStatus } from '../automation/disk.mjs';
import { storageClient } from './storage.mjs';

const scrypt = promisify(scryptCallback);
const marker = 'private-gateway-session-not-a-credential';
const unsafeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function canonicalPath(rawUrl) {
  try {
    const path = decodeURIComponent(new URL(rawUrl, 'http://localhost').pathname);
    if (path.includes('%') || path.includes('\\') || path.includes('//')) return null;
    if (path.split('/').some(part => part === '.' || part === '..')) return null;
    return path;
  } catch {
    return null;
  }
}

function html(body, title = 'LuxSabers Social', wide = false) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><link rel="stylesheet" href="/session/style.css"><main${wide ? ' class="workspace"' : ''}>${body}</main></html>`;
}

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const label = value => escapeHtml(String(value || '').replaceAll('_', ' '));

function statusPage(status) {
  const paused = Boolean(status.control.paused);
  const rows = status.themes.map(row => `<div class="record"><time>${escapeHtml(row.day)}</time><span>${label(row.state)}</span><span>${label(row.reason)}</span></div>`).join('');
  const posts = status.dispatches.map(row => `<div class="record"><time>${escapeHtml(row.day)}</time><span>${escapeHtml(row.platform)}</span><span>${label(row.state)}</span></div>`).join('');
  return html(`<header><h1>LuxSabers Social</h1><a href="/en">Workspace</a></header><section><h2>Daily automation</h2><p class="state">${paused ? 'Publishing paused' : status.publishingBlock ? 'Private drafts only' : 'Schedule active'}</p><dl><dt>Schedule</dt><dd>${escapeHtml(status.schedule)} ${escapeHtml(status.timezone)}</dd><dt>Model budget / day</dt><dd>$${(status.dailyBudgetMicrousd / 1000000).toFixed(2)}</dd><dt>Model</dt><dd>${status.modelBlock ? label(status.modelBlock) : 'Authorized'}</dd><dt>Publishing</dt><dd>${status.publishingBlock ? label(status.publishingBlock) : 'Authorized'}</dd><dt>Worker</dt><dd>${label(status.control.health || 'starting')}</dd><dt>Last check (UTC)</dt><dd>${escapeHtml(status.control.heartbeat || 'Pending')}</dd></dl><form method="post" action="/session/automation/${paused ? 'resume' : 'pause'}"><button ${paused && status.modelBlock ? 'disabled' : ''} type="submit">${paused ? 'Resume automation' : 'Pause automation'}</button></form></section><section><h2>Content history</h2>${rows || '<p>No generated drafts</p>'}</section><section><h2>Publication results</h2>${posts || '<p>No submitted posts</p>'}</section><footer><form method="post" action="/session/logout"><button type="submit" class="secondary">Sign out</button></form></footer>`, 'LuxSabers Social | Automation', true);
}

function loginPage(error = '') {
  return html(`<h1>LuxSabers Social</h1><h2>Sign in</h2>${error ? '<p role="alert">Sign-in failed.</p>' : ''}<form method="post" action="/session/login"><label for="username">Username</label><input id="username" name="username" autocomplete="username" required maxlength="80"><label for="password">Password</label><input id="password" type="password" name="password" autocomplete="current-password" required maxlength="256"><button type="submit">Sign in</button></form>`);
}

export async function buildApp(config, { enableProxy = true, automation } = {}) {
  if (!Array.isArray(config.origins) || !config.origins.length) throw new Error('Missing trusted origins');
  if (config.sessionKey.length !== 64 || config.jwtSecret.length < 32) throw new Error('Invalid key configuration');
  const origins = new Set(config.origins);
  const hosts = new Set(config.origins.map(value => new URL(value).host));
  const app = Fastify({ logger: false, bodyLimit: 50 * 1024 * 1024, trustProxy: false });
  await app.register(formbody);
  await app.register(secureSession, {
    key: Buffer.from(config.sessionKey, 'hex'),
    cookieName: 'luxsabers_social_session',
    expiry: 8 * 60 * 60,
    cookie: { path: '/', httpOnly: true, sameSite: 'strict', secure: config.secureCookie, maxAge: 8 * 60 * 60 },
  });
  await app.register(rateLimit, { global: false });

  app.addHook('onRequest', async (request, reply) => {
    const path = canonicalPath(request.raw.url);
    if (!path || !hosts.has(request.headers.host)) return reply.code(400).send({ error: 'Invalid request' });
    request.safePath = path;
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'same-origin');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Cache-Control', 'no-store');
    if (path.startsWith('/session')) reply.header('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
    if (unsafeMethods.has(request.method) && !origins.has(request.headers.origin)) {
      return reply.code(403).send({ error: 'Origin not allowed' });
    }
    if (path === '/healthz' || path === '/session/login' || path === '/session/style.css' || path === '/session/clear.js') return;
    if (request.session.get('operator') !== config.operatorId || request.session.get('epoch') !== config.sessionEpoch) {
      if (path.startsWith('/api/') || path.startsWith('/oss/')) return reply.code(401).send({ error: 'Sign in required' });
      return reply.redirect('/session/login');
    }
    if (path === '/api/config' || path.startsWith('/api/config/') || path === '/api/ai/config' || path.startsWith('/api/ai/config/') || path.startsWith('/api/user/ai/config') || /^\/api\/(?:apiKey|apikey|api-key)(?:\/|$)/i.test(path)) {
      return reply.code(403).send({ error: 'Configuration is managed on the server' });
    }
    if (path.startsWith('/api/login/')) return reply.code(403).send({ error: 'Use the private sign-in page' });
    if (unsafeMethods.has(request.method) && (path.startsWith('/api/ai/') || path.startsWith('/api/agent/'))) {
      return reply.code(403).send({ error: 'Model use is awaiting cost authorization' });
    }
    if (unsafeMethods.has(request.method) && path.startsWith('/api/v2/channels/')) {
      return reply.code(403).send({ error: 'Account connection and publication are not authorized yet' });
    }
    if (path.startsWith('/api/v2/channels/accounts/auth/') || path.startsWith('/api/v2/channels/relay/')) {
      return reply.code(403).send({ error: 'Account connection is not authorized yet' });
    }
    if (unsafeMethods.has(request.method) && path.startsWith('/api/') && !/^\/api\/(?:material(?:\/|$)|assets\/uploadSign$|assets\/[a-f0-9]{24}\/confirm$)/.test(path)) {
      return reply.code(403).send({ error: 'This operation is not enabled in the private workspace' });
    }
    if (path === '/api/assets/uploadSign' && config.disk && !(await diskStatus(config.disk)).ok) return reply.code(507).send({ error: 'Uploads paused: disk reserve unavailable' });
    if (path.startsWith('/api/')) {
      request.upstreamToken = await new SignJWT({ id: config.operatorId, name: 'LuxSabers Operator', mail: 'operator@luxsabers.local' })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(config.jwtSecret));
    }
  });

  app.get('/healthz', async () => ({ status: 'ok', management: 'private' }));
  app.get('/session/style.css', async (_, reply) => reply.type('text/css').send('html{color-scheme:light;font-family:system-ui,sans-serif;background:#f3f4f6;color:#18181b}body{margin:0}main{width:calc(100% - 48px);max-width:420px;margin:64px auto}h1{font-size:26px;letter-spacing:0;margin:0 0 32px}h2{font-size:20px;margin:0 0 24px}label{display:block;font-size:14px;margin-top:20px}input{box-sizing:border-box;width:100%;height:46px;border:1px solid #71717a;border-radius:6px;padding:10px 12px;font:inherit;margin-top:8px;background:#fff;color:#18181b}button{border:0;border-radius:6px;background:#18634b;color:white;font:600 16px system-ui;width:100%;min-height:46px;margin-top:28px;cursor:pointer}button:focus-visible,input:focus-visible{outline:3px solid #2563eb;outline-offset:2px}p[role=alert]{color:#b91c1c}a{color:#155e75}.workspace{max-width:820px;margin:32px auto}.workspace header{display:flex;align-items:center;justify-content:space-between;gap:20px;padding-bottom:24px;border-bottom:2px solid #18181b}.workspace h1{font-size:24px;margin:0}.workspace section{padding:28px 0;border-bottom:1px solid #cbd0d1}.workspace h2{margin:0 0 16px;font-size:18px}.state{font-weight:650;color:#8b420b}dl{display:grid;grid-template-columns:180px minmax(0,1fr);gap:12px 20px;font-size:14px}dt{color:#52525b}dd{margin:0;overflow-wrap:anywhere}.workspace button{width:auto;min-width:170px;padding:10px 18px;margin-top:14px}.workspace button:disabled{background:#d4d4d8;color:#52525b;cursor:not-allowed}.secondary{background:#e4e4e7;color:#27272a}.record{display:grid;grid-template-columns:110px 110px minmax(0,1fr);gap:12px;font-size:14px;padding:12px 0;border-top:1px solid #dedee2;overflow-wrap:anywhere}footer{padding:20px 0}@media(max-width:540px){main{width:calc(100% - 32px);margin:32px auto}.workspace header{align-items:flex-start}.workspace h1{font-size:21px}dl{grid-template-columns:1fr;gap:6px}dd{margin-bottom:10px}.record{grid-template-columns:100px minmax(0,1fr)}.record span:last-child{grid-column:1/-1}.workspace button{width:100%}}'));
  app.get('/session/login', async (_, reply) => reply.type('text/html').send(loginPage()));
  app.post('/session/login', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { username, password } = request.body ?? {};
    if (typeof username !== 'string' || typeof password !== 'string' || password.length > 256) {
      return reply.code(401).type('text/html').send(loginPage('failed'));
    }
    const derived = await scrypt(password, Buffer.from(config.passwordSalt, 'hex'), 64);
    const matched = timingSafeEqual(derived, Buffer.from(config.passwordHash, 'hex'));
    if (username !== config.username || !matched) return reply.code(401).type('text/html').send(loginPage('failed'));
    request.session.regenerate();
    request.session.set('operator', config.operatorId);
    request.session.set('epoch', config.sessionEpoch);
    return reply.redirect('/session/ready');
  });
  app.get('/session/ready', async (_, reply) => reply.type('text/html').send(html('<h1>LuxSabers Social</h1><script src="/session/bootstrap.js"></script>')));
  app.get('/session/bootstrap.js', async (_, reply) => reply.type('text/javascript').send(`localStorage.setItem('User',JSON.stringify({state:{token:${JSON.stringify(marker)},hasEverLoggedIn:true,lang:'en'},version:0}));location.replace('/en');`));
  app.get('/session', async (_, reply) => reply.type('text/html').send(automation ? statusPage(await automation.status()) : html('<h1>LuxSabers Social</h1><p>Publishing paused</p><p>Model budget: $0</p><p><a href="/en">Open workspace</a></p><form method="post" action="/session/logout"><button type="submit">Sign out</button></form>')));
  app.get('/session/automation.json', async (_, reply) => automation ? automation.status() : reply.code(503).send({ error: 'Automation unavailable' }));
  app.post('/session/automation/pause', async (_, reply) => {
    if (!automation) return reply.code(503).send({ error: 'Automation unavailable' });
    await automation.pause();
    return reply.redirect('/session');
  });
  app.post('/session/automation/resume', async (_, reply) => {
    if (!automation) return reply.code(503).send({ error: 'Automation unavailable' });
    const reason = await automation.resume();
    if (reason) return reply.code(409).send({ error: 'Model authorization is required before resuming' });
    return reply.redirect('/session');
  });
  app.post('/session/logout', async (request, reply) => {
    request.session.delete();
    return reply.type('text/html').send(html('<h1>Signed out</h1><a href="/session/login">Sign in</a><script src="/session/clear.js"></script>'));
  });
  // The UI marker is not an authentication credential; the HttpOnly session is.
  app.get('/session/clear.js', async (_, reply) => reply.type('text/javascript').send("localStorage.removeItem('User');location.replace('/session/login');"));

  if (enableProxy) {
    const s3 = storageClient(config.storage);
    app.addHook('onClose', async () => s3.destroy());
    app.get('/oss/*', async (request, reply) => {
      try {
        const key = request.safePath.slice('/oss/'.length);
        if (!key) return reply.code(404).send({ error: 'Asset not found' });
        const asset = await s3.send(new GetObjectCommand({ Bucket: config.storage.bucket, Key: key }));
        reply.type(asset.ContentType || 'application/octet-stream');
        if (asset.ContentLength != null) reply.header('Content-Length', asset.ContentLength);
        reply.header('Content-Security-Policy', "default-src 'none'; sandbox");
        return reply.send(asset.Body);
      } catch {
        return reply.code(404).send({ error: 'Asset unavailable' });
      }
    });
    const rewriteRequestHeaders = (request, headers) => {
      const clean = { ...headers };
      for (const name of ['authorization', 'cookie', 'x-api-key', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto']) delete clean[name];
      if (request.upstreamToken) clean.authorization = `Bearer ${request.upstreamToken}`;
      return clean;
    };
    for (const [prefix, upstream, rewritePrefix] of [
      ['/api/ai', config.aiOrigin, '/ai'],
      ['/api/agent', config.aiOrigin, '/agent'],
      ['/api', config.serverOrigin, ''],
      ['/', config.webOrigin, '/'],
    ]) {
      await app.register(proxy, { upstream, prefix, rewritePrefix, http2: false,
        replyOptions: { rewriteRequestHeaders },
      });
    }
  }
  app.setErrorHandler((error, request, reply) => {
    const status = error.statusCode >= 400 && error.statusCode < 600 ? error.statusCode : 502;
    reply.code(status).send({ error: status === 429 ? 'Too many attempts' : 'Request failed' });
  });
  return app;
}
