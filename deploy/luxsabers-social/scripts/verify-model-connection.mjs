import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { AiToEarnClient } from './automation/upstream.mjs';
import { modelTarget } from './gateway/model-gateway.mjs';

// Run on stdin inside the gateway container; never enable a grant for this check.
const gateway = JSON.parse(await readFile('/run/private/gateway.json', 'utf8'));
const automation = JSON.parse(await readFile('/run/private/automation.json', 'utf8'));
const authority = JSON.parse(await readFile('/run/private/automation-authority.json', 'utf8'));
assert.equal(authority.model.authorized, false, 'Only the unauthorized connection can be checked');
assert.equal(gateway.modelGateway.model, modelTarget.model);
const state = new DatabaseSync('/data/automation.sqlite', { readOnly: true });
try {
  assert.equal(state.prepare('SELECT paused FROM control WHERE id=1').get().paused, 1);
  const attempts = () => state.prepare('SELECT count(*) AS total FROM model_requests').get().total;
  const before = attempts();
  const request = (path, body, key = gateway.modelGateway.internalKey) => fetch(`http://127.0.0.1:8083${path}`, {
    method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let response = await request('/v1/models', undefined, 'invalid');
  assert.equal(response.status, 401);
  await response.body?.cancel();
  for (const path of ['/admin/channels', '/v1/images/generations', '/v1/models?scope=all']) {
    response = await request(path);
    assert.equal(response.status, 403);
    await response.body?.cancel();
  }
  response = await request('/v1/models');
  assert.equal(response.status, 200, 'Real restricted provider metadata unavailable');
  assert.deepEqual((await response.json()).data, [{ id: modelTarget.model, object: 'model' }]);
  response = await request('/v1/chat/completions', {
    model: modelTarget.model, messages: [{ role: 'user', content: 'Unauthorized boundary check; do not generate.' }], max_tokens: 600,
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.message, 'model_authorization_missing');
  const native = new AiToEarnClient(automation);
  const models = await native.request('/ai/models/chat', { ai: true });
  assert.ok(Array.isArray(models) && models.some(model => model.name === modelTarget.model), 'Native model registration missing');
  await assert.rejects(native.request('/ai/chat', { ai: true, body: {
    model: modelTarget.model, messages: [{ role: 'user', content: 'Unauthorized boundary check; do not generate.' }],
    maxTokens: 600, temperature: 0.7,
  } }), /native_request_unconfirmed/);
  assert.equal(attempts(), before, 'Unauthorized requests must not claim any upstream generation attempt');
  assert.equal(state.prepare('SELECT paused FROM control WHERE id=1').get().paused, 1);
  console.log(JSON.stringify({ realRestrictedMetadata: true, nativeModelRegistered: true, unauthorizedGenerationDenied: true,
    unchangedGenerationAttempts: true, paused: true, model: modelTarget.model }));
} finally {
  state.close();
}
