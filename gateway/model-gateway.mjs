import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { localSchedule, modelPermission } from '../automation/policy.mjs';

export const modelTarget = Object.freeze({ origin: 'https://ccload.luxsabers.com', model: 'gpt-5.6-luna', channelId: 3 });

function sameSecret(actual, expected) {
  return timingSafeEqual(createHash('sha256').update(actual).digest(), createHash('sha256').update(expected).digest());
}

async function boundedBody(stream, maximum) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > maximum) throw new Error('model_message_too_large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function validateChat(input, model) {
  const fields = ['model', 'messages', 'max_tokens', 'max_completion_tokens', 'temperature', 'stream', 'stream_options', 'n'];
  if (!input || Object.keys(input).some(key => !fields.includes(key)) || input.model !== modelTarget.model ||
      !Array.isArray(input.messages) || input.messages.length < 1 || input.messages.length > 4 ||
      input.messages.some(message => !message || Object.keys(message).some(key => !['role', 'content'].includes(key)) ||
        !['system', 'user', 'assistant'].includes(message.role) || typeof message.content !== 'string') ||
      input.messages.reduce((size, message) => size + message.content.length, 0) > 8000 ||
      (input.n !== undefined && input.n !== 1) || (input.stream !== undefined && typeof input.stream !== 'boolean') ||
      (input.temperature !== undefined && (!Number.isFinite(input.temperature) || input.temperature < 0 || input.temperature > 1)) ||
      (input.stream_options !== undefined && (input.stream !== true || !input.stream_options ||
        Object.keys(input.stream_options).some(key => key !== 'include_usage') || input.stream_options.include_usage !== true))) {
    throw new Error('model_request_not_allowed');
  }
  const limits = [input.max_tokens, input.max_completion_tokens].filter(value => value !== undefined);
  if (limits.length !== 1 || !Number.isSafeInteger(limits[0]) || limits[0] < 1 || limits[0] > model.maxTokens || limits[0] > 2000) {
    throw new Error('model_token_limit_required');
  }
  return input;
}

export function buildModelGateway(config, { state, readAuthority, fetchImpl = fetch, now = Date.now } = {}) {
  if (config.origin !== modelTarget.origin || config.model !== modelTarget.model || config.channelId !== modelTarget.channelId ||
      !Number.isSafeInteger(config.tokenId) || config.tokenId < 1 || !Number.isFinite(Date.parse(config.tokenExpiresAt)) ||
      config.restrictionsVerified !== true || !/^[a-f0-9]{64}$/.test(config.apiKey || '') ||
      !/^[a-f0-9]{64}$/.test(config.internalKey || '') || !state || typeof readAuthority !== 'function') {
    throw new Error('invalid_restricted_model_connection');
  }
  let active = false;
  const pending = new Set();
  const app = createServer(async (request, reply) => {
    const respond = (status, code) => {
      if (!reply.headersSent) reply.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      reply.end(JSON.stringify({ error: { message: code, type: 'restricted_model_gateway' } }));
    };
    if (!sameSecret(String(request.headers.authorization || ''), `Bearer ${config.internalKey}`)) return respond(401, 'unauthorized');
    const list = request.method === 'GET' && request.url === '/v1/models';
    if (!list && !(request.method === 'POST' && request.url === '/v1/chat/completions')) return respond(403, 'model_route_not_allowed');
    if (Date.parse(config.tokenExpiresAt) <= now()) return respond(403, 'model_connection_expired');
    if (active) return respond(429, 'model_connection_busy');
    active = true;
    const controller = new AbortController();
    pending.add(controller);
    const timeout = setTimeout(() => controller.abort(), list ? 10000 : 50000);
    timeout.unref();
    reply.on('close', () => { if (!reply.writableFinished) controller.abort(); });
    let attemptedDay;
    try {
      let body;
      if (!list) {
        const authority = await readAuthority();
        const denied = modelPermission(authority, now());
        if (denied || state.control().paused || authority.model.name !== config.model) return respond(403, denied || 'model_paused_or_mismatched');
        if (request.headers['content-type']?.split(';')[0] !== 'application/json') return respond(415, 'json_required');
        body = JSON.stringify(validateChat(JSON.parse((await boundedBody(request, 16000)).toString('utf8')), authority.model));
        const latest = await readAuthority();
        if (modelPermission(latest, now()) || JSON.stringify(latest.model) !== JSON.stringify(authority.model) || state.control().paused) {
          return respond(403, 'model_authority_changed');
        }
        const day = localSchedule(now()).day;
        // Claim the sole durable attempt before sending any generation bytes.
        if (!state.claimModelRequest(day, authority.model, new Date(now()).toISOString())) return respond(409, 'model_attempt_not_available');
        attemptedDay = day;
      }
      const upstream = await fetchImpl(`${config.origin}${list ? '/v1/models' : '/v1/chat/completions'}`, {
        method: list ? 'GET' : 'POST', redirect: 'error', signal: controller.signal,
        headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json', 'user-agent': 'LuxSabers-Social/1.0' }, body,
      });
      if (!upstream.ok) { await upstream.body?.cancel(); throw new Error('model_upstream_unconfirmed'); }
      const raw = await boundedBody(upstream.body, list ? 65536 : 1024 * 1024);
      if (list) {
        const data = JSON.parse(raw.toString('utf8'));
        if (!Array.isArray(data.data) || !data.data.some(model => model.id === config.model)) throw new Error('model_not_advertised');
        reply.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        reply.end(JSON.stringify({ object: 'list', data: [{ id: config.model, object: 'model' }] }));
      } else {
        const contentType = upstream.headers.get('content-type') || '';
        if (!/^(application\/json|text\/event-stream)(;|$)/i.test(contentType)) throw new Error('model_response_type_invalid');
        state.recordModelRequest(attemptedDay, 'response_received');
        reply.writeHead(200, { 'content-type': contentType.split(';')[0], 'cache-control': 'no-store' });
        reply.end(raw);
      }
    } catch {
      if (attemptedDay) {
        try { state.recordModelRequest(attemptedDay, 'unknown_no_retry'); }
        catch { /* The pre-request claim remains durable and cannot be retried. */ }
      }
      respond(502, 'model_request_unconfirmed_no_retry');
    } finally {
      clearTimeout(timeout);
      pending.delete(controller);
      active = false;
    }
  });
  app.maxConnections = 4;
  app.headersTimeout = 10000;
  app.requestTimeout = 15000;
  app.on('clientError', (_, socket) => socket.destroy());
  const close = app.close.bind(app);
  app.close = callback => { for (const controller of pending) controller.abort(); return close(callback); };
  return app;
}
