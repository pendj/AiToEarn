import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { AutomationState } from '../automation/state.mjs';
import { buildModelGateway, modelTarget, validateChat } from '../gateway/model-gateway.mjs';
import { patchModelRetries } from '../scripts/patch-model-retries.mjs';

const time = Date.parse('2099-06-17T17:00:00Z');
const model = { authorized: true, approvalRef: 'synthetic-grant', connectionVerified: true, hardProviderLimitVerified: true,
  name: modelTarget.model, expiresAt: '2100-01-01T00:00:00Z', maxTokens: 600, maxCallMicrousd: 1000, dailyBudgetMicrousd: 1000, monthlyBudgetMicrousd: 2000 };
const config = { ...modelTarget, apiKey: 'a'.repeat(64), internalKey: 'b'.repeat(64), tokenId: 7, tokenExpiresAt: '2100-01-01T00:00:00Z', restrictionsVerified: true };
const chat = { model: modelTarget.model, messages: [{ role: 'user', content: 'Synthetic source-backed test only.' }], max_tokens: 600, stream: true, stream_options: { include_usage: true } };

async function setup(t, provider = async () => new Response(JSON.stringify({ data: [{ id: modelTarget.model }, { id: 'not-allowed' }] }))) {
  const directory = await mkdtemp(join(tmpdir(), 'luxsabers-model-test-'));
  const path = join(directory, 'automation.sqlite');
  const state = new AutomationState(path);
  let authority = { model: { ...model } };
  const calls = [];
  const app = buildModelGateway(config, { state, readAuthority: async () => authority, now: () => time,
    fetchImpl: async (url, options) => { calls.push({ url, options }); return provider(url, options); } });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => app.close(resolve)); state.close(); await rm(directory, { recursive: true }); });
  const origin = `http://127.0.0.1:${app.address().port}`;
  const request = (path, body, key = config.internalKey) => fetch(origin + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const prepare = () => { state.resume(); state.intent('2099-06-17', new Date(time).toISOString()); state.beginGeneration('2099-06-17', {}, model, new Date(time).toISOString()); };
  return { state, path, request, calls, prepare, setAuthority: value => { authority = value; } };
}

test('restricted metadata connection authenticates, filters and never forwards internal credentials', async t => {
  const fixture = await setup(t);
  assert.equal((await fixture.request('/v1/models', undefined, 'wrong')).status, 401);
  for (const path of ['/v1/models?redirect=https://example.com', '/admin/channels', '/v1/images/generations', '//example.com']) {
    assert.equal((await fixture.request(path)).status, 403);
  }
  assert.equal(fixture.calls.length, 0);
  const response = await fixture.request('/v1/models');
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, [{ id: modelTarget.model, object: 'model' }]);
  assert.equal(fixture.calls[0].url, `${modelTarget.origin}/v1/models`);
  assert.equal(fixture.calls[0].options.headers.authorization, `Bearer ${config.apiKey}`);
  assert.equal(fixture.calls[0].options.headers['user-agent'], 'LuxSabers-Social/1.0');
  assert.equal(fixture.calls[0].options.redirect, 'error');
});

test('paused, unapproved, or unreserved generation never contacts the provider', async t => {
  const fixture = await setup(t);
  assert.equal((await fixture.request('/v1/chat/completions', chat)).status, 403);
  fixture.state.resume();
  assert.equal((await fixture.request('/v1/chat/completions', chat)).status, 409);
  fixture.setAuthority({ model: { ...model, hardProviderLimitVerified: false, maxCallMicrousd: 0, dailyBudgetMicrousd: 0, monthlyBudgetMicrousd: 0 } });
  assert.equal((await fixture.request('/v1/chat/completions', chat)).status, 403);
  assert.equal(fixture.calls.length, 0);
});

test('only bounded text chat for the designated model is admitted', () => {
  assert.equal(validateChat(chat, model), chat);
  const nativePayload = { ...chat, max_tokens: undefined, max_completion_tokens: 600 };
  assert.equal(validateChat(nativePayload, model), nativePayload);
  for (const changed of [
    { ...chat, model: 'not-authorized' }, { ...chat, max_tokens: undefined }, { ...chat, max_tokens: 601 },
    { ...chat, max_completion_tokens: 600 }, { ...chat, tools: [] }, { ...chat, n: 2 },
    { ...chat, messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://example.com' } }] }] },
    { ...chat, messages: [{ role: 'user', content: 'x'.repeat(8001) }] },
    { ...chat, stream_options: { include_usage: true, other: true } },
  ]) assert.throws(() => validateChat(changed, model));
  assert.throws(() => buildModelGateway({ ...config, origin: 'https://example.com' }, {}));
});

test('unknown upstream outcome is durable and cannot be retried after gateway or database restart', async t => {
  const fixture = await setup(t, async () => { throw new Error('synthetic lost response'); });
  fixture.prepare();
  assert.equal((await fixture.request('/v1/chat/completions', chat)).status, 502);
  assert.equal((await fixture.request('/v1/chat/completions', chat)).status, 409);
  assert.equal(fixture.calls.length, 1);
  const reopened = new AutomationState(fixture.path);
  try { assert.equal(reopened.claimModelRequest('2099-06-17', model, new Date(time).toISOString()), false); }
  finally { reopened.close(); }
});

test('successful short SSE is returned once without exposing provider headers', async t => {
  const raw = 'data: {"choices":[]}\n\ndata: [DONE]\n\n';
  const fixture = await setup(t, async () => new Response(raw, { headers: { 'content-type': 'text/event-stream', 'x-private-provider-header': 'synthetic-only' } }));
  fixture.prepare();
  const response = await fixture.request('/v1/chat/completions', chat);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), raw);
  assert.equal(response.headers.get('x-private-provider-header'), null);
  assert.equal((await fixture.request('/v1/chat/completions', chat)).status, 409);
  assert.equal(fixture.calls.length, 1);
});

test('parallel native calls cannot create another upstream attempt', async t => {
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; });
  const waiting = new Promise(resolve => { release = resolve; });
  const fixture = await setup(t, async () => { entered(); await waiting; return new Response('{}', { headers: { 'content-type': 'application/json' } }); });
  fixture.prepare();
  const first = fixture.request('/v1/chat/completions', chat);
  await started;
  assert.equal((await fixture.request('/v1/chat/completions', chat)).status, 429);
  release();
  assert.equal((await first).status, 200);
  assert.equal(fixture.calls.length, 1);
});

test('model configuration cannot silently enable SDK retries on a changed upstream artifact', () => {
  const source = 'baseURL: this.config.baseUrl,\nmaxRetries: 1,\nbaseURL: this.config.baseUrl,';
  const hash = createHash('sha256').update(source).digest('hex');
  const result = patchModelRetries(source, hash);
  assert.equal(result.match(/maxRetries: 0,/g).length, 3);
  assert.throws(() => patchModelRetries(source));
  assert.throws(() => patchModelRetries(source + 'changed', hash));
});
