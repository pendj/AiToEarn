import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { AutomationState } from './automation/state.mjs';
import { NativeQueues } from './automation/upstream.mjs';
import { modelPermission, publishingPermission } from './automation/policy.mjs';

// Run on stdin inside the deployed automation container, whose cwd is /app.
const config = JSON.parse(await readFile('/run/private/automation.json', 'utf8'));
const authority = JSON.parse(await readFile('/run/private/automation-authority.json', 'utf8'));
await stat('/data/automation.sqlite');
const state = new AutomationState('/data/automation.sqlite');
const queues = new NativeQueues(config.redis);
try {
  const current = state.status();
  const native = await queues.status();
  assert.equal(current.control.paused, 1, 'Worker must be paused');
  assert.ok(Date.now() - Date.parse(current.control.heartbeat) < 60000, 'Worker heartbeat stale');
  assert.ok(modelPermission(authority, Date.now()), 'Initial model grant must remain unavailable');
  assert.ok(publishingPermission(authority, Date.now()), 'Initial publishing grant must remain unavailable');
  assert.equal(current.reservedMicrousd, 0, 'No model cost may have been reserved');
  assert.equal(current.themes.length, 0, 'No unauthorized themes may be created');
  assert.equal(current.dispatches.length, 0, 'No unauthorized dispatch may be created');
  assert.ok(native.every(queue => queue.paused && queue.concurrency === 1 && queue.active === 0), 'Native queues must be paused, idle and limited to one');
  console.log(JSON.stringify({ paused: true, liveHeartbeat: true, zeroModelReservations: true, noDispatches: true,
    nativeQueues: native, pauseReason: current.control.reason }));
} finally {
  await queues.close();
  state.close();
}
