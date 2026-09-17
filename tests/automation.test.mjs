import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AutomationState, fingerprint } from '../automation/state.mjs';
import { DailyAutomation } from '../automation/engine.mjs';
import { automationControl } from '../automation/control.mjs';
import { localSchedule, modelPermission, publishingPermission, renderSelection, adaptContent } from '../automation/policy.mjs';

const now = Date.parse('2099-06-17T17:00:00Z');
const model = { authorized: true, approvalRef: 'synthetic-test-grant', connectionVerified: true, hardProviderLimitVerified: true, name: 'synthetic-model', expiresAt: '2100-01-01T00:00:00Z', maxTokens: 600, maxCallMicrousd: 1000, dailyBudgetMicrousd: 1000, monthlyBudgetMicrousd: 2000 };
const selection = { openerId: 'closeup', closerId: 'explore', factIds: ['identity'] };
const account = { id: '0123456789abcdef01234567', platform: 'facebook', platformUid: 'synthetic-page', connectionVerified: true, publicAccessVerified: true };
const source = { id: 'test-model', name: 'LuxSabers Test', facts: { identity: 'This is a synthetic test product.' }, imageNotice: 'Exterior reference only.', image: { url: 'https://luxsabers.com/assets/test.webp', sha256: 'a'.repeat(64) }, targetUrl: 'https://luxsabers.com/products/test' };
const manifest = { sources: [source] };
const checkedSource = () => ({ ...source, manifestSha256: fingerprint(manifest), verifiedAt: new Date(now).toISOString(), expiresAt: '2100-01-01T00:00:00Z' });
const authority = (publishing = false) => ({ model: { ...model }, publishing: { authorized: publishing, approvalRef: 'synthetic-publication-grant', expiresAt: '2100-01-01T00:00:00Z', timezone: 'America/New_York', hour: 13, maxPostsPerAccountPerDay: 1, contentRule: 'source-backed-product-preview-v1', nativeNoBlindRetryVerified: true, accounts: [account], media: { 'test-model': { sourceSha256: source.image.sha256, type: 'image/jpeg', publicFetchVerified: true, authorized: true, url: 'https://luxsabers.com/assets/test.jpg' } } } });

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'luxsabers-social-test-'));
  const path = join(dir, 'state.sqlite');
  const state = new AutomationState(path);
  t.after(async () => { try { state.close(); } catch {} await rm(dir, { recursive: true }); });
  return { state, path };
}

function setup(state, overrides = {}) {
  const calls = { model: 0, draft: 0, publish: 0, reads: 0, resumed: 0 };
  const dependencies = { state, manifest, readAuthority: async () => authority(), verifySource: async () => checkedSource(), diskStatus: async () => ({ ok: true }),
    queues: { pause: async () => {}, resume: async () => { calls.resumed++; } },
    client: { generate: async () => { calls.model++; return selection; }, saveDraft: async () => { calls.draft++; return 'a'.repeat(24); }, createFlow: async () => { calls.publish++; throw new Error('must not publish'); }, flow: async () => { calls.reads++; throw new Error('unconfirmed'); } }, ...overrides };
  return { calls, dependencies, engine: new DailyAutomation(dependencies) };
}

test('SQLite pause, daily intent, budget reservations and unknown flow survive reopen', async t => {
  const { state, path } = await fixture(t);
  assert.equal(state.control().paused, 1);
  state.resume();
  const first = state.intent('2099-06-17', new Date(now).toISOString());
  assert.equal(state.intent('2099-06-17', new Date(now).toISOString()).id, first.id);
  assert.equal(state.beginGeneration(first.day, checkedSource(), model, new Date(now).toISOString()), true);
  assert.equal(state.beginGeneration(first.day, checkedSource(), model, new Date(now).toISOString()), false);
  state.saveContent(first.day, renderSelection(selection, source), new Date(now).toISOString());
  const dispatch = state.beginDispatch(first.day, account);
  assert.equal(dispatch.state, 'unknown');
  assert.equal(state.beginDispatch(first.day, account), null);
  state.pause();
  state.close();
  const reopened = new AutomationState(path);
  t.after(() => reopened.close());
  assert.equal(reopened.control().paused, 1);
  assert.equal(reopened.dispatch(dispatch.flow_id).state, 'unknown');
  assert.equal(reopened.status().reservedMicrousd, 1000);
});

