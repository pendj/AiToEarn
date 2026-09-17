import { readFile } from 'node:fs/promises';
import { buildApp } from './app.mjs';

const config = JSON.parse(await readFile(process.env.GATEWAY_CONFIG || '/run/private/gateway.json', 'utf8'));
const app = await buildApp(config);
await app.listen({ host: '0.0.0.0', port: 8080 });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await app.close(); process.exit(0); });
console.log('Private social gateway listening; publishing paused; model budget zero.');
