import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { jwtVerify } from 'jose';
import { AiToEarnClient } from '../automation/upstream.mjs';

test('native client uses actual pinned chat/flow envelopes and validates target identity', async t => {
  const secret = 'synthetic-test-secret-with-at-least-32-characters';
  const account = { id: '0123456789abcdef01234567', platform: 'facebook' };
  let wrongAccount = false;
  const server = createServer(async (req, res) => {
    const { payload } = await jwtVerify(req.headers.authorization.slice(7), new TextEncoder().encode(secret));
    assert.equal(payload.id, account.id);
    assert.ok(payload.exp - payload.iat <= 300);
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    res.setHeader('content-type','application/json');
    if (req.url === '/ai/chat') {
      assert.equal(body.model, 'synthetic-model');
      assert.equal(body.maxTokens, 600);
      res.end(JSON.stringify({ code: 0, data: { content: JSON.stringify({ openerId: 'closeup', closerId: 'explore', factIds: ['identity'] }) } }));
    } else if (req.url === '/v2/channels/publish/flows') {
      assert.equal(body.flowId, 'test-flow');
      assert.equal(body.items.length, 1);
      res.end(JSON.stringify({ code: 0, data: { flowId: 'test-flow', tasks: [{ id: 'synthetic-task', accountId: wrongAccount ? 'wrong' : account.id, platform: 'facebook', status: 6 }] } }));
    } else { res.statusCode = 404; res.end('{}'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const client = new AiToEarnClient({ jwtSecret: secret, operatorId: account.id, serverOrigin: origin, aiOrigin: origin });
  assert.equal((await client.generate({ name: 'Synthetic model', facts: { identity: 'Synthetic only' } }, { name: 'synthetic-model', maxTokens: 600 })).openerId, 'closeup');
  assert.equal((await client.createFlow('test-flow', account, { body: 'Synthetic only', media: [] }, Date.now())).flowId, 'test-flow');
  wrongAccount = true;
  await assert.rejects(() => client.createFlow('test-flow', account, { body: 'Synthetic only', media: [] }, Date.now()), /target_unconfirmed/);
});