test('monthly budget is conservative and expired or absent authority cannot resume', async t => {
  const { state } = await fixture(t);
  state.resume();
  for (const day of ['2099-06-17','2099-06-18','2099-06-19']) {
    state.intent(day, new Date(now).toISOString());
    assert.equal(state.beginGeneration(day, checkedSource(), model, new Date(now).toISOString()), day !== '2099-06-19');
  }
  assert.ok(modelPermission({ model: { ...model, expiresAt: '2000-01-01' } }, now));
  assert.ok(publishingPermission(authority(false), now));
  assert.ok(publishingPermission({ ...authority(true), publishing: { ...authority(true).publishing, nativeNoBlindRetryVerified: false } }, now));
  const control = automationControl(state, { pause: async () => {} }, async () => ({}));
  await control.pause();
  assert.ok(await control.resume());
  assert.equal(state.control().paused, 1);
});

test('New York schedule follows DST and does not confuse UTC dates', () => {
  assert.deepEqual(localSchedule(Date.parse('2026-07-01T17:00:00Z')), { day: '2026-07-01', minute: 780 });
  assert.deepEqual(localSchedule(Date.parse('2026-12-01T18:00:00Z')), { day: '2026-12-01', minute: 780 });
  assert.equal(localSchedule(Date.parse('2026-07-01T02:00:00Z')).day, '2026-06-30');
});

test('model output cannot inject claims; all platform captions preserve test status', () => {
  assert.throws(() => renderSelection({ ...selection, factIds: ['invented-free-shipping'] }, source));
  assert.throws(() => renderSelection({ ...selection, body: 'Buy now!' }, source));
  const content = renderSelection(selection, source);
  for (const platform of ['facebook','instagram','pinterest']) {
    assert.match(adaptContent(content, { platform }).body, /checkout is in test mode/);
    assert.match(adaptContent(content, { platform }).body, /Exterior reference only/);
  }
});

test('paused and low-disk workers do not call model, drafts or publication', async t => {
  const { state } = await fixture(t);
  const run = setup(state);
  await run.engine.tick(now);
  assert.deepEqual(run.calls, { model: 0, draft: 0, publish: 0, reads: 0, resumed: 0 });
  state.resume();
  const low = setup(state, { diskStatus: async () => ({ ok: false }) });
  await low.engine.tick(now);
  assert.equal(state.control().reason, 'disk_reserve_unavailable');
  assert.equal(low.calls.model, 0);
});

test('one generation creates a private draft, repeated ticks and restart do not regenerate', async t => {
  const { state } = await fixture(t);
  state.resume();
  const run = setup(state);
  await run.engine.tick(now);
  await run.engine.tick(now + 15000);
  await new DailyAutomation(run.dependencies).tick(now + 30000);
  assert.equal(run.calls.model, 1);
  assert.equal(run.calls.draft, 1);
  assert.equal(run.calls.publish, 0);
  assert.equal(state.theme('2099-06-17').state, 'draft');
});

test('interrupted model and duplicate content never trigger another billable request that day', async t => {
  const { state } = await fixture(t);
  state.resume();
  const run = setup(state);
  state.intent('2099-06-17', new Date(now).toISOString());
  state.beginGeneration('2099-06-17', checkedSource(), model, new Date(now).toISOString());
  await run.engine.tick(now);
  assert.equal(run.calls.model, 0);
  assert.equal(state.theme('2099-06-17').reason, 'model_result_unknown_no_retry');
  for (const day of ['2099-07-01','2099-07-02']) {
    state.intent(day, new Date(now).toISOString());
    state.beginGeneration(day, checkedSource(), model, new Date(now).toISOString());
    state.saveContent(day, renderSelection(selection, source), new Date(now).toISOString());
  }
  assert.equal(state.theme('2099-07-02').reason, 'duplicate_content');
});

test('unknown submission persists before POST and only reconciles after a restart', async t => {
  const { state, path } = await fixture(t);
  state.resume();
  const run = setup(state, { readAuthority: async () => authority(true) });
  run.dependencies.client.createFlow = async flowId => { run.calls.publish++; assert.equal(state.dispatch(flowId).state, 'unknown'); throw new Error('network timeout after provider accepted'); };
  await run.engine.tick(now);
  assert.equal(run.calls.publish, 1);
  assert.equal(state.status().dispatches[0].state, 'unknown');
  state.close();
  const reopened = new AutomationState(path);
  t.after(() => reopened.close());
  const engine = new DailyAutomation({ ...run.dependencies, state: reopened });
  await engine.tick(now + 15000);
  assert.equal(run.calls.publish, 1);
  assert.equal(run.calls.reads, 1);
  assert.equal(run.calls.resumed, 0);
});

