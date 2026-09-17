import { readFile } from 'node:fs/promises';
import { buildApp } from './app.mjs';
import { buildUploads } from './uploads.mjs';
import { AutomationState } from '../automation/state.mjs';
import { NativeQueues } from '../automation/upstream.mjs';
import { automationControl } from '../automation/control.mjs';

process.umask(0o077);
const config = JSON.parse(await readFile(process.env.GATEWAY_CONFIG || '/run/private/gateway.json', 'utf8'));
let state, queues, automation;
if (config.automation) {
  const worker = JSON.parse(await readFile('/run/private/automation.json', 'utf8'));
  state = new AutomationState('/data/automation.sqlite');
  queues = new NativeQueues(worker.redis);
  automation = automationControl(state, queues, async () => JSON.parse(await readFile('/run/private/automation-authority.json', 'utf8')));
}
const app = await buildApp(config, { automation });
const uploads = await buildUploads(config);
await app.listen({ host: '0.0.0.0', port: 8080 });
await uploads.listen({ host: '0.0.0.0', port: 8081 });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await app.close(); await uploads.close(); await queues?.close(); state?.close(); process.exit(0); });
console.log('Private social gateway listening; see authenticated automation status for authority and schedule.');
