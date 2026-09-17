import { readFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import { AutomationState } from './state.mjs';
import { DailyAutomation } from './engine.mjs';
import { NativeQueues, AiToEarnClient } from './upstream.mjs';
import { verifySource } from './sources.mjs';
import { diskStatus } from './disk.mjs';

process.umask(0o077);
const config = JSON.parse(await readFile('/run/private/automation.json', 'utf8'));
const queues = new NativeQueues(config.redis);
let state;
try {
  await queues.pause();
  if (process.argv.includes('--guard')) {
    const status = await queues.status();
    if (!status.every(queue => queue.paused && queue.concurrency === 1 && queue.active === 0)) throw new Error('native_queue_not_quiescent');
    console.log('Native publishing queues paused; global concurrency one.');
  } else {
    state = new AutomationState('/data/automation.sqlite');
    const readAuthority = async () => JSON.parse(await readFile('/run/private/automation-authority.json', 'utf8'));
    const engine = new DailyAutomation({ state, queues, client: new AiToEarnClient(config), readAuthority,
      manifest: JSON.parse(await readFile(new URL('./sources.json', import.meta.url), 'utf8')), verifySource, diskStatus: () => diskStatus(config.disk) });
    const stop = new AbortController();
    for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => stop.abort());
    do {
      try { await engine.tick(); }
      catch { state.pause('worker_failure'); state.heartbeat(new Date().toISOString(), 'worker_failure'); await queues.pause(); }
      if (process.argv.includes('--once')) break;
      try { await setTimeout(15000, undefined, { signal: stop.signal }); } catch { break; }
    } while (!stop.signal.aborted);
  }
} catch {
  console.error('Automation stopped; publication remains unconfirmed. Inspect private status, not provider payloads.');
  process.exitCode = 1;
} finally {
  try { await queues.pause(); } catch { process.exitCode = 1; }
  await queues.close();
  state?.close();
}