test('stale source stops publication; a pause during generation stops downstream writes', async t => {
  const { state } = await fixture(t);
  state.resume();
  const run = setup(state, { readAuthority: async () => authority(true), verifySource: async () => ({ ...checkedSource(), expiresAt: '2000-01-01' }) });
  await run.engine.tick(now);
  assert.equal(run.calls.publish, 0);
  assert.equal(state.theme('2099-06-17').reason, 'draft_source_expired_or_changed');
  const next = setup(state);
  next.dependencies.client.generate = async () => { state.pause(); return { ...selection, openerId: 'details' }; };
  await next.engine.tick(now + 86400000);
  assert.equal(next.calls.draft, 0);
  assert.equal(next.calls.publish, 0);
});

test('a concurrent operator pause wins over an already-started queue resume', async t => {
  const { state } = await fixture(t);
  state.resume();
  let paused = true;
  let control;
  const queues = {
    pause: async () => { paused = true; },
    resume: async () => { await control.pause(); paused = false; },
  };
  control = automationControl(state, queues, async () => authority(true));
  const run = setup(state, { queues, readAuthority: async () => authority(true) });
  run.dependencies.client.createFlow = async () => { run.calls.publish++; };
  await run.engine.tick(now);
  assert.equal(run.calls.publish, 1);
  assert.equal(state.control().paused, 1);
  assert.equal(paused, true, 'Native queues must end paused after the concurrent resume');
});

test('publication authority revoked during flow creation cannot release queues', async t => {
  const { state } = await fixture(t);
  state.resume();
  let allowed = true;
  const run = setup(state, { readAuthority: async () => authority(allowed) });
  run.dependencies.client.createFlow = async () => { run.calls.publish++; allowed = false; };
  await run.engine.tick(now);
  assert.equal(run.calls.publish, 1);
  assert.equal(run.calls.resumed, 0);
});

test('restart resumes the confirmed same queued flow without another create request', async t => {
  const { state, path } = await fixture(t);
  state.resume();
  const day = localSchedule(now).day;
  state.intent(day, new Date(now).toISOString());
  state.beginGeneration(day, checkedSource(), model, new Date(now).toISOString());
  state.saveContent(day, renderSelection(selection, source), new Date(now).toISOString());
  const dispatch = state.beginDispatch(day, account, authority(true).publishing);
  state.recordDispatch(dispatch.flow_id, { state: 'submitted', checks: 0 });
  state.close();
  const reopened = new AutomationState(path);
  t.after(() => reopened.close());
  const run = setup(reopened, { readAuthority: async () => authority(true) });
  run.dependencies.client.flow = async flowId => ({ flowId, tasks: [{ accountId: account.id, platform: account.platform, status: 6 }] });
  await run.engine.tick(now + 15000);
  assert.equal(run.calls.publish, 0);
  assert.equal(run.calls.model, 0);
  assert.equal(run.calls.resumed, 1);
  assert.equal(reopened.dispatch(dispatch.flow_id).state, 'submitted');
});

test('recovery does not release an old flow after its grant or publishing window changes', async t => {
  const { state } = await fixture(t);
  state.resume();
  const day = localSchedule(now).day;
  state.intent(day, new Date(now).toISOString());
  state.beginGeneration(day, checkedSource(), model, new Date(now).toISOString());
  state.saveContent(day, renderSelection(selection, source), new Date(now).toISOString());
  const dispatch = state.beginDispatch(day, account, { ...authority(true).publishing, approvalRef: 'old-grant' });
  const run = setup(state, { readAuthority: async () => authority(true) });
  run.dependencies.client.flow = async flowId => ({ flowId, tasks: [{ accountId: account.id, platform: account.platform, status: 6 }] });
  await run.engine.tick(now + 15000);
  assert.equal(run.calls.resumed, 0);
  assert.equal(state.dispatch(dispatch.flow_id).state, 'needs_reconciliation');
  assert.equal(state.control().paused, 1);
});

test('unconfirmed provider results have bounded readback and remain paused', async t => {
  const { state } = await fixture(t);
  state.resume();
  const run = setup(state, { readAuthority: async () => authority(true) });
  await run.engine.tick(now);
  for (let i = 1; i <= 8; i++) await run.engine.tick(now + i * 31 * 60000);
  assert.equal(run.calls.publish, 1);
  assert.equal(run.calls.reads, 6);
  assert.equal(state.control().paused, 1);
  assert.equal(state.status().dispatches[0].state, 'needs_reconciliation');
});
