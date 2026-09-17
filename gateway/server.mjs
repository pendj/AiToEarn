import { readFile } from 'node:fs/promises';
import { buildApp } from './app.mjs';
import { buildUploads } from './uploads.mjs';

const config = JSON.parse(await readFile(process.env.GATEWAY_CONFIG || '/run/private/gateway.json', 'utf8'));
const app = await buildApp(config);
const uploads = await buildUploads(config);
await app.listen({ host: '0.0.0.0', port: 8080 });
await uploads.listen({ host: '0.0.0.0', port: 8081 });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await app.close(); await uploads.close(); process.exit(0); });
console.log('Private social gateway listening; publishing paused; model budget zero.');
